import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { UnprocessableError, ValidationError } from '../../lib/errors.js';
import { auditContext } from '../audit/audit.service.js';
import * as documentsService from './documents.service.js';
import * as mailer from './mailer.js';
import { ALLOWED_MIME_LIST, maxUploadBytes, safeFilename } from './storage.js';
import {
  documentIdParamsSchema,
  generateSchema,
  listDocumentsQuerySchema,
  sendDocumentSchema,
  sendDocumentsSchema,
  uploadMetaSchema,
  type GenerateInput,
  type ListDocumentsQuery,
  type SendDocumentInput,
  type SendDocumentsInput,
} from './documents.schemas.js';

export const documentsRouter = Router();

documentsRouter.use(requireAuth);

/**
 * Uploads are held in memory and written by the storage service, so nothing
 * lands on disk under a client-supplied name. The size cap is enforced here as
 * well as in storage: rejecting at the edge means a 100MB body is never read.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes(), files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_LIST.includes(file.mimetype)) {
      callback(new UnprocessableError(`Probild does not accept ${file.mimetype} files.`));
      return;
    }
    callback(null, true);
  },
});

documentsRouter.get(
  '/',
  requirePermission(PERMISSIONS.DOCUMENT_READ),
  validate({ query: listDocumentsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await documentsService.listDocuments(
      req.query as unknown as ListDocumentsQuery,
    );
    sendPaginated(res, result.items, result.meta);
  }),
);

/** Whether documents can actually be emailed from here. */
documentsRouter.get(
  '/mail-status',
  requirePermission(PERMISSIONS.DOCUMENT_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, { configured: mailer.isMailConfigured() });
  }),
);

documentsRouter.post(
  '/upload',
  requirePermission(PERMISSIONS.DOCUMENT_WRITE),
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new ValidationError('Choose a file to upload.', [
        { field: 'file', message: 'No file was received.' },
      ]);
    }

    const parsed = uploadMetaSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('The submitted data is invalid.', [
        { field: 'meta', message: parsed.error.issues[0]?.message ?? 'Invalid metadata.' },
      ]);
    }

    const document = await documentsService.uploadDocument(
      req.file,
      parsed.data,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, document, 201);
  }),
);

/** Produces a PDF from a quotation or a payment Probild already holds. */
documentsRouter.post(
  '/generate',
  requirePermission(PERMISSIONS.DOCUMENT_WRITE),
  validate({ body: generateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const document = await documentsService.generateDocument(
      req.body as GenerateInput,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, document, 201);
  }),
);

/** Sends several documents to one client, as a single email. */
documentsRouter.post(
  '/send',
  requirePermission(PERMISSIONS.DOCUMENT_WRITE),
  validate({ body: sendDocumentsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { documentIds, ...rest } = req.body as SendDocumentsInput;
    const result = await documentsService.sendDocuments(
      documentIds,
      rest,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, result, result.sent ? 200 : 502);
  }),
);

documentsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.DOCUMENT_READ),
  validate({ params: documentIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await documentsService.getDocument(req.params.id as string));
  }),
);

documentsRouter.get(
  '/:id/download',
  requirePermission(PERMISSIONS.DOCUMENT_READ),
  validate({ params: documentIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { document, stream, filename } = await documentsService.openForDownload(
      req.params.id as string,
    );

    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Length', String(document.sizeBytes));
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}"`);
    // Never let a proxy or browser cache somebody else's client paperwork.
    res.setHeader('Cache-Control', 'private, no-store');

    stream.pipe(res);
  }),
);

documentsRouter.post(
  '/:id/send',
  requirePermission(PERMISSIONS.DOCUMENT_WRITE),
  validate({ params: documentIdParamsSchema, body: sendDocumentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await documentsService.sendDocument(
      req.params.id as string,
      req.body as SendDocumentInput,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, result, result.sent ? 200 : 502);
  }),
);

documentsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.DOCUMENT_DELETE),
  validate({ params: documentIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await documentsService.deleteDocument(req.params.id as string, auditContext(req));
    sendNoContent(res);
  }),
);
