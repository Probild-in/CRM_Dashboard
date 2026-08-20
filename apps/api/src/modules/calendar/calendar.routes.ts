import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@probild/shared';
import { env } from '../../config/env.js';
import { asyncHandler, sendNoContent, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { auditContext } from '../audit/audit.service.js';
import { logger } from '../../lib/logger.js';
import * as calendarService from './calendar.service.js';
import { isGoogleConfigured } from './google.client.js';
import { syncTaskDeadline } from '../meetings/meetings.service.js';

export const calendarRouter = Router();

/** Where to send the browser once the OAuth round trip finishes. */
function webReturnUrl(outcome: 'connected' | 'failed', detail?: string): string {
  const base = env.CORS_ORIGINS[0] ?? 'http://localhost:5173';
  const params = new URLSearchParams({ google: outcome, ...(detail ? { reason: detail } : {}) });
  return `${base}/settings?${params.toString()}`;
}

/*
 * The callback is the one route Google itself calls, so it cannot carry a
 * bearer token — it is authenticated by the signed `state` instead, and is
 * registered before the auth middleware.
 */
calendarRouter.get(
  '/google/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;

    if (error || !code || !state) {
      res.redirect(webReturnUrl('failed', error ?? 'missing_code'));
      return;
    }

    const userId = calendarService.verifyState(state);
    if (!userId) {
      res.redirect(webReturnUrl('failed', 'invalid_state'));
      return;
    }

    try {
      await calendarService.completeConnection(userId, code, {
        userId,
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      res.redirect(webReturnUrl('connected'));
    } catch (caught) {
      logger.error({ err: caught, userId }, 'Google Calendar connection failed');
      res.redirect(webReturnUrl('failed', 'exchange_failed'));
    }
  }),
);

calendarRouter.use(requireAuth);

calendarRouter.get(
  '/connection',
  asyncHandler(async (req: Request, res: Response) => {
    const connection = await calendarService.getConnection(req.user!.id);
    sendSuccess(res, { configured: isGoogleConfigured(), connection });
  }),
);

calendarRouter.post(
  '/google/connect',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, { authUrl: calendarService.connectUrl(req.user!.id) });
  }),
);

const preferencesSchema = z
  .object({
    syncMeetings: z.boolean().optional(),
    syncTasks: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one setting to change.',
  });

calendarRouter.patch(
  '/connection',
  validate({ body: preferencesSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const connection = await calendarService.updateConnection(
      req.user!.id,
      req.body as z.infer<typeof preferencesSchema>,
    );
    sendSuccess(res, connection);
  }),
);

calendarRouter.delete(
  '/connection',
  asyncHandler(async (req: Request, res: Response) => {
    await calendarService.disconnect(req.user!.id, auditContext(req));
    sendNoContent(res);
  }),
);

calendarRouter.post(
  '/sync',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await calendarService.pullChanges(req.user!.id));
  }),
);

const taskParamsSchema = z.object({ taskId: z.string().uuid('Not a valid task id.') });

/** Mirror one task deadline onto the assignee's calendar, on demand. */
calendarRouter.post(
  '/tasks/:taskId',
  requirePermission(PERMISSIONS.TASK_WRITE),
  validate({ params: taskParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const synced = await syncTaskDeadline(req.params.taskId as string);
    sendSuccess(res, { synced });
  }),
);
