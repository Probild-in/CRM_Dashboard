import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { auditContext } from '../audit/audit.service.js';
import * as paymentsService from './payments.service.js';
import {
  cancelPaymentSchema,
  createPaymentSchema,
  listPaymentsQuerySchema,
  paymentIdParamsSchema,
  recordReceiptSchema,
  updatePaymentSchema,
  type CreatePaymentInput,
  type ListPaymentsQuery,
  type RecordReceiptInput,
  type UpdatePaymentInput,
} from './payments.schemas.js';

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

paymentsRouter.get(
  '/',
  requirePermission(PERMISSIONS.PAYMENT_READ),
  validate({ query: listPaymentsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentsService.listPayments(
      req.query as unknown as ListPaymentsQuery,
    );
    sendPaginated(res, result.items, result.meta);
  }),
);

paymentsRouter.get(
  '/summary',
  requirePermission(PERMISSIONS.PAYMENT_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await paymentsService.getSummary());
  }),
);

paymentsRouter.get(
  '/projects/:projectId/position',
  requirePermission(PERMISSIONS.PAYMENT_READ),
  validate({ params: z.object({ projectId: z.string().uuid('Not a valid project id.') }) }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await paymentsService.getProjectPosition(req.params.projectId as string));
  }),
);

paymentsRouter.post(
  '/',
  requirePermission(PERMISSIONS.PAYMENT_WRITE),
  validate({ body: createPaymentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const payment = await paymentsService.createPayment(
      req.body as CreatePaymentInput,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, payment, 201);
  }),
);

paymentsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.PAYMENT_READ),
  validate({ params: paymentIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await paymentsService.getPayment(req.params.id as string));
  }),
);

paymentsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.PAYMENT_WRITE),
  validate({ params: paymentIdParamsSchema, body: updatePaymentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const payment = await paymentsService.updatePayment(
      req.params.id as string,
      req.body as UpdatePaymentInput,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, payment);
  }),
);

/** Money arriving. The status follows from the arithmetic. */
paymentsRouter.post(
  '/:id/receipts',
  requirePermission(PERMISSIONS.PAYMENT_WRITE),
  validate({ params: paymentIdParamsSchema, body: recordReceiptSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const payment = await paymentsService.recordReceipt(
      req.params.id as string,
      req.body as RecordReceiptInput,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, payment);
  }),
);

paymentsRouter.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.PAYMENT_WRITE),
  validate({ params: paymentIdParamsSchema, body: cancelPaymentSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body as { reason: string };
    const payment = await paymentsService.cancelPayment(
      req.params.id as string,
      reason,
      auditContext(req),
    );
    sendSuccess(res, payment);
  }),
);

paymentsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.PAYMENT_DELETE),
  validate({ params: paymentIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await paymentsService.deletePayment(req.params.id as string, auditContext(req));
    sendNoContent(res);
  }),
);
