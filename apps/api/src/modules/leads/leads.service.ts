import {
  AuditAction,
  CONTACT_ACTIVITY_TYPES,
  EntityType,
  LeadActivityType,
  LeadStatus,
  PIPELINE_BOARD_STAGES,
  Priority,
  TERMINAL_LEAD_STATUSES,
  canReadAll,
  type Currency,
  type PaginatedResult,
  type UserRole,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { REFERENCE_PREFIX, nextReference } from '../../lib/reference.js';
import { diffFields, recordAudit, type AuditInput } from '../audit/audit.service.js';
import {
  LEAD_SORT_FIELDS,
  type ChangeLeadStatusInput,
  type CreateActivityInput,
  type CreateLeadInput,
  type ListLeadsQuery,
  type PipelineQuery,
  type UpdateLeadInput,
} from './leads.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

export interface Actor {
  id: string;
  role: UserRole;
}

const leadSelect = {
  id: true,
  reference: true,
  companyName: true,
  contactPerson: true,
  email: true,
  phone: true,
  whatsapp: true,
  country: true,
  city: true,
  industry: true,
  website: true,
  linkedin: true,
  source: true,
  status: true,
  priority: true,
  expectedValue: true,
  currency: true,
  expectedCloseDate: true,
  nextFollowUpAt: true,
  lastContactedAt: true,
  lostReason: true,
  notes: true,
  convertedClientId: true,
  convertedAt: true,
  createdAt: true,
  updatedAt: true,
  interestedService: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof leadSelect }>;

export interface LeadView extends Omit<LeadRow, 'expectedValue'> {
  expectedValue: number | null;
  /** Derived, never stored: a follow-up date in the past on an open lead. */
  isFollowUpOverdue: boolean;
}

function toLeadView(lead: LeadRow, now = new Date()): LeadView {
  const isOpen = !TERMINAL_LEAD_STATUSES.includes(lead.status);
  return {
    ...lead,
    expectedValue: lead.expectedValue === null ? null : Number(lead.expectedValue),
    isFollowUpOverdue: isOpen && lead.nextFollowUpAt !== null && lead.nextFollowUpAt < now,
  };
}

/**
 * Restricts a query to what the caller may see.
 *
 * Sales and super admins see the whole pipeline — Probild works leads as a
 * team. Everyone else sees only what is assigned to them.
 */
export function visibilityFilter(actor: Actor): Prisma.LeadWhereInput {
  return canReadAll(actor.role, 'lead') ? {} : { assignedToId: actor.id };
}

async function loadLeadOrThrow(id: string, actor: Actor): Promise<LeadRow> {
  const lead = await prisma.lead.findFirst({
    where: { id, deletedAt: null, ...visibilityFilter(actor) },
    select: leadSelect,
  });
  if (!lead) {
    // Same response whether it is missing or not visible: knowing a lead exists
    // is itself information the caller has not earned.
    throw new NotFoundError('Lead');
  }
  return lead;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listLeads(
  query: ListLeadsQuery,
  actor: Actor,
): Promise<PaginatedResult<LeadView>> {
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

  const where: Prisma.LeadWhereInput = {
    deletedAt: null,
    ...visibilityFilter(actor),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.currency ? { currency: query.currency } : {}),
    ...(query.interestedServiceId ? { interestedServiceId: query.interestedServiceId } : {}),
    ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
    ...(query.unassigned ? { assignedToId: null } : {}),
    ...(query.openOnly ? { status: { notIn: TERMINAL_LEAD_STATUSES } } : {}),
    ...(query.followUpOverdue
      ? { nextFollowUpAt: { lt: now }, status: { notIn: TERMINAL_LEAD_STATUSES } }
      : {}),
    ...(query.followUpThisWeek
      ? {
          nextFollowUpAt: { gte: now, lte: weekAhead },
          status: { notIn: TERMINAL_LEAD_STATUSES },
        }
      : {}),
    ...(query.closeFrom || query.closeTo
      ? {
          expectedCloseDate: {
            ...(query.closeFrom ? { gte: query.closeFrom } : {}),
            ...(query.closeTo ? { lte: query.closeTo } : {}),
          },
        }
      : {}),
    ...(query.search ? { OR: searchClauses(query.search) } : {}),
  };

  const sortBy = resolveSort(query.sortBy, LEAD_SORT_FIELDS, 'createdAt');
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      select: leadSelect,
      orderBy: { [sortBy]: query.sortOrder },
      skip,
      take,
    }),
    prisma.lead.count({ where }),
  ]);

  return { items: rows.map((row) => toLeadView(row, now)), meta: buildPaginationMeta(total, query) };
}

