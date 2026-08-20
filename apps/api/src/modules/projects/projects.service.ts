import {
  AuditAction,
  EntityType,
  MilestoneStatus,
  ProjectStatus,
  canReadAll,
  type PaginatedResult,
  type UserRole,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { REFERENCE_PREFIX, nextReference } from '../../lib/reference.js';
import { recordAudit, type AuditInput } from '../audit/audit.service.js';
import {
  PROJECT_SORT_FIELDS,
  type ChangeProjectStatusInput,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type ProjectMemberInput,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
} from './projects.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

export interface Actor {
  id: string;
  role: UserRole;
}

/** Projects that are finished or abandoned are never chased for being late. */
const CLOSED_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.COMPLETED,
  ProjectStatus.CANCELLED,
];

const projectSelect = {
  id: true,
  reference: true,
  name: true,
  description: true,
  status: true,
  priority: true,
  value: true,
  currency: true,
  startDate: true,
  deliveryDate: true,
  completedAt: true,
  progress: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, reference: true, companyName: true } },
  deal: { select: { id: true, reference: true, title: true } },
  manager: { select: { id: true, firstName: true, lastName: true, email: true } },
  members: {
    select: {
      id: true,
      roleLabel: true,
      joinedAt: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
    },
  },
  services: { select: { service: { select: { id: true, name: true } } } },
  _count: { select: { milestones: true, tasks: true } },
} satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

export interface ProjectView extends Omit<ProjectRow, 'value' | 'services'> {
  value: number;
  services: Array<{ id: string; name: string }>;
  /** Derived, never stored: past its delivery date and still open. */
  isOverdue: boolean;
  daysToDelivery: number | null;
}

function toProjectView(project: ProjectRow, now = new Date()): ProjectView {
  const isOpen = !CLOSED_PROJECT_STATUSES.includes(project.status);
  const daysToDelivery =
    project.deliveryDate === null
      ? null
      : Math.ceil((project.deliveryDate.getTime() - now.getTime()) / 86_400_000);

  return {
    ...project,
    value: Number(project.value),
    services: project.services.map((entry) => entry.service),
    isOverdue: isOpen && project.deliveryDate !== null && project.deliveryDate < now,
    daysToDelivery,
  };
}

/**
 * Restricts a query to what the caller may see.
 *
 * Project managers and super admins see everything being delivered. Everyone
 * else sees the projects they manage or are a member of — the work they are
 * actually part of.
 */
export function projectVisibilityFilter(actor: Actor): Prisma.ProjectWhereInput {
  if (canReadAll(actor.role, 'project')) {
    return {};
  }
  return {
    OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }],
  };
}

async function loadProject(id: string, actor: Actor): Promise<ProjectRow> {
  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null, ...projectVisibilityFilter(actor) },
    select: projectSelect,
  });
  if (!project) {
    throw new NotFoundError('Project');
  }
  return project;
}

/**
 * Recomputes a project's progress from its milestones.
 *
 * Progress is the average completion of the milestones that still count —
 * cancelled ones are excluded rather than dragging the number down. A project
 * with no milestones keeps whatever progress was set by hand.
 */
async function syncProgress(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
  const milestones = await tx.milestone.findMany({
    where: {
      projectId,
      deletedAt: null,
      status: { not: MilestoneStatus.CANCELLED },
    },
    select: { completionPercent: true },
  });

  if (milestones.length === 0) {
    return;
  }

  const total = milestones.reduce((sum, milestone) => sum + milestone.completionPercent, 0);
  await tx.project.update({
    where: { id: projectId },
    data: { progress: Math.round(total / milestones.length) },
  });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listProjects(
  query: ListProjectsQuery,
  actor: Actor,
): Promise<PaginatedResult<ProjectView>> {
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 86_400_000);

  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...projectVisibilityFilter(actor),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.managerId ? { managerId: query.managerId } : {}),
    ...(query.memberId ? { members: { some: { userId: query.memberId } } } : {}),
    ...(query.activeOnly ? { status: { notIn: CLOSED_PROJECT_STATUSES } } : {}),
    ...(query.overdue
      ? { deliveryDate: { lt: now }, status: { notIn: CLOSED_PROJECT_STATUSES } }
      : {}),
    ...(query.dueSoon
      ? {
          deliveryDate: { gte: now, lte: soon },
          status: { notIn: CLOSED_PROJECT_STATUSES },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
            { client: { companyName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const sortBy = resolveSort(query.sortBy, PROJECT_SORT_FIELDS, 'createdAt');
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      select: projectSelect,
      orderBy: { [sortBy]: query.sortOrder },
      skip,
      take,
    }),
    prisma.project.count({ where }),
  ]);

  return {
    items: rows.map((row) => toProjectView(row, now)),
    meta: buildPaginationMeta(total, query),
  };
}

