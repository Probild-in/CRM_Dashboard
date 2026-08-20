import {
  AuditAction,
  CLOSED_TASK_STATUSES,
  EntityType,
  Priority,
  TaskStatus,
  canReadAll,
  type PaginatedResult,
  type UserRole,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { REFERENCE_PREFIX, nextReference } from '../../lib/reference.js';
import { recordAudit, type AuditInput } from '../audit/audit.service.js';
import {
  TASK_SORT_FIELDS,
  type ChangeTaskStatusInput,
  type CreateCommentInput,
  type CreateTaskInput,
  type ListTasksQuery,
  type UpdateTaskInput,
} from './tasks.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

export interface Actor {
  id: string;
  role: UserRole;
}

const taskSelect = {
  id: true,
  reference: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  startDate: true,
  dueAt: true,
  completedAt: true,
  estimatedHours: true,
  actualHours: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, reference: true, name: true, status: true } },
  milestone: { select: { id: true, name: true } },
  client: { select: { id: true, reference: true, companyName: true } },
  assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export interface TaskView extends Omit<TaskRow, 'estimatedHours' | 'actualHours'> {
  estimatedHours: number | null;
  actualHours: number | null;
  /**
   * Derived on every read. A late task keeps its real status — IN_PROGRESS,
   * BLOCKED — and reports lateness separately. Nothing ever writes an
   * "overdue" status, because that would destroy what the person was doing.
   */
  isOverdue: boolean;
  isDueToday: boolean;
  hoursUntilDue: number | null;
}

function toTaskView(task: TaskRow, now = new Date()): TaskView {
  const isOpen = !CLOSED_TASK_STATUSES.includes(task.status);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  return {
    ...task,
    estimatedHours: task.estimatedHours === null ? null : Number(task.estimatedHours),
    actualHours: task.actualHours === null ? null : Number(task.actualHours),
    isOverdue: isOpen && task.dueAt !== null && task.dueAt < now,
    isDueToday: isOpen && task.dueAt !== null && task.dueAt >= now && task.dueAt <= endOfToday,
    hoursUntilDue:
      task.dueAt === null
        ? null
        : Math.round(((task.dueAt.getTime() - now.getTime()) / 3_600_000) * 10) / 10,
  };
}

/**
 * Restricts a query to what the caller may see.
 *
 * Project managers and super admins see all work. Everyone else sees the tasks
 * assigned to them, plus anything on a project they are a member of — you need
 * the context of the work around yours.
 */
export function taskVisibilityFilter(actor: Actor): Prisma.TaskWhereInput {
  if (canReadAll(actor.role, 'task')) {
    return {};
  }
  return {
    OR: [
      { assigneeId: actor.id },
      { createdById: actor.id },
      { project: { members: { some: { userId: actor.id } } } },
    ],
  };
}

