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
import * as reports from './reports.service.js';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);
reportsRouter.use(requirePermission(PERMISSIONS.REPORT_READ));

/** Windows are bounded by the reader's wall clock, so months line up. */
async function viewer(req: Request): Promise<reports.Viewer> {
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

const windowSchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});

reportsRouter.get(
  '/revenue',
  validate({ query: windowSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { months } = req.query as unknown as z.infer<typeof windowSchema>;
    sendSuccess(res, await reports.revenueReport(await viewer(req), months));
  }),
);

reportsRouter.get(
  '/sales',
  validate({ query: windowSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { months } = req.query as unknown as z.infer<typeof windowSchema>;
    sendSuccess(res, await reports.salesReport(await viewer(req), months));
  }),
);

reportsRouter.get(
  '/projects',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await reports.projectReport(await viewer(req)));
  }),
);

reportsRouter.get(
  '/outstanding',
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await reports.outstandingReport());
  }),
);