export async function getProject(id: string, actor: Actor): Promise<ProjectView> {
  return toProjectView(await loadProject(id, actor));
}

export async function getProjectSummary(actor: Actor): Promise<{
  total: number;
  active: number;
  overdue: number;
  dueSoon: number;
  completed: number;
}> {
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 86_400_000);
  const scope: Prisma.ProjectWhereInput = { deletedAt: null, ...projectVisibilityFilter(actor) };

  const [total, active, overdue, dueSoon, completed] = await prisma.$transaction([
    prisma.project.count({ where: scope }),
    prisma.project.count({ where: { ...scope, status: { notIn: CLOSED_PROJECT_STATUSES } } }),
    prisma.project.count({
      where: { ...scope, status: { notIn: CLOSED_PROJECT_STATUSES }, deliveryDate: { lt: now } },
    }),
    prisma.project.count({
      where: {
        ...scope,
        status: { notIn: CLOSED_PROJECT_STATUSES },
        deliveryDate: { gte: now, lte: soon },
      },
    }),
    prisma.project.count({ where: { ...scope, status: ProjectStatus.COMPLETED } }),
  ]);

  return { total, active, overdue, dueSoon, completed };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createProject(
  input: CreateProjectInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<ProjectView> {
  const client = await prisma.client.count({ where: { id: input.clientId, deletedAt: null } });
  if (client === 0) {
    throw new UnprocessableError('That client no longer exists.');
  }

  const { serviceIds, memberIds, ...rest } = input;
  // Whoever manages the project is on the team by definition.
  const managerId = rest.managerId ?? actor.id;
  const uniqueMembers = Array.from(new Set([...memberIds, managerId]));

  const project = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, REFERENCE_PREFIX.PROJECT);

    return tx.project.create({
      data: {
        ...rest,
        managerId,
        reference,
        services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
        members: { create: uniqueMembers.map((userId) => ({ userId })) },
      },
      select: projectSelect,
    });
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.PROJECT,
    entityId: project.id,
    summary: `Created project ${project.reference} — ${project.name}`,
    newValue: {
      name: project.name,
      clientId: input.clientId,
      value: Number(project.value),
      currency: project.currency,
    },
  });

  return toProjectView(project);
}

