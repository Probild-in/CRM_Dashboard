import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { EntityType, PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireSuperAdmin, requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../lib/prisma.js';
import { buildPaginationMeta, paginationQuerySchema, toSkipTake } from '../../lib/pagination.js';
import { run } from './engine.js';
import { SCAN_CRON, queueHealth } from './queue.js';

export const automationRouter = Router();

automationRouter.use(requireAuth);

/** What the engine is doing, and whether the worker can reach Redis. */
automationRouter.get(
  '/status',
  requirePermission(PERMISSIONS.SETTINGS_READ),
  asyncHandler(async (_req: Request, res: Response) => {
    const [queue, lastRun, total] = await Promise.all([
      queueHealth(),
      prisma.automationExecution.findFirst({
        orderBy: { executedAt: 'desc' },
        select: { executedAt: true, rule: true, entityType: true },
      }),
      prisma.automationExecution.count(),
    ]);

    sendSuccess(res, { schedule: SCAN_CRON, queue, lastRun, totalExecutions: total });
  }),
);

const listQuerySchema = paginationQuerySchema.extend({
  entityType: z.nativeEnum(EntityType).optional(),
  entityId: z.string().uuid().optional(),
});

/** The idempotency ledger, readable — every reminder the engine has ever sent. */
automationRouter.get(
  '/executions',
  requirePermission(PERMISSIONS.AUDIT_READ),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    const where = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const { skip, take } = toSkipTake(query);

    const [items, total] = await prisma.$transaction([
      prisma.automationExecution.findMany({
        where,
        orderBy: { executedAt: 'desc' },
        skip,
        take,
      }),
      prisma.automationExecution.count({ where }),
    ]);

    sendPaginated(res, items, buildPaginationMeta(total, query));
  }),
);

/**
 * Runs a scan now, in-process.
 *
 * The scheduled worker is the normal path; this exists so an administrator can
 * prove the engine works without waiting five minutes, and so the system is
 * usable at all when Redis is not running.
 */
automationRouter.post(
  '/run',
  requireSuperAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await run());
  }),
);