async function loadTask(id: string, actor: Actor): Promise<TaskRow> {
  const task = await prisma.task.findFirst({
    where: { id, deletedAt: null, ...taskVisibilityFilter(actor) },
    select: taskSelect,
  });
  if (!task) {
    throw new NotFoundError('Task');
  }
  return task;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listTasks(
  query: ListTasksQuery,
  actor: Actor,
): Promise<PaginatedResult<TaskView>> {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

  const where: Prisma.TaskWhereInput = {
    deletedAt: null,
    ...taskVisibilityFilter(actor),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.milestoneId ? { milestoneId: query.milestoneId } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.unassigned ? { assigneeId: null } : {}),
    ...(query.openOnly ? { status: { notIn: CLOSED_TASK_STATUSES } } : {}),
    ...(query.overdue ? { dueAt: { lt: now }, status: { notIn: CLOSED_TASK_STATUSES } } : {}),
    ...(query.dueToday
      ? { dueAt: { gte: now, lte: endOfToday }, status: { notIn: CLOSED_TASK_STATUSES } }
      : {}),
    ...(query.dueThisWeek
      ? { dueAt: { gte: now, lte: weekAhead }, status: { notIn: CLOSED_TASK_STATUSES } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { project: { name: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const sortBy = resolveSort(query.sortBy, TASK_SORT_FIELDS, 'dueAt');
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.task.findMany({
      where,
      select: taskSelect,
      // Tasks with no deadline sort last rather than first.
      orderBy: [{ [sortBy]: { sort: query.sortOrder, nulls: 'last' } }],
      skip,
      take,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    items: rows.map((row) => toTaskView(row, now)),
    meta: buildPaginationMeta(total, query),
  };
}

export async function getTask(id: string, actor: Actor): Promise<TaskView> {
  return toTaskView(await loadTask(id, actor));
}

export async function getTaskSummary(actor: Actor): Promise<{
  total: number;
  open: number;
  overdue: number;
  dueToday: number;
  unassigned: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<Priority, number>;
}> {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const scope: Prisma.TaskWhereInput = { deletedAt: null, ...taskVisibilityFilter(actor) };

  const [total, open, overdue, dueToday, unassigned, statuses, priorities] =
    await prisma.$transaction([
      prisma.task.count({ where: scope }),
      prisma.task.count({ where: { ...scope, status: { notIn: CLOSED_TASK_STATUSES } } }),
      prisma.task.count({
        where: { ...scope, status: { notIn: CLOSED_TASK_STATUSES }, dueAt: { lt: now } },
      }),
      prisma.task.count({
        where: {
          ...scope,
          status: { notIn: CLOSED_TASK_STATUSES },
          dueAt: { gte: now, lte: endOfToday },
        },
      }),
      prisma.task.count({
        where: { ...scope, assigneeId: null, status: { notIn: CLOSED_TASK_STATUSES } },
      }),
      prisma.task.groupBy({
        by: ['status'],
        where: scope,
        orderBy: { status: 'asc' },
        _count: true,
      }),
      prisma.task.groupBy({
        by: ['priority'],
        where: scope,
        orderBy: { priority: 'asc' },
        _count: true,
      }),
    ]);

  return {
    total,
    open,
    overdue,
    dueToday,
    unassigned,
    byStatus: statuses.reduce<Record<TaskStatus, number>>(
      (totals, group) => ({ ...totals, [group.status]: group._count }),
      { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, BLOCKED: 0, COMPLETED: 0, CANCELLED: 0 },
    ),
    byPriority: priorities.reduce<Record<Priority, number>>(
      (totals, group) => ({ ...totals, [group.priority]: group._count }),
      { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 },
    ),
  };
}

export async function listComments(id: string, actor: Actor) {
  await loadTask(id, actor);
  return prisma.taskComment.findMany({
    where: { taskId: id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/** A task on a project inherits that project's client, so both stay in step. */
async function resolveClientId(
  projectId: string | null | undefined,
  clientId: string | null | undefined,
): Promise<string | null> {
  if (!projectId) {
    return clientId ?? null;
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { clientId: true },
  });
  if (!project) {
    throw new UnprocessableError('That project no longer exists.');
  }
  return project.clientId;
}

export async function createTask(
  input: CreateTaskInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<TaskView> {
  const clientId = await resolveClientId(input.projectId, input.clientId);

  if (input.milestoneId) {
    const milestone = await prisma.milestone.count({
      where: { id: input.milestoneId, projectId: input.projectId ?? undefined, deletedAt: null },
    });
    if (milestone === 0) {
      throw new UnprocessableError('That milestone is not on this project.');
    }
  }

  const task = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, REFERENCE_PREFIX.TASK);
    return tx.task.create({
      data: {
        ...input,
        reference,
        clientId,
        createdById: actor.id,
        ...(input.status === TaskStatus.COMPLETED ? { completedAt: new Date() } : {}),
      },
      select: taskSelect,
    });
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.TASK,
    entityId: task.id,
    summary: `Created task ${task.reference} — ${task.title}`,
    newValue: { title: task.title, assigneeId: input.assigneeId ?? null, dueAt: input.dueAt },
  });

  return toTaskView(task);
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<TaskView> {
  const current = await loadTask(id, actor);

  if (input.milestoneId) {
    const milestone = await prisma.milestone.count({
      where: {
        id: input.milestoneId,
        projectId: current.project?.id ?? undefined,
        deletedAt: null,
      },
    });
    if (milestone === 0) {
      throw new UnprocessableError('That milestone is not on this project.');
    }
  }

  const updated = await prisma.task.update({
    where: { id },
    data: input as Prisma.TaskUpdateInput,
    select: taskSelect,
  });

  await recordAudit({
    ...audit,
    action: AuditAction.UPDATED,
    entityType: EntityType.TASK,
    entityId: id,
    summary: `Updated task ${current.reference}`,
    newValue: input as never,
  });

  return toTaskView(updated);
}

export async function changeTaskStatus(
  id: string,
  input: ChangeTaskStatusInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<TaskView> {
  const current = await loadTask(id, actor);
  if (current.status === input.status) {
    throw new UnprocessableError(`This task is already ${input.status.toLowerCase()}.`);
  }

  const completing = input.status === TaskStatus.COMPLETED;

  const updated = await prisma.task.update({
    where: { id },
    data: {
      status: input.status,
      completedAt: completing ? new Date() : null,
      ...(input.actualHours !== undefined && input.actualHours !== null
        ? { actualHours: input.actualHours }
        : {}),
    },
    select: taskSelect,
  });

  await recordAudit({
    ...audit,
    action: completing ? AuditAction.COMPLETED : AuditAction.STATUS_CHANGED,
    entityType: EntityType.TASK,
    entityId: id,
    summary: `${current.reference}: ${current.status} → ${input.status}`,
    previousValue: { status: current.status },
    newValue: { status: input.status, note: input.note ?? null },
  });

  return toTaskView(updated);
}

export async function assignTask(
  id: string,
  assigneeId: string | null,
  actor: Actor,
  audit: AuditMeta,
): Promise<TaskView> {
  const current = await loadTask(id, actor);

  if (assigneeId) {
    const assignee = await prisma.user.count({ where: { id: assigneeId, deletedAt: null } });
    if (assignee === 0) {
      throw new UnprocessableError('That team member no longer exists.');
    }
  }

  const updated = await prisma.task.update({
    where: { id },
    data: { assigneeId },
    select: taskSelect,
  });

  await recordAudit({
    ...audit,
    action: AuditAction.ASSIGNED,
    entityType: EntityType.TASK,
    entityId: id,
    summary: updated.assignee
      ? `${current.reference} assigned to ${updated.assignee.firstName} ${updated.assignee.lastName}`
      : `${current.reference} unassigned`,
    previousValue: { assigneeId: current.assignee?.id ?? null },
    newValue: { assigneeId },
  });

  return toTaskView(updated);
}

export async function addComment(
  id: string,
  input: CreateCommentInput,
  actor: Actor,
  audit: AuditMeta,
) {
  const task = await loadTask(id, actor);

  const comment = await prisma.taskComment.create({
    data: { taskId: id, userId: actor.id, body: input.body },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  await recordAudit({
    ...audit,
    action: AuditAction.UPDATED,
    entityType: EntityType.TASK,
    entityId: id,
    summary: `Commented on ${task.reference}`,
  });

  return comment;
}

export async function deleteTask(id: string, actor: Actor, audit: AuditMeta): Promise<void> {
  const current = await loadTask(id, actor);
  await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.TASK,
    entityId: id,
    summary: `Deleted task ${current.reference} — ${current.title}`,
  });
}
