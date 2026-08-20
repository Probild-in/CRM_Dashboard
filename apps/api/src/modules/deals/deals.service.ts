import {
  AuditAction,
  DealStage,
  EntityType,
  type PaginatedResult,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { REFERENCE_PREFIX, nextReference } from '../../lib/reference.js';
import { recordAudit, type AuditInput } from '../audit/audit.service.js';
import {
  DEAL_SORT_FIELDS,
  type ChangeDealStageInput,
  type CreateDealInput,
  type ListDealsQuery,
  type UpdateDealInput,
} from './deals.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

const dealSelect = {
  id: true,
  reference: true,
  title: true,
  stage: true,
  value: true,
  currency: true,
  probability: true,
  expectedCloseDate: true,
  closedAt: true,
  lostReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, reference: true, companyName: true } },
  lead: { select: { id: true, reference: true, companyName: true } },
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.DealSelect;

type DealRow = Prisma.DealGetPayload<{ select: typeof dealSelect }>;
export interface DealView extends Omit<DealRow, 'value'> {
  value: number;
}

function toDealView(deal: DealRow): DealView {
  return { ...deal, value: Number(deal.value) };
}

async function loadDeal(id: string): Promise<DealRow> {
  const deal = await prisma.deal.findFirst({ where: { id, deletedAt: null }, select: dealSelect });
  if (!deal) {
    throw new NotFoundError('Deal');
  }
  return deal;
}

export async function listDeals(query: ListDealsQuery): Promise<PaginatedResult<DealView>> {
  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    ...(query.stage ? { stage: query.stage } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.currency ? { currency: query.currency } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
            { client: { companyName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const sortBy = resolveSort(query.sortBy, DEAL_SORT_FIELDS, 'createdAt');
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.deal.findMany({
      where,
      select: dealSelect,
      orderBy: { [sortBy]: query.sortOrder },
      skip,
      take,
    }),
    prisma.deal.count({ where }),
  ]);

  return { items: rows.map(toDealView), meta: buildPaginationMeta(total, query) };
}

export async function getDeal(id: string): Promise<DealView> {
  return toDealView(await loadDeal(id));
}

export async function createDeal(input: CreateDealInput, audit: AuditMeta): Promise<DealView> {
  if (input.clientId) {
    const client = await prisma.client.count({ where: { id: input.clientId, deletedAt: null } });
    if (client === 0) {
      throw new UnprocessableError('That client no longer exists.');
    }
  }

  const deal = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, REFERENCE_PREFIX.DEAL);
    return tx.deal.create({
      data: {
        ...input,
        reference,
        ...(input.stage === DealStage.WON || input.stage === DealStage.LOST
          ? { closedAt: new Date() }
          : {}),
      },
      select: dealSelect,
    });
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.DEAL,
    entityId: deal.id,
    summary: `Created deal ${deal.reference} — ${deal.title}`,
    newValue: { title: deal.title, value: Number(deal.value), currency: deal.currency },
  });

  return toDealView(deal);
}

/**
 * Updates a deal.
 *
 * A change to `value` is money moving, so it lands in `pricing_history` with
 * the old figure, the new one, who changed it and why.
 */
export async function updateDeal(
  id: string,
  input: UpdateDealInput,
  actorId: string,
  audit: AuditMeta,
): Promise<DealView> {
  const current = await loadDeal(id);
  const { valueChangeReason, ...data } = input;

  const previousValue = Number(current.value);
  const valueChanged = data.value !== undefined && data.value !== previousValue;

  const updated = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.update({
      where: { id },
      data: data as Prisma.DealUpdateInput,
      select: dealSelect,
    });

    if (valueChanged) {
      await tx.pricingHistory.create({
        data: {
          entityType: EntityType.DEAL,
          entityId: id,
          changedById: actorId,
          previousValue,
          newValue: data.value ?? 0,
          currency: deal.currency,
          reason: valueChangeReason ?? 'Deal value updated',
        },
      });
    }

    return deal;
  });

  await recordAudit({
    ...audit,
    action: valueChanged ? AuditAction.VALUE_CHANGED : AuditAction.UPDATED,
    entityType: EntityType.DEAL,
    entityId: id,
    summary: valueChanged
      ? `${current.reference}: value ${previousValue} → ${data.value}`
      : `Updated deal ${current.reference}`,
    ...(valueChanged
      ? { previousValue: { value: previousValue }, newValue: { value: data.value ?? 0 } }
      : { newValue: data as never }),
  });

  return toDealView(updated);
}

export async function changeStage(
  id: string,
  input: ChangeDealStageInput,
  audit: AuditMeta,
): Promise<DealView> {
  const current = await loadDeal(id);
  if (current.stage === input.stage) {
    throw new UnprocessableError(`This deal is already ${input.stage.toLowerCase()}.`);
  }

  const closing = input.stage === DealStage.WON || input.stage === DealStage.LOST;

  const updated = await prisma.deal.update({
    where: { id },
    data: {
      stage: input.stage,
      lostReason: input.stage === DealStage.LOST ? (input.lostReason ?? null) : null,
      closedAt: closing ? new Date() : null,
      ...(input.stage === DealStage.WON ? { probability: 100 } : {}),
    },
    select: dealSelect,
  });

  await recordAudit({
    ...audit,
    action: AuditAction.STATUS_CHANGED,
    entityType: EntityType.DEAL,
    entityId: id,
    summary: `${current.reference}: ${current.stage} → ${input.stage}`,
    previousValue: { stage: current.stage },
    newValue: { stage: input.stage, lostReason: input.lostReason ?? null },
  });

  return toDealView(updated);
}

export async function deleteDeal(id: string, audit: AuditMeta): Promise<void> {
  const current = await loadDeal(id);
  await prisma.deal.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.DEAL,
    entityId: id,
    summary: `Deleted deal ${current.reference}`,
  });
}

/** The append-only price trail for one deal. */
export async function getPricingHistory(id: string) {
  await loadDeal(id);
  const rows = await prisma.pricingHistory.findMany({
    where: { entityType: EntityType.DEAL, entityId: id },
    orderBy: { createdAt: 'desc' },
    include: { changedBy: { select: { id: true, firstName: true, lastName: true } } },
  });
  return rows.map((row) => ({
    ...row,
    previousValue: row.previousValue === null ? null : Number(row.previousValue),
    newValue: Number(row.newValue),
  }));
}