export function searchClauses(term: string): Prisma.LeadWhereInput[] {
  return [
    { companyName: { contains: term, mode: 'insensitive' } },
    { contactPerson: { contains: term, mode: 'insensitive' } },
    { email: { contains: term, mode: 'insensitive' } },
    { phone: { contains: term, mode: 'insensitive' } },
    { reference: { contains: term, mode: 'insensitive' } },
    { city: { contains: term, mode: 'insensitive' } },
    { industry: { contains: term, mode: 'insensitive' } },
  ];
}

export async function getLead(id: string, actor: Actor): Promise<LeadView> {
  return toLeadView(await loadLeadOrThrow(id, actor));
}

export interface PipelineStage {
  status: LeadStatus;
  count: number;
  /** Totals are per currency — INR and USD are never added together. */
  value: Record<Currency, number>;
  leads: LeadView[];
}

/**
 * The board: one column per open stage, plus the count and value of what has
 * been won and lost so the totals still balance.
 */
export async function getPipeline(
  query: PipelineQuery,
  actor: Actor,
): Promise<{ stages: PipelineStage[]; closed: { won: PipelineStage; lost: PipelineStage } }> {
  const now = new Date();
  const baseWhere: Prisma.LeadWhereInput = {
    deletedAt: null,
    ...visibilityFilter(actor),
    ...(query.assignedToId ? { assignedToId: query.assignedToId } : {}),
  };

  const rows = await prisma.lead.findMany({
    where: { ...baseWhere, status: { in: PIPELINE_BOARD_STAGES } },
    select: leadSelect,
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
  });

  /*
   * Column totals come from the database, not from the capped `rows` above, so
   * they stay correct however many leads a stage holds. Prisma's groupBy return
   * type does not narrow when _count and _sum are combined, hence the shape
   * declared here.
   */
  const grouped = (await prisma.lead.groupBy({
    by: ['status', 'currency'],
    where: baseWhere,
    orderBy: { status: 'asc' },
    _count: { _all: true },
    _sum: { expectedValue: true },
  })) as unknown as Array<{
    status: LeadStatus;
    currency: Currency;
    _count: { _all: number };
    _sum: { expectedValue: Prisma.Decimal | null };
  }>;

  const totalsFor = (status: LeadStatus): Pick<PipelineStage, 'count' | 'value'> => {
    const matching = grouped.filter((group) => group.status === status);
    return {
      count: matching.reduce((sum, group) => sum + group._count._all, 0),
      value: matching.reduce<Record<Currency, number>>(
        (totals, group) => ({
          ...totals,
          [group.currency]: Number(group._sum.expectedValue ?? 0),
        }),
        { INR: 0, USD: 0 },
      ),
    };
  };

  const views = rows.map((row) => toLeadView(row, now));

  const stages = PIPELINE_BOARD_STAGES.map((status) => ({
    status,
    ...totalsFor(status),
    leads: views.filter((lead) => lead.status === status).slice(0, query.limitPerStage),
  }));

  return {
    stages,
    closed: {
      won: { status: LeadStatus.WON, ...totalsFor(LeadStatus.WON), leads: [] },
      lost: { status: LeadStatus.LOST, ...totalsFor(LeadStatus.LOST), leads: [] },
    },
  };
}

