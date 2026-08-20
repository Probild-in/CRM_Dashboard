import {
  AuditAction,
  DealStage,
  EntityType,
  QuotationStatus,
  type PaginatedResult,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { REFERENCE_PREFIX, nextReference } from '../../lib/reference.js';
import { recordAudit, type AuditInput } from '../audit/audit.service.js';
import { computeTotals } from './quotations.totals.js';
import {
  QUOTATION_SORT_FIELDS,
  type ChangeQuotationStatusInput,
  type CreateQuotationInput,
  type ListQuotationsQuery,
  type UpdateQuotationInput,
} from './quotations.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

/** Once a client has accepted or rejected, the figures are settled. */
const LOCKED_STATUSES: QuotationStatus[] = [QuotationStatus.ACCEPTED, QuotationStatus.REJECTED];

/**
 * Which moves are allowed from each status.
 *
 * Accepted and rejected are the client's decision and end the negotiation;
 * an expired quotation can be reopened into negotiation and revised.
 */
const ALLOWED_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  DRAFT: [QuotationStatus.SENT],
  SENT: [
    QuotationStatus.VIEWED,
    QuotationStatus.NEGOTIATION,
    QuotationStatus.ACCEPTED,
    QuotationStatus.REJECTED,
    QuotationStatus.EXPIRED,
  ],
  VIEWED: [
    QuotationStatus.NEGOTIATION,
    QuotationStatus.ACCEPTED,
    QuotationStatus.REJECTED,
    QuotationStatus.EXPIRED,
  ],
  NEGOTIATION: [
    QuotationStatus.SENT,
    QuotationStatus.ACCEPTED,
    QuotationStatus.REJECTED,
    QuotationStatus.EXPIRED,
  ],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [QuotationStatus.NEGOTIATION],
};

const quotationSelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  currency: true,
  issueDate: true,
  validUntil: true,
  subtotal: true,
  discountAmount: true,
  taxPercent: true,
  taxAmount: true,
  total: true,
  paymentTerms: true,
  notes: true,
  sentAt: true,
  viewedAt: true,
  decidedAt: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, reference: true, companyName: true } },
  lead: { select: { id: true, reference: true, companyName: true } },
  deal: { select: { id: true, reference: true, title: true, stage: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      discountPercent: true,
      lineTotal: true,
      position: true,
      service: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.QuotationSelect;

type QuotationRow = Prisma.QuotationGetPayload<{ select: typeof quotationSelect }>;

export interface QuotationView
  extends Omit<
    QuotationRow,
    'subtotal' | 'discountAmount' | 'taxPercent' | 'taxAmount' | 'total' | 'items'
  > {
  subtotal: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    lineTotal: number;
    position: number;
    service: { id: string; name: string } | null;
  }>;
  /** Derived: past its validity date and still undecided. */
  isExpired: boolean;
}

function toQuotationView(quotation: QuotationRow, now = new Date()): QuotationView {
  const undecided = !LOCKED_STATUSES.includes(quotation.status) &&
    quotation.status !== QuotationStatus.EXPIRED;

  return {
    ...quotation,
    subtotal: Number(quotation.subtotal),
    discountAmount: Number(quotation.discountAmount),
    taxPercent: Number(quotation.taxPercent),
    taxAmount: Number(quotation.taxAmount),
    total: Number(quotation.total),
    items: quotation.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      discountPercent: Number(item.discountPercent),
      lineTotal: Number(item.lineTotal),
    })),
    isExpired: undecided && quotation.validUntil !== null && quotation.validUntil < now,
  };
}

async function loadQuotation(id: string): Promise<QuotationRow> {
  const quotation = await prisma.quotation.findFirst({
    where: { id, deletedAt: null },
    select: quotationSelect,
  });
  if (!quotation) {
    throw new NotFoundError('Quotation');
  }
  return quotation;
}

