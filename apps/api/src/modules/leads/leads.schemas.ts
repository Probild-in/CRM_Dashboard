import { z } from 'zod';
import {
  Currency,
  LeadSource,
  LeadStatus,
  LOGGABLE_ACTIVITY_TYPES,
  Priority,
} from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const LEAD_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'companyName',
  'expectedValue',
  'expectedCloseDate',
  'nextFollowUpAt',
  'lastContactedAt',
  'status',
  'priority',
] as const;

/** Trims, and turns an empty form field into an explicit null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish();

const optionalUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => value === '' || /^https?:\/\/\S+$/i.test(value), {
      message: 'Enter a full URL starting with http:// or https://',
    })
    .transform((value) => (value === '' ? null : value))
    .nullish();

export const leadIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid lead id.'),
});

export const createLeadSchema = z.object({
  companyName: z.string().trim().min(1, 'Enter the company name.').max(191),
  contactPerson: optionalText(150),
  email: z
    .string()
    .trim()
    .max(191)
    .refine((value) => value === '' || z.string().email().safeParse(value).success, {
      message: 'That is not a valid email address.',
    })
    .transform((value) => (value === '' ? null : value.toLowerCase()))
    .nullish(),
  phone: optionalText(32),
  whatsapp: optionalText(32),
  country: optionalText(80),
  city: optionalText(80),
  industry: optionalText(120),
  website: optionalUrl(255),
  linkedin: optionalUrl(255),

  source: z.nativeEnum(LeadSource).default(LeadSource.OTHER),
  interestedServiceId: z.string().uuid().nullish(),
  status: z.nativeEnum(LeadStatus).default(LeadStatus.NEW),
  priority: z.nativeEnum(Priority).default(Priority.MEDIUM),

  expectedValue: z.coerce.number().min(0, 'Value cannot be negative.').max(9_999_999_999).nullish(),
  currency: z.nativeEnum(Currency).default(Currency.INR),
  expectedCloseDate: z.coerce.date().nullish(),
  nextFollowUpAt: z.coerce.date().nullish(),
  lastContactedAt: z.coerce.date().nullish(),
  assignedToId: z.string().uuid().nullish(),
  lostReason: optionalText(255),
  notes: optionalText(5000),
});

export const updateLeadSchema = createLeadSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * A lead only becomes LOST with a reason recorded — otherwise the pipeline
 * loses the one piece of information that makes it worth reviewing.
 */
export const changeLeadStatusSchema = z
  .object({
    status: z.nativeEnum(LeadStatus),
    lostReason: optionalText(255),
    note: optionalText(1000),
  })
  .refine((data) => data.status !== LeadStatus.LOST || Boolean(data.lostReason), {
    path: ['lostReason'],
    message: 'Record why this lead was lost.',
  });

export const assignLeadSchema = z.object({
  assignedToId: z.string().uuid().nullable(),
});

export const createActivitySchema = z.object({
  type: z.enum(LOGGABLE_ACTIVITY_TYPES as [string, ...string[]]),
  title: z.string().trim().min(1, 'Give this entry a title.').max(191),
  body: optionalText(5000),
  occurredAt: z.coerce.date().optional(),
  /** Set the next follow-up in the same step, so it is never forgotten. */
  nextFollowUpAt: z.coerce.date().nullish(),
});

/** `true` and `false` arrive as strings on the query string. */
const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const listLeadsQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(LeadStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  source: z.nativeEnum(LeadSource).optional(),
  currency: z.nativeEnum(Currency).optional(),
  assignedToId: z.string().uuid().optional(),
  interestedServiceId: z.string().uuid().optional(),
  /** Only leads whose follow-up is already past. */
  followUpOverdue: booleanFlag,
  /** Only leads with a follow-up inside the next 7 days. */
  followUpThisWeek: booleanFlag,
  /** Excludes WON and LOST. */
  openOnly: booleanFlag,
  unassigned: booleanFlag,
  closeFrom: z.coerce.date().optional(),
  closeTo: z.coerce.date().optional(),
});

export const pipelineQuerySchema = z.object({
  assignedToId: z.string().uuid().optional(),
  /** Cap per column so a long pipeline cannot return everything at once. */
  limitPerStage: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;
export type ChangeLeadStatusInput = z.infer<typeof changeLeadStatusSchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type PipelineQuery = z.infer<typeof pipelineQuerySchema>;