export async function listActivities(id: string, actor: Actor) {
  await loadLeadOrThrow(id, actor);
  return prisma.leadActivity.findMany({
    where: { leadId: id },
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createLead(
  input: CreateLeadInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<LeadView> {
  const { expectedValue, ...rest } = input;

  const lead = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, REFERENCE_PREFIX.LEAD);

    const created = await tx.lead.create({
      data: {
        ...rest,
        reference,
        expectedValue: expectedValue ?? null,
        // An unassigned lead belongs to nobody and gets chased by nobody.
        assignedToId: rest.assignedToId ?? actor.id,
        createdById: actor.id,
      },
      select: leadSelect,
    });

    await tx.leadActivity.create({
      data: {
        leadId: created.id,
        userId: actor.id,
        type: LeadActivityType.CREATED,
        title: `Lead created from ${created.source.toLowerCase().replace(/_/g, ' ')}`,
        toValue: created.status,
      },
    });

    return created;
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.LEAD,
    entityId: lead.id,
    summary: `Created lead ${lead.reference} — ${lead.companyName}`,
    newValue: { companyName: lead.companyName, status: lead.status, reference: lead.reference },
  });

  return toLeadView(lead);
}

export async function updateLead(
  id: string,
  input: UpdateLeadInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<LeadView> {
  const current = await loadLeadOrThrow(id, actor);

  if (current.convertedClientId) {
    throw new ConflictError(
      'This lead has been converted to a client. Edit the client record instead.',
    );
  }
  if (input.status && input.status !== current.status) {
    throw new UnprocessableError(
      'Use the status action to move a lead through the pipeline, so the change is recorded.',
    );
  }

  const { expectedValue, ...rest } = input;
  const data: Prisma.LeadUpdateInput = {
    ...(rest as Prisma.LeadUpdateInput),
    ...(expectedValue !== undefined ? { expectedValue: expectedValue ?? null } : {}),
  };

  const previousValue = current.expectedValue === null ? null : Number(current.expectedValue);
  const valueChanged =
    expectedValue !== undefined && (expectedValue ?? null) !== previousValue;
  const followUpChanged =
    input.nextFollowUpAt !== undefined &&
    String(input.nextFollowUpAt ?? null) !== String(current.nextFollowUpAt ?? null);

  const updated = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({ where: { id }, data, select: leadSelect });

    // Expected value is money. It is never overwritten without a trail.
    if (valueChanged) {
      await tx.pricingHistory.create({
        data: {
          entityType: EntityType.LEAD,
          entityId: id,
          changedById: actor.id,
          previousValue,
          newValue: expectedValue ?? 0,
          currency: lead.currency,
          reason: 'Expected value updated on the lead',
        },
      });
      await tx.leadActivity.create({
        data: {
          leadId: id,
          userId: actor.id,
          type: LeadActivityType.VALUE_CHANGE,
          title: 'Expected value changed',
          fromValue: previousValue === null ? null : String(previousValue),
          toValue: String(expectedValue ?? 0),
        },
      });
    }

    if (followUpChanged) {
      await tx.leadActivity.create({
        data: {
          leadId: id,
          userId: actor.id,
          type: LeadActivityType.FOLLOW_UP_SET,
          title: input.nextFollowUpAt ? 'Follow-up scheduled' : 'Follow-up cleared',
          fromValue: current.nextFollowUpAt?.toISOString() ?? null,
          toValue: input.nextFollowUpAt?.toISOString() ?? null,
        },
      });
    }

    return lead;
  });

  const changes = diffFields(current as unknown as Record<string, unknown>, data as never);
  if (changes) {
    await recordAudit({
      ...audit,
      action: valueChanged ? AuditAction.VALUE_CHANGED : AuditAction.UPDATED,
      entityType: EntityType.LEAD,
      entityId: id,
      summary: `Updated lead ${current.reference}`,
      previousValue: changes.previous as never,
      newValue: changes.next as never,
    });
  }

  return toLeadView(updated);
}

/** Moves a lead through the pipeline and writes the move to its history. */
export async function changeStatus(
  id: string,
  input: ChangeLeadStatusInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<LeadView> {
  const current = await loadLeadOrThrow(id, actor);

  if (current.convertedClientId) {
    throw new ConflictError('This lead has been converted to a client and is now read-only.');
  }
  if (current.status === input.status) {
    throw new UnprocessableError(`This lead is already at ${input.status}.`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id },
      data: {
        status: input.status,
        lostReason: input.status === LeadStatus.LOST ? (input.lostReason ?? null) : null,
        // Reaching a decision is contact, so the clock resets.
        ...(TERMINAL_LEAD_STATUSES.includes(input.status) ? { nextFollowUpAt: null } : {}),
      },
      select: leadSelect,
    });

    await tx.leadActivity.create({
      data: {
        leadId: id,
        userId: actor.id,
        type: LeadActivityType.STATUS_CHANGE,
        title: `Moved to ${input.status.replace(/_/g, ' ').toLowerCase()}`,
        body: input.note ?? input.lostReason ?? null,
        fromValue: current.status,
        toValue: input.status,
      },
    });

    return lead;
  });

  await recordAudit({
    ...audit,
    action: AuditAction.STATUS_CHANGED,
    entityType: EntityType.LEAD,
    entityId: id,
    summary: `${current.reference}: ${current.status} → ${input.status}`,
    previousValue: { status: current.status },
    newValue: { status: input.status, lostReason: input.lostReason ?? null },
  });

  return toLeadView(updated);
}

