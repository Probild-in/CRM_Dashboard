import { Router } from 'express';
import type { Request, Response } from 'express';
import { PERMISSIONS } from '@probild/shared';
import { asyncHandler, sendNoContent, sendPaginated, sendSuccess } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/rbac.js';
import { validate } from '../../middleware/validate.js';
import { auditContext } from '../audit/audit.service.js';
import * as meetingsService from './meetings.service.js';
import {
  calendarQuerySchema,
  changeMeetingStatusSchema,
  createMeetingSchema,
  listMeetingsQuerySchema,
  meetingIdParamsSchema,
  updateMeetingSchema,
  type CalendarQuery,
  type ChangeMeetingStatusInput,
  type CreateMeetingInput,
  type ListMeetingsQuery,
  type UpdateMeetingInput,
} from './meetings.schemas.js';

export const meetingsRouter = Router();

meetingsRouter.use(requireAuth);

function actor(req: Request): meetingsService.Actor {
  return { id: req.user!.id, role: req.user!.role };
}

/** Everything with a date in one window: meetings, task deadlines, deliveries. */
meetingsRouter.get(
  '/calendar',
  requirePermission(PERMISSIONS.MEETING_READ),
  validate({ query: calendarQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const entries = await meetingsService.getCalendar(
      req.query as unknown as CalendarQuery,
      actor(req),
    );
    sendSuccess(res, entries);
  }),
);

meetingsRouter.get(
  '/',
  requirePermission(PERMISSIONS.MEETING_READ),
  validate({ query: listMeetingsQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await meetingsService.listMeetings(req.query as unknown as ListMeetingsQuery);
    sendPaginated(res, result.items, result.meta);
  }),
);

meetingsRouter.post(
  '/',
  requirePermission(PERMISSIONS.MEETING_WRITE),
  validate({ body: createMeetingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const meeting = await meetingsService.createMeeting(
      req.body as CreateMeetingInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, meeting, 201);
  }),
);

meetingsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.MEETING_READ),
  validate({ params: meetingIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await meetingsService.getMeeting(req.params.id as string));
  }),
);

meetingsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.MEETING_WRITE),
  validate({ params: meetingIdParamsSchema, body: updateMeetingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const meeting = await meetingsService.updateMeeting(
      req.params.id as string,
      req.body as UpdateMeetingInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, meeting);
  }),
);

meetingsRouter.post(
  '/:id/status',
  requirePermission(PERMISSIONS.MEETING_WRITE),
  validate({ params: meetingIdParamsSchema, body: changeMeetingStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const meeting = await meetingsService.changeStatus(
      req.params.id as string,
      req.body as ChangeMeetingStatusInput,
      actor(req),
      auditContext(req),
    );
    sendSuccess(res, meeting);
  }),
);

meetingsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.MEETING_DELETE),
  validate({ params: meetingIdParamsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    await meetingsService.deleteMeeting(req.params.id as string, auditContext(req));
    sendNoContent(res);
  }),
);
