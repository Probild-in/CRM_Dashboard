import { z } from 'zod';
import { MeetingStatus } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const MEETING_SORT_FIELDS = ['startsAt', 'createdAt', 'status', 'title'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish();

export const meetingIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid meeting id.'),
});

const attendeeSchema = z.object({
  userId: z.string().uuid().nullish(),
  email: z.string().trim().email('That is not a valid email address.').nullish(),
  name: optionalText(150),
});

const baseMeetingSchema = z.object({
  title: z.string().trim().min(1, 'Give the meeting a title.').max(191),
  description: optionalText(5000),
  location: optionalText(255),
  meetingUrl: optionalText(512),
  leadId: z.string().uuid().nullish(),
  clientId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(64).default('Asia/Kolkata'),
  attendees: z.array(attendeeSchema).default([]),
  /** Ask Google for a Meet link when the organiser has a connected calendar. */
  createMeetLink: z.boolean().default(false),
});

export const createMeetingSchema = baseMeetingSchema
  .refine((data) => data.endsAt > data.startsAt, {
    path: ['endsAt'],
    message: 'A meeting has to end after it starts.',
  })
  // A meeting is *about* something; without a link it never appears on any profile.
  .refine((data) => Boolean(data.leadId || data.clientId || data.projectId), {
    path: ['clientId'],
    message: 'Attach the meeting to a lead, a client or a project.',
  });

export const updateMeetingSchema = baseMeetingSchema
  .omit({ leadId: true })
  .partial()
  .refine(
    (data) => !data.startsAt || !data.endsAt || data.endsAt > data.startsAt,
    { path: ['endsAt'], message: 'A meeting has to end after it starts.' },
  )
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const changeMeetingStatusSchema = z
  .object({
    status: z.nativeEnum(MeetingStatus),
    outcome: optionalText(5000),
  })
  .refine((data) => data.status !== MeetingStatus.COMPLETED || Boolean(data.outcome), {
    path: ['outcome'],
    message: 'Record what came out of the meeting.',
  });

export const listMeetingsQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(MeetingStatus).optional(),
  leadId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  organizerId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  upcoming: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/** The calendar view asks for a window rather than a page. */
export const calendarQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  includeTasks: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('true'),
  includeProjects: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('true'),
});

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;
export type ChangeMeetingStatusInput = z.infer<typeof changeMeetingStatusSchema>;
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
