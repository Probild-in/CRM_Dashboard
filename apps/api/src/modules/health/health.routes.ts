import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, sendSuccess } from '../../lib/http.js';

export const healthRouter = Router();

/** Liveness: the process is up. Used by process supervisors. */
healthRouter.get('/', (_req, res) => {
  sendSuccess(res, { status: 'ok', uptime: Math.round(process.uptime()) });
});

/** Readiness: dependencies answer. Used by load balancers before routing traffic. */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    sendSuccess(res, {
      status: 'ready',
      database: { status: 'up', latencyMs: Date.now() - startedAt },
    });
  }),
);