export async function assignLead(
  id: string,
  assignedToId: string | null,
  actor: Actor,
  audit: AuditMeta,
): Promise<LeadView> {
  const current = await loadLeadOrThrow(id, actor);

  if (assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assignedToId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!assignee) {
      throw new UnprocessableError('That team member no longer exists.');
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({ where: { id }, data: { assignedToId }, select: leadSelect });

    await tx.leadActivity.create({
      data: {
        leadId: id,
        userId: actor.id,
        type: LeadActivityType.ASSIGNED,
        title: lead.assignedTo
          ? `Assigned to ${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
          : 'Assignment removed',
        fromValue: current.assignedTo
          ? `${current.assignedTo.firstName} ${current.assignedTo.lastName}`
          : null,
        toValue: lead.assignedTo ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}` : null,
      },
    });

    return lead;
  });

  await recordAudit({
    ...audit,
    action: AuditAction.ASSIGNED,
    entityType: EntityType.LEAD,
    entityId: id,
    summary: `Reassigned lead ${current.reference}`,
    previousValue: { assignedToId: current.assignedTo?.id ?? null },
    newValue: { assignedToId },
  });

  return toLeadView(updated);
}

/**
 * Logs a call, email, meeting or note.
 *
 * Contact types move `lastContactedAt`, and the caller can set the next
 * follow-up in the same step — the point is to enter it once.
 */
export async function addActivity(
  id: string,
  input: CreateActivityInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<LeadView> {
  const current = await loadLeadOrThrow(id, actor);
  const occurredAt = input.occurredAt ?? new Date();
  const isContact = CONTACT_ACTIVITY_TYPES.includes(input.type as LeadActivityType);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.leadActivity.create({
      data: {
        leadId: id,
        userId: actor.id,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        occurredAt,
      },
    });

    if (input.nextFollowUpAt !== undefined) {
      await tx.leadActivity.create({
        data: {
          leadId: id,
          userId: actor.id,
          type: LeadActivityType.FOLLOW_UP_SET,
          title: input.nextFollowUpAt ? 'Follow-up scheduled' : 'Follow-up cleared',
          fromValue: current.nextFollowUpAt?.toISOString() ?? null,
          toValue: input.nextFollowUpAt?.toISOString() ?? null,
        },
      });
    }

    return tx.lead.update({
      where: { id },
      data: {
        ...(isContact ? { lastContactedAt: occurredAt } : {}),
        ...(input.nextFollowUpAt !== undefined
          ? { nextFollowUpAt: input.nextFollowUpAt ?? null }
          : {}),
      },
      select: leadSelect,
    });
  });

  await recordAudit({
    ...audit,
    action: AuditAction.UPDATED,
    entityType: EntityType.LEAD,
    entityId: id,
    summary: `Logged ${input.type.toLowerCase()} on ${current.reference}`,
    newValue: { type: input.type, title: input.title },
  });

  return toLeadView(updated);
}

export async function deleteLead(id: string, actor: Actor, audit: AuditMeta): Promise<void> {
  const current = await loadLeadOrThrow(id, actor);

  if (current.convertedClientId) {
    throw new ConflictError('This lead became a client and cannot be deleted.');
  }

  await prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.LEAD,
    entityId: id,
    summary: `Deleted lead ${current.reference} — ${current.companyName}`,
  });
}

/** Counts used by the leads screen header. */
export async function getLeadSummary(actor: Actor): Promise<{
  total: number;
  open: number;
  followUpOverdue: number;
  unassigned: number;
  byPriority: Record<Priority, number>;
}> {
  const now = new Date();
  const scope: Prisma.LeadWhereInput = { deletedAt: null, ...visibilityFilter(actor) };

  const [total, open, followUpOverdue, unassigned, priorities] = await prisma.$transaction([
    prisma.lead.count({ where: scope }),
    prisma.lead.count({ where: { ...scope, status: { notIn: TERMINAL_LEAD_STATUSES } } }),
    prisma.lead.count({
      where: { ...scope, status: { notIn: TERMINAL_LEAD_STATUSES }, nextFollowUpAt: { lt: now } },
    }),
    prisma.lead.count({ where: { ...scope, assignedToId: null } }),
    prisma.lead.groupBy({
      by: ['priority'],
      where: scope,
      orderBy: { priority: 'asc' },
      _count: true,
    }),
  ]);

  return {
    total,
    open,
    followUpOverdue,
    unassigned,
    byPriority: priorities.reduce<Record<Priority, number>>(
      (totals, group) => ({ ...totals, [group.priority]: group._count }),
      { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 },
    ),
  };
}
