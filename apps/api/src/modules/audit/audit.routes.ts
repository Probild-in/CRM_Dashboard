import { Router } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { list, listAuditQuerySchema } from './audit.controller.js';

export const auditRouter = Router();

auditRouter.get(
  '/',
  requireAuth,
  requirePermission(PERMISSIONS.AUDIT_READ),
  validate({ query: listAuditQuerySchema }),
  asyncHandler(list),
);
