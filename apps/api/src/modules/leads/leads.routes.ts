import { Router } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './leads.controller.js';
import { convertLead } from '../clients/clients.controller.js';
import { convertLeadSchema } from '../clients/clients.schemas.js';
import {
  assignLeadSchema,
  changeLeadStatusSchema,
  createActivitySchema,
  createLeadSchema,
  leadIdParamsSchema,
  listLeadsQuerySchema,
  pipelineQuerySchema,
  updateLeadSchema,
} from './leads.schemas.js';

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

leadsRouter.get(
  '/',
  requirePermission(PERMISSIONS.LEAD_READ),
  validate({ query: listLeadsQuerySchema }),
  asyncHandler(controller.list),
);

leadsRouter.get(
  '/summary',
  requirePermission(PERMISSIONS.LEAD_READ),
  asyncHandler(controller.summary),
);

leadsRouter.get(
  '/pipeline',
  requirePermission(PERMISSIONS.LEAD_READ),
  validate({ query: pipelineQuerySchema }),
  asyncHandler(controller.pipeline),
);

leadsRouter.post(
  '/',
  requirePermission(PERMISSIONS.LEAD_WRITE),
  validate({ body: createLeadSchema }),
  asyncHandler(controller.create),
);

leadsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.LEAD_READ),
  validate({ params: leadIdParamsSchema }),
  asyncHandler(controller.getById),
);

leadsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.LEAD_WRITE),
  validate({ params: leadIdParamsSchema, body: updateLeadSchema }),
  asyncHandler(controller.update),
);

leadsRouter.post(
  '/:id/status',
  requirePermission(PERMISSIONS.LEAD_WRITE),
  validate({ params: leadIdParamsSchema, body: changeLeadStatusSchema }),
  asyncHandler(controller.changeStatus),
);

leadsRouter.post(
  '/:id/assign',
  requirePermission(PERMISSIONS.LEAD_ASSIGN),
  validate({ params: leadIdParamsSchema, body: assignLeadSchema }),
  asyncHandler(controller.assign),
);

leadsRouter.get(
  '/:id/activities',
  requirePermission(PERMISSIONS.LEAD_READ),
  validate({ params: leadIdParamsSchema }),
  asyncHandler(controller.activities),
);

leadsRouter.post(
  '/:id/activities',
  requirePermission(PERMISSIONS.LEAD_WRITE),
  validate({ params: leadIdParamsSchema, body: createActivitySchema }),
  asyncHandler(controller.addActivity),
);

// Conversion belongs to the lead's URL but is owned by the clients service.
leadsRouter.post(
  '/:id/convert',
  requirePermission(PERMISSIONS.LEAD_CONVERT, PERMISSIONS.CLIENT_WRITE),
  validate({ params: leadIdParamsSchema, body: convertLeadSchema }),
  asyncHandler(convertLead),
);

leadsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.LEAD_DELETE),
  validate({ params: leadIdParamsSchema }),
  asyncHandler(controller.remove),
);