export async function listQuotations(
  query: ListQuotationsQuery,
): Promise<PaginatedResult<QuotationView>> {
  const now = new Date();

  const where: Prisma.QuotationWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.dealId ? { dealId: query.dealId } : {}),
    ...(query.currency ? { currency: query.currency } : {}),
    ...(query.expiringSoon
      ? {
          validUntil: { lt: new Date(now.getTime() + 7 * 86_400_000) },
          status: { notIn: [...LOCKED_STATUSES, QuotationStatus.EXPIRED] },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
            { client: { companyName: { contains: query.search, mode: 'insensitive' } } },
            { lead: { companyName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const sortBy = resolveSort(query.sortBy, QUOTATION_SORT_FIELDS, 'createdAt');
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.quotation.findMany({
      where,
      select: quotationSelect,
      orderBy: { [sortBy]: query.sortOrder },
      skip,
      take,
    }),
    prisma.quotation.count({ where }),
  ]);

  return {
    items: rows.map((row) => toQuotationView(row, now)),
    meta: buildPaginationMeta(total, query),
  };
}

export async function getQuotation(id: string): Promise<QuotationView> {
  return toQuotationView(await loadQuotation(id));
}

export async function createQuotation(
  input: CreateQuotationInput,
  actorId: string,
  audit: AuditMeta,
): Promise<QuotationView> {
  const totals = computeTotals(input.items, input.discountAmount, input.taxPercent);

  const quotation = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, REFERENCE_PREFIX.QUOTATION);

    const created = await tx.quotation.create({
      data: {
        reference,
        title: input.title,
        clientId: input.clientId ?? null,
        leadId: input.leadId ?? null,
        dealId: input.dealId ?? null,
        createdById: actorId,
        currency: input.currency,
        issueDate: input.issueDate,
        validUntil: input.validUntil ?? null,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxPercent: totals.taxPercent,
        taxAmount: totals.taxAmount,
        total: totals.total,
        paymentTerms: input.paymentTerms ?? null,
        notes: input.notes ?? null,
        items: {
          create: totals.items.map((item) => ({
            serviceId: item.serviceId ?? null,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountPercent: item.discountPercent,
            lineTotal: item.lineTotal,
            position: item.position,
          })),
        },
      },
      select: quotationSelect,
    });

    // The opening price is the first entry in the trail, not an absence of one.
    await tx.pricingHistory.create({
      data: {
        entityType: EntityType.QUOTATION,
        entityId: created.id,
        quotationId: created.id,
        changedById: actorId,
        previousValue: null,
        newValue: totals.total,
        currency: created.currency,
        reason: 'Quotation created',
      },
    });

    return created;
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.QUOTATION,
    entityId: quotation.id,
    summary: `Created quotation ${quotation.reference} — ${quotation.title}`,
    newValue: { total: totals.total, currency: quotation.currency, items: totals.items.length },
  });

  return toQuotationView(quotation);
}

/**
 * Revises a quotation.
 *
 * Line items are replaced wholesale — a quotation is one document, and patching
 * rows individually invites a half-updated total. Any change to the total is
 * appended to the pricing trail with the reason given.
 */
export async function updateQuotation(
  id: string,
  input: UpdateQuotationInput,
  actorId: string,
  audit: AuditMeta,
): Promise<QuotationView> {
  const current = await loadQuotation(id);

  if (LOCKED_STATUSES.includes(current.status)) {
    throw new ConflictError(
      `This quotation was ${current.status.toLowerCase()} and can no longer be edited. Create a new one instead.`,
    );
  }

  const { changeReason, items, ...rest } = input;

  const previousTotal = Number(current.total);
  const nextItems =
    items ??
    current.items.map((item) => ({
      serviceId: item.service?.id ?? null,
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      discountPercent: Number(item.discountPercent),
    }));

  const totals = computeTotals(
    nextItems,
    rest.discountAmount ?? Number(current.discountAmount),
    rest.taxPercent ?? Number(current.taxPercent),
  );

  const totalChanged = totals.total !== previousTotal;

  const updated = await prisma.$transaction(async (tx) => {
    if (items) {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
    }

    const quotation = await tx.quotation.update({
      where: { id },
      data: {
        ...(rest.title !== undefined ? { title: rest.title } : {}),
        ...(rest.dealId !== undefined ? { dealId: rest.dealId } : {}),
        ...(rest.currency !== undefined ? { currency: rest.currency } : {}),
        ...(rest.issueDate !== undefined ? { issueDate: rest.issueDate } : {}),
        ...(rest.validUntil !== undefined ? { validUntil: rest.validUntil } : {}),
        ...(rest.paymentTerms !== undefined ? { paymentTerms: rest.paymentTerms } : {}),
        ...(rest.notes !== undefined ? { notes: rest.notes } : {}),
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxPercent: totals.taxPercent,
        taxAmount: totals.taxAmount,
        total: totals.total,
        ...(items
          ? {
              items: {
                create: totals.items.map((item) => ({
                  serviceId: item.serviceId ?? null,
                  description: item.description,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  discountPercent: item.discountPercent,
                  lineTotal: item.lineTotal,
                  position: item.position,
                })),
              },
            }
          : {}),
      },
      select: quotationSelect,
    });

    if (totalChanged) {
      await tx.pricingHistory.create({
        data: {
          entityType: EntityType.QUOTATION,
          entityId: id,
          quotationId: id,
          changedById: actorId,
          previousValue: previousTotal,
          newValue: totals.total,
          currency: quotation.currency,
          reason: changeReason ?? 'Quotation revised',
        },
      });
    }

    return quotation;
  });

  await recordAudit({
    ...audit,
    action: totalChanged ? AuditAction.VALUE_CHANGED : AuditAction.UPDATED,
    entityType: EntityType.QUOTATION,
    entityId: id,
    summary: totalChanged
      ? `${current.reference}: total ${previousTotal} → ${totals.total}`
      : `Updated quotation ${current.reference}`,
    previousValue: { total: previousTotal },
    newValue: { total: totals.total, reason: changeReason ?? null },
  });

  return toQuotationView(updated);
}

