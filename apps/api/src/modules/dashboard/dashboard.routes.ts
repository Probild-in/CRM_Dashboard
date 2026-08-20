import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import * as dashboardService from './dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

/**
 * "Today" depends on where the reader is, so the viewer carries their own
 * timezone into every query.
 */
async function viewer(req: Request): Promise<dashboardService.Viewer> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { timezone: true },
  });
  return {
    id: req.user!.id,
    role: req.user!.role,
    timezone: user.timezone || env.DEFAULT_TIMEZONE,
  };
}

dashboardRouter.get(
  '/',
  requirePermission(PERMISSIONS.DASHBOARD_READ),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await dashboardService.getOverview(await viewer(req)));
  }),
);

const salesQuerySchema = z.object({
  months: z.coerce.number().int().min(3).max(24).default(6),
});

dashboardRouter.get(
  '/sales',
  requirePermission(PERMISSIONS.DASHBOARD_READ, PERMISSIONS.LEAD_READ),
  validate({ query: salesQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { months } = req.query as unknown as z.infer<typeof salesQuerySchema>;
    sendSuccess(res, await dashboardService.getSales(await viewer(req), months));
  }),
);

dashboardRouter.get(
  '/delivery',
  requirePermission(PERMISSIONS.DASHBOARD_READ, PERMISSIONS.PROJECT_READ),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await dashboardService.getDelivery(await viewer(req)));
  }),
);
