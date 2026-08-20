import { Router } from 'express';
import type { Request, Response } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { auditContext } from '../audit/audit.service.js';
import * as dealsService from './deals.service.js';
import {
  changeDealStageSchema,
  createDealSchema,
  dealIdParamsSchema,
  listDealsQuerySchema,
  updateDealSchema,
  type ChangeDealStageInput,
  type CreateDealInput,
  type ListDealsQuery,
  type UpdateDealInput,
} from './deals.schemas.js';

export const dealsRouter = Router();

dealsRouter.use(requireAuth);

dealsRouter.get(
  '/',
  requirePermission(PERMISSIONS.DEAL_READ),
  validate({ query: listDealsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await dealsService.listDeals(req.query as unknown as ListDealsQuery);
    sendPaginated(res, result.items, result.meta);
  }),
);

dealsRouter.post(
  '/',
  requirePermission(PERMISSIONS.DEAL_WRITE),
  validate({ body: createDealSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const deal = await dealsService.createDeal(req.body as CreateDealInput, auditContext(req));
    sendSuccess(res, deal, 201);
  }),
);

dealsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.DEAL_READ),
  validate({ params: dealIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await dealsService.getDeal(req.params.id as string));
  }),
);

dealsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.DEAL_WRITE),
  validate({ params: dealIdParamsSchema, body: updateDealSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const deal = await dealsService.updateDeal(
      req.params.id as string,
      req.body as UpdateDealInput,
      req.user!.id,
      auditContext(req),
    );
    sendSuccess(res, deal);
  }),
);

dealsRouter.post(
  '/:id/stage',
  requirePermission(PERMISSIONS.DEAL_WRITE),
  validate({ params: dealIdParamsSchema, body: changeDealStageSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const deal = await dealsService.changeStage(
      req.params.id as string,
      req.body as ChangeDealStageInput,
      auditContext(req),
    );
    sendSuccess(res, deal);
  }),
);

dealsRouter.get(
  '/:id/pricing-history',
  requirePermission(PERMISSIONS.DEAL_READ),
  validate({ params: dealIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await dealsService.getPricingHistory(req.params.id as string));
  }),
);

dealsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.DEAL_DELETE),
  validate({ params: dealIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await dealsService.deleteDeal(req.params.id as string, auditContext(req));
    sendNoContent(res);
  }),
);