/**
 * Moves a quotation through its lifecycle.
 *
 * Accepting one closes the deal behind it, if there is one still open — the
 * client agreeing to the price is the deal being won, and making someone
 * record that twice is exactly what this system exists to avoid.
 */
export async function changeStatus(
  id: string,
  input: ChangeQuotationStatusInput,
  audit: AuditMeta,
): Promise<QuotationView> {
  const current = await loadQuotation(id);

  if (current.status === input.status) {
    throw new UnprocessableError(`This quotation is already ${input.status.toLowerCase()}.`);
  }

  const allowed = ALLOWED_TRANSITIONS[current.status];
  if (!allowed.includes(input.status)) {
    throw new UnprocessableError(
      `A ${current.status.toLowerCase()} quotation cannot move to ${input.status.toLowerCase()}.`,
    );
  }

  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const quotation = await tx.quotation.update({
      where: { id },
      data: {
        status: input.status,
        ...(input.status === QuotationStatus.SENT ? { sentAt: now } : {}),
        ...(input.status === QuotationStatus.VIEWED ? { viewedAt: now } : {}),
        ...(LOCKED_STATUSES.includes(input.status) ? { decidedAt: now } : {}),
      },
      select: quotationSelect,
    });

    if (
      input.status === QuotationStatus.ACCEPTED &&
      quotation.deal &&
      (quotation.deal.stage === DealStage.OPEN || quotation.deal.stage === DealStage.NEGOTIATION)
    ) {
      await tx.deal.update({
        where: { id: quotation.deal.id },
        data: {
          stage: DealStage.WON,
          probability: 100,
          closedAt: now,
          value: quotation.total,
        },
      });
    }

    return quotation;
  });

  await recordAudit({
    ...audit,
    action: AuditAction.STATUS_CHANGED,
    entityType: EntityType.QUOTATION,
    entityId: id,
    summary: `${current.reference}: ${current.status} → ${input.status}`,
    previousValue: { status: current.status },
    newValue: { status: input.status, note: input.note ?? null },
  });

  if (input.status === QuotationStatus.ACCEPTED && current.deal) {
    await recordAudit({
      ...audit,
      action: AuditAction.STATUS_CHANGED,
      entityType: EntityType.DEAL,
      entityId: current.deal.id,
      summary: `Won on acceptance of quotation ${current.reference}`,
      newValue: { stage: DealStage.WON },
    });
  }

  return toQuotationView(updated);
}

export async function deleteQuotation(id: string, audit: AuditMeta): Promise<void> {
  const current = await loadQuotation(id);

  if (current.status === QuotationStatus.ACCEPTED) {
    throw new ConflictError('An accepted quotation is part of the client record and is kept.');
  }

  await prisma.quotation.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.QUOTATION,
    entityId: id,
    summary: `Deleted quotation ${current.reference}`,
  });
}

/** The append-only price trail: every figure this quotation has ever carried. */
export async function getPricingHistory(id: string) {
  await loadQuotation(id);
  const rows = await prisma.pricingHistory.findMany({
    where: { entityType: EntityType.QUOTATION, entityId: id },
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({
    ...row,
    previousValue: row.previousValue === null ? null : Number(row.previousValue),
    newValue: Number(row.newValue),
  }));
}