export async function updateProject(
  id: string,
  input: UpdateProjectInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<ProjectView> {
  const current = await loadProject(id, actor);
  const { serviceIds, valueChangeReason, ...data } = input;

  const previousValue = Number(current.value);
  const valueChanged = data.value !== undefined && data.value !== previousValue;

  const updated = await prisma.$transaction(async (tx) => {
    if (serviceIds) {
      await tx.projectService.deleteMany({ where: { projectId: id } });
      await tx.projectService.createMany({
        data: serviceIds.map((serviceId) => ({ projectId: id, serviceId })),
      });
    }

    const project = await tx.project.update({
      where: { id },
      data: data as Prisma.ProjectUpdateInput,
      select: projectSelect,
    });

    // Project value is money; it never changes without a trail.
    if (valueChanged) {
      await tx.pricingHistory.create({
        data: {
          entityType: EntityType.PROJECT,
          entityId: id,
          changedById: actor.id,
          previousValue,
          newValue: data.value ?? 0,
          currency: project.currency,
          reason: valueChangeReason ?? 'Project value updated',
        },
      });
    }

    return project;
  });

  await recordAudit({
    ...audit,
    action: valueChanged ? AuditAction.VALUE_CHANGED : AuditAction.UPDATED,
    entityType: EntityType.PROJECT,
    entityId: id,
    summary: valueChanged
      ? `${current.reference}: value ${previousValue} → ${data.value}`
      : `Updated project ${current.reference}`,
    previousValue: valueChanged ? { value: previousValue } : undefined,
    newValue: valueChanged ? { value: data.value ?? 0 } : (data as never),
  });

  return toProjectView(updated);
}

export async function changeProjectStatus(
  id: string,
  input: ChangeProjectStatusInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<ProjectView> {
  const current = await loadProject(id, actor);
  if (current.status === input.status) {
    throw new UnprocessableError(`This project is already ${input.status.toLowerCase()}.`);
  }

  const completing = input.status === ProjectStatus.COMPLETED;

  const updated = await prisma.project.update({
    where: { id },
    data: {
      status: input.status,
      completedAt: completing ? new Date() : null,
      // Finishing a project means it is finished; the bar should say so.
      ...(completing ? { progress: 100 } : {}),
    },
    select: projectSelect,
  });

  await recordAudit({
    ...audit,
    action: AuditAction.STATUS_CHANGED,
    entityType: EntityType.PROJECT,
    entityId: id,
    summary: `${current.reference}: ${current.status} → ${input.status}`,
    previousValue: { status: current.status },
    newValue: { status: input.status, note: input.note ?? null },
  });

  return toProjectView(updated);
}

export async function deleteProject(id: string, actor: Actor, audit: AuditMeta): Promise<void> {
  const current = await loadProject(id, actor);

  await prisma.$transaction([
    prisma.project.update({ where: { id }, data: { deletedAt: new Date() } }),
    // Tasks belong to the project; hiding one without the other leaves orphans
    // showing up in everyone's task list.
    prisma.task.updateMany({
      where: { projectId: id, deletedAt: null },
      data: { deletedAt: new Date() },
    }),
  ]);

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.PROJECT,
    entityId: id,
    summary: `Deleted project ${current.reference} — ${current.name}`,
  });
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

export async function addMember(
  id: string,
  input: ProjectMemberInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<ProjectView> {
  const project = await loadProject(id, actor);

  const user = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!user) {
    throw new UnprocessableError('That team member no longer exists.');
  }

  const existing = await prisma.projectMember.count({
    where: { projectId: id, userId: input.userId },
  });
  if (existing > 0) {
    throw new ConflictError('They are already on this project.');
  }

  await prisma.projectMember.create({
    data: { projectId: id, userId: input.userId, roleLabel: input.roleLabel ?? null },
  });

  await recordAudit({
    ...audit,
    action: AuditAction.ASSIGNED,
    entityType: EntityType.PROJECT,
    entityId: id,
    summary: `Added ${user.firstName} ${user.lastName} to ${project.reference}`,
    newValue: { userId: input.userId, roleLabel: input.roleLabel ?? null },
  });

  return toProjectView(await loadProject(id, actor));
}

export async function removeMember(
  id: string,
  userId: string,
  actor: Actor,
  audit: AuditMeta,
): Promise<ProjectView> {
  const project = await loadProject(id, actor);

  if (project.manager?.id === userId) {
    throw new ConflictError(
      'The project manager cannot be removed from the team. Change the manager first.',
    );
  }

  const removed = await prisma.projectMember.deleteMany({ where: { projectId: id, userId } });
  if (removed.count === 0) {
    throw new NotFoundError('Team member');
  }

  await recordAudit({
    ...audit,
    action: AuditAction.UPDATED,
    entityType: EntityType.PROJECT,
    entityId: id,
    summary: `Removed a member from ${project.reference}`,
    previousValue: { userId },
  });

  return toProjectView(await loadProject(id, actor));
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

const milestoneSelect = {
  id: true,
  projectId: true,
  name: true,
  description: true,
  status: true,
  startDate: true,
  dueDate: true,
  completedAt: true,
  completionPercent: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { tasks: true } },
} satisfies Prisma.MilestoneSelect;

type MilestoneRow = Prisma.MilestoneGetPayload<{ select: typeof milestoneSelect }>;

export interface MilestoneView extends MilestoneRow {
  isOverdue: boolean;
}

function toMilestoneView(milestone: MilestoneRow, now = new Date()): MilestoneView {
  const isOpen =
    milestone.status !== MilestoneStatus.COMPLETED &&
    milestone.status !== MilestoneStatus.CANCELLED;
  return {
    ...milestone,
    isOverdue: isOpen && milestone.dueDate !== null && milestone.dueDate < now,
  };
}

export async function listMilestones(projectId: string, actor: Actor): Promise<MilestoneView[]> {
  await loadProject(projectId, actor);
  const now = new Date();
  const rows = await prisma.milestone.findMany({
    where: { projectId, deletedAt: null },
    select: milestoneSelect,
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((row) => toMilestoneView(row, now));
}

export async function createMilestone(
  projectId: string,
  input: CreateMilestoneInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<MilestoneView> {
  const project = await loadProject(projectId, actor);

  const milestone = await prisma.$transaction(async (tx) => {
    const last = await tx.milestone.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await tx.milestone.create({
      data: {
        ...input,
        projectId,
        position: (last?.position ?? -1) + 1,
        ...(input.status === MilestoneStatus.COMPLETED
          ? { completedAt: new Date(), completionPercent: 100 }
          : {}),
      },
      select: milestoneSelect,
    });

    await syncProgress(tx, projectId);
    return created;
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.MILESTONE,
    entityId: milestone.id,
    summary: `Added milestone "${milestone.name}" to ${project.reference}`,
  });

  return toMilestoneView(milestone);
}

export async function updateMilestone(
  projectId: string,
  milestoneId: string,
  input: UpdateMilestoneInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<MilestoneView> {
  await loadProject(projectId, actor);

  const current = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId, deletedAt: null },
    select: milestoneSelect,
  });
  if (!current) {
    throw new NotFoundError('Milestone');
  }

  const completing =
    input.status === MilestoneStatus.COMPLETED && current.status !== MilestoneStatus.COMPLETED;
  const reopening =
    input.status !== undefined &&
    input.status !== MilestoneStatus.COMPLETED &&
    current.status === MilestoneStatus.COMPLETED;

  const milestone = await prisma.$transaction(async (tx) => {
    const updated = await tx.milestone.update({
      where: { id: milestoneId },
      data: {
        ...input,
        // Marking a milestone done sets it to 100% — the two always agree.
        ...(completing ? { completedAt: new Date(), completionPercent: 100 } : {}),
        ...(reopening ? { completedAt: null } : {}),
      },
      select: milestoneSelect,
    });

    await syncProgress(tx, projectId);
    return updated;
  });

  await recordAudit({
    ...audit,
    action:
      input.status && input.status !== current.status
        ? AuditAction.STATUS_CHANGED
        : AuditAction.UPDATED,
    entityType: EntityType.MILESTONE,
    entityId: milestoneId,
    summary: `Updated milestone "${milestone.name}"`,
    previousValue: { status: current.status, completionPercent: current.completionPercent },
    newValue: { status: milestone.status, completionPercent: milestone.completionPercent },
  });

  return toMilestoneView(milestone);
}

export async function deleteMilestone(
  projectId: string,
  milestoneId: string,
  actor: Actor,
  audit: AuditMeta,
): Promise<void> {
  await loadProject(projectId, actor);

  const current = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId, deletedAt: null },
    select: { id: true, name: true, _count: { select: { tasks: true } } },
  });
  if (!current) {
    throw new NotFoundError('Milestone');
  }
  if (current._count.tasks > 0) {
    throw new ConflictError(
      'This milestone still has tasks. Move or close them before removing it.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.milestone.update({ where: { id: milestoneId }, data: { deletedAt: new Date() } });
    await syncProgress(tx, projectId);
  });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.MILESTONE,
    entityId: milestoneId,
    summary: `Removed milestone "${current.name}"`,
  });
}
