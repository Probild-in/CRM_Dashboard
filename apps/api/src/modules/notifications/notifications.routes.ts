import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { NotificationType } from '@probild/shared';
import { asyncHandler, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { paginationQuerySchema } from '../../lib/pagination.js';
import * as notifications from './notifications.service.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

const listQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  type: z.nativeEnum(NotificationType).optional(),
});

/** Notifications are personal — the caller only ever sees their own. */
notificationsRouter.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await notifications.list(
      req.user!.id,
      req.query as unknown as notifications.ListQuery,
    );
    sendPaginated(res, result.items, result.meta);
  }),
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, { count: await notifications.unreadCount(req.user!.id) });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, { marked: await notifications.markAllRead(req.user!.id) });
  }),
);

notificationsRouter.post(
  '/:id/read',
  validate({ params: z.object({ id: z.string().uuid('Not a valid notification id.') }) }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await notifications.markRead(req.user!.id, req.params.id as string));
  }),
);
