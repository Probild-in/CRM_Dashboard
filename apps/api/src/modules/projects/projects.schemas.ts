import { z } from 'zod';
import { Currency, MilestoneStatus, Priority, ProjectStatus } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const PROJECT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'startDate',
  'deliveryDate',
  'value',
  'status',
  'priority',
  'progress',
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish();

export const projectIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid project id.'),
});

export const createProjectSchema = z
  .object({
    clientId: z.string().uuid('Choose the client this is for.'),
    dealId: z.string().uuid().nullish(),
    managerId: z.string().uuid().nullish(),
    name: z.string().trim().min(1, 'Give the project a name.').max(191),
    description: optionalText(5000),
    status: z.nativeEnum(ProjectStatus).default(ProjectStatus.PLANNING),
    priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
    value: z.coerce.number().min(0, 'Value cannot be negative.').max(9_999_999_999).default(0),
    currency: z.nativeEnum(Currency).default(Currency.INR),
    startDate: z.coerce.date().nullish(),
    deliveryDate: z.coerce.date().nullish(),
    serviceIds: z.array(z.string().uuid()).default([]),
    memberIds: z.array(z.string().uuid()).default([]),
  })
  .refine(
    (data) => !data.startDate || !data.deliveryDate || data.deliveryDate >= data.startDate,
    { path: ['deliveryDate'], message: 'Delivery cannot be before the start date.' },
  );

export const updateProjectSchema = z
  .object({
    managerId: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(191).optional(),
    description: optionalText(5000),
    priority: z.nativeEnum(Priority).optional(),
    value: z.coerce.number().min(0).max(9_999_999_999).optional(),
    currency: z.nativeEnum(Currency).optional(),
    startDate: z.coerce.date().nullish(),
    deliveryDate: z.coerce.date().nullish(),
    serviceIds: z.array(z.string().uuid()).optional(),
    valueChangeReason: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const changeProjectStatusSchema = z.object({
  status: z.nativeEnum(ProjectStatus),
  note: z.string().trim().max(500).optional(),
});

export const projectMemberSchema = z.object({
  userId: z.string().uuid('Choose a team member.'),
  roleLabel: z.string().trim().max(120).optional(),
});

export const memberParamsSchema = projectIdParamsSchema.extend({
  userId: z.string().uuid('Not a valid user id.'),
});

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(ProjectStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  clientId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  /** Delivery date already past, on a project that is not finished. */
  overdue: booleanFlag,
  /** Delivery date inside the next 14 days. */
  dueSoon: booleanFlag,
  /** Excludes completed and cancelled. */
  activeOnly: booleanFlag,
});

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

export const milestoneIdParamsSchema = z.object({
  milestoneId: z.string().uuid('Not a valid milestone id.'),
});

export const createMilestoneSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the milestone a name.').max(191),
    description: optionalText(2000),
    assigneeId: z.string().uuid().nullish(),
    status: z.nativeEnum(MilestoneStatus).default(MilestoneStatus.NOT_STARTED),
    startDate: z.coerce.date().nullish(),
    dueDate: z.coerce.date().nullish(),
    completionPercent: z.coerce.number().int().min(0).max(100).default(0),
  })
  .refine((data) => !data.startDate || !data.dueDate || data.dueDate >= data.startDate, {
    path: ['dueDate'],
    message: 'The due date cannot be before the start date.',
  });

export const updateMilestoneSchema = z
  .object({
    name: z.string().trim().min(1).max(191).optional(),
    description: optionalText(2000),
    assigneeId: z.string().uuid().nullish(),
    status: z.nativeEnum(MilestoneStatus).optional(),
    startDate: z.coerce.date().nullish(),
    dueDate: z.coerce.date().nullish(),
    completionPercent: z.coerce.number().int().min(0).max(100).optional(),
    position: z.coerce.number().int().min(0).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ChangeProjectStatusInput = z.infer<typeof changeProjectStatusSchema>;
export type ProjectMemberInput = z.infer<typeof projectMemberSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;
