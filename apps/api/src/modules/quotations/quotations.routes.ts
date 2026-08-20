import { Router } from 'express';
import type { Request, Response } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { auditContext } from '../audit/audit.service.js';
import * as quotationsService from './quotations.service.js';
import {
  changeQuotationStatusSchema,
  createQuotationSchema,
  listQuotationsQuerySchema,
  quotationIdParamsSchema,
  updateQuotationSchema,
  type ChangeQuotationStatusInput,
  type CreateQuotationInput,
  type ListQuotationsQuery,
  type UpdateQuotationInput,
} from './quotations.schemas.js';

export const quotationsRouter = Router();

quotationsRouter.use(requireAuth);

quotationsRouter.get(
  '/',
  requirePermission(PERMISSIONS.QUOTATION_READ),
  validate({ query: listQuotationsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await quotationsService.listQuotations(
      req.query as unknown as ListQuotationsQuery,
    );
    sendPaginated(res, result.items, result.meta);
  }),
);

quotationsRouter.post(
  '/',
  requirePermission(PERMISSIONS.QUOTATION_WRITE),
  validate({ body: createQuotationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const quotation = await quotationsService.createQuotation(
      req.body as CreateQuotationInput,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, quotation, 201);
  }),
);

quotationsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.QUOTATION_READ),
  validate({ params: quotationIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await quotationsService.getQuotation(req.params.id as string));
  }),
);

quotationsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.QUOTATION_WRITE),
  validate({ params: quotationIdParamsSchema, body: updateQuotationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const quotation = await quotationsService.updateQuotation(
      req.params.id as string,
      req.body as UpdateQuotationInput,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, quotation);
  }),
);

quotationsRouter.post(
  '/:id/status',
  requirePermission(PERMISSIONS.QUOTATION_WRITE),
  validate({ params: quotationIdParamsSchema, body: changeQuotationStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const quotation = await quotationsService.changeStatus(
      req.params.id as string,
      req.body as ChangeQuotationStatusInput,
      auditContext(req),
    );
    sendSuccess(res, quotation);
  }),
);

quotationsRouter.get(
  '/:id/pricing-history',
  requirePermission(PERMISSIONS.QUOTATION_READ),
  validate({ params: quotationIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await quotationsService.getPricingHistory(req.params.id as string));
  }),
);

quotationsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.QUOTATION_DELETE),
  validate({ params: quotationIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await quotationsService.deleteQuotation(req.params.id as string, auditContext(req));
    sendNoContent(res);
  }),
);
