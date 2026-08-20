import { z } from 'zod';
import { Priority, TaskStatus } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const TASK_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'dueAt',
  'startDate',
  'title',
  'status',
  'priority',
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish();

export const taskIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid task id.'),
});

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the task a title.').max(191),
    description: optionalText(5000),
    projectId: z.string().uuid().nullish(),
    milestoneId: z.string().uuid().nullish(),
    clientId: z.string().uuid().nullish(),
    assigneeId: z.string().uuid().nullish(),
    status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
    priority: z.nativeEnum(Priority).default(Priority.MEDIUM),
    startDate: z.coerce.date().nullish(),
    /** One UTC instant. The UI splits it into a date and a time. */
    dueAt: z.coerce.date().nullish(),
    estimatedHours: z.coerce.number().min(0).max(9999).nullish(),
    actualHours: z.coerce.number().min(0).max(9999).nullish(),
  })
  .refine((data) => !data.milestoneId || Boolean(data.projectId), {
    path: ['milestoneId'],
    message: 'A milestone only makes sense inside a project.',
  });

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(191).optional(),
    description: optionalText(5000),
    milestoneId: z.string().uuid().nullish(),
    assigneeId: z.string().uuid().nullish(),
    priority: z.nativeEnum(Priority).optional(),
    startDate: z.coerce.date().nullish(),
    dueAt: z.coerce.date().nullish(),
    estimatedHours: z.coerce.number().min(0).max(9999).nullish(),
    actualHours: z.coerce.number().min(0).max(9999).nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Status is what the person doing the work says it is.
 *
 * There is deliberately no OVERDUE option: lateness is derived from `dueAt`
 * and reported alongside the status, so a late task keeps saying whether it is
 * in progress or blocked.
 */
export const changeTaskStatusSchema = z.object({
  status: z.nativeEnum(TaskStatus),
  actualHours: z.coerce.number().min(0).max(9999).nullish(),
  note: z.string().trim().max(500).optional(),
});

export const assignTaskSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(5000),
});

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  projectId: z.string().uuid().optional(),
  milestoneId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  /** Past its due time and not closed. */
  overdue: booleanFlag,
  /** Due before the end of today. */
  dueToday: booleanFlag,
  /** Due within the next seven days. */
  dueThisWeek: booleanFlag,
  /** Excludes completed and cancelled. */
  openOnly: booleanFlag,
  unassigned: booleanFlag,
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ChangeTaskStatusInput = z.infer<typeof changeTaskStatusSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
