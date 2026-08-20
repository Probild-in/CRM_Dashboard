import {
  AuditAction,
  Currency,
  EntityType,
  PaymentStatus,
  type PaginatedResult,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { REFERENCE_PREFIX, nextReference } from '../../lib/reference.js';
import { round2 } from '../quotations/quotations.totals.js';
import { recordAudit, type AuditInput } from '../audit/audit.service.js';
import {
  PAYMENT_SORT_FIELDS,
  type CreatePaymentInput,
  type ListPaymentsQuery,
  type RecordReceiptInput,
  type UpdatePaymentInput,
} from './payments.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

/** Money still expected: everything except what was written off. */
const LIVE_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.PARTIALLY_PAID,
  PaymentStatus.OVERDUE,
];

const paymentSelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  amount: true,
  paidAmount: true,
  currency: true,
  method: true,
  dueDate: true,
  paidAt: true,
  transactionRef: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, reference: true, companyName: true } },
  project: { select: { id: true, reference: true, name: true } },
  deal: { select: { id: true, reference: true, title: true } },
  recordedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

export interface PaymentView extends Omit<PaymentRow, 'amount' | 'paidAmount'> {
  amount: number;
  paidAmount: number;
  /** Billed less received. The number everyone actually asks for. */
  outstanding: number;
  /**
   * Derived on every read, like every other deadline in the system. A late
   * payment keeps its settlement status — PENDING or PARTIALLY_PAID — and
   * reports lateness alongside it.
   */
  isOverdue: boolean;
}

function toPaymentView(payment: PaymentRow, now = new Date()): PaymentView {
  const amount = Number(payment.amount);
  const paidAmount = Number(payment.paidAmount);
  const settled =
    payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.CANCELLED;

  return {
    ...payment,
    amount,
    paidAmount,
    outstanding: round2(amount - paidAmount),
    isOverdue: !settled && payment.dueDate !== null && payment.dueDate < now,
  };
}

/** The settlement state implied by what has been received. */
function settlementStatus(amount: number, paidAmount: number): PaymentStatus {
  if (paidAmount <= 0) return PaymentStatus.PENDING;
  return paidAmount >= amount ? PaymentStatus.PAID : PaymentStatus.PARTIALLY_PAID;
}

async function loadPayment(id: string): Promise<PaymentRow> {
  const payment = await prisma.payment.findFirst({
    where: { id, deletedAt: null },
    select: paymentSelect,
  });
  if (!payment) {
    throw new NotFoundError('Payment');
  }
  return payment;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listPayments(
  query: ListPaymentsQuery,
): Promise<PaginatedResult<PaymentView>> {
  const now = new Date();

  const where: Prisma.PaymentWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.currency ? { currency: query.currency } : {}),
    ...(query.outstandingOnly ? { status: { in: LIVE_STATUSES } } : {}),
    ...(query.overdue ? { status: { in: LIVE_STATUSES }, dueDate: { lt: now } } : {}),
    ...(query.dueFrom || query.dueTo
      ? {
          dueDate: {
            ...(query.dueFrom ? { gte: query.dueFrom } : {}),
            ...(query.dueTo ? { lte: query.dueTo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { reference: { contains: query.search, mode: 'insensitive' } },
            { transactionRef: { contains: query.search, mode: 'insensitive' } },
            { client: { companyName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const sortBy = resolveSort(query.sortBy, PAYMENT_SORT_FIELDS, 'dueDate');
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      select: paymentSelect,
      orderBy: [{ [sortBy]: { sort: query.sortOrder, nulls: 'last' } }],
      skip,
      take,
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    items: rows.map((row) => toPaymentView(row, now)),
    meta: buildPaginationMeta(total, query),
  };
}

export async function getPayment(id: string): Promise<PaymentView> {
  return toPaymentView(await loadPayment(id));
}

export type MoneyByCurrency = Record<Currency, number>;

const ZERO: MoneyByCurrency = { INR: 0, USD: 0 };

function sumByCurrency(rows: Array<{ currency: Currency; amount: number }>): MoneyByCurrency {
  return rows.reduce<MoneyByCurrency>(
    (totals, row) => ({ ...totals, [row.currency]: round2(totals[row.currency] + row.amount) }),
    { ...ZERO },
  );
}

export interface PaymentSummary {
  billed: MoneyByCurrency;
  received: MoneyByCurrency;
  outstanding: MoneyByCurrency;
  overdue: MoneyByCurrency;
  counts: { total: number; outstanding: number; overdue: number; paid: number };
  /** How long the outstanding money has been late, in buckets. */
  aging: Array<{ bucket: string; count: number; value: MoneyByCurrency }>;
}

/**
 * The money picture.
 *
 * Everything is per currency: Probild bills in INR and USD, and a single
 * "total outstanding" across both would be a number that means nothing.
 */
export async function getSummary(): Promise<PaymentSummary> {
  const now = new Date();

  const payments = await prisma.payment.findMany({
    where: { deletedAt: null, status: { not: PaymentStatus.CANCELLED } },
    select: { amount: true, paidAmount: true, currency: true, dueDate: true, status: true },
  });

  const live = payments.filter((payment) => payment.status !== PaymentStatus.PAID);
  const overdue = live.filter((payment) => payment.dueDate !== null && payment.dueDate < now);

  const owed = (payment: { amount: Prisma.Decimal; paidAmount: Prisma.Decimal }): number =>
    round2(Number(payment.amount) - Number(payment.paidAmount));

  // Buckets are counted from the due date, so "1–30 days" means late by that much.
  const BUCKETS: Array<{ bucket: string; min: number; max: number }> = [
    { bucket: 'Not yet due', min: Number.NEGATIVE_INFINITY, max: 0 },
    { bucket: '1–30 days', min: 0, max: 30 },
    { bucket: '31–60 days', min: 30, max: 60 },
    { bucket: '61–90 days', min: 60, max: 90 },
    { bucket: 'Over 90 days', min: 90, max: Number.POSITIVE_INFINITY },
  ];

  const aging = BUCKETS.map((bucket) => {
    const matching = live.filter((payment) => {
      if (payment.dueDate === null) return bucket.bucket === 'Not yet due';
      const daysLate = Math.floor((now.getTime() - payment.dueDate.getTime()) / 86_400_000);
      return daysLate > bucket.min && daysLate <= bucket.max;
    });

    return {
      bucket: bucket.bucket,
      count: matching.length,
      value: sumByCurrency(
        matching.map((payment) => ({ currency: payment.currency, amount: owed(payment) })),
      ),
    };
  });

  return {
    billed: sumByCurrency(
      payments.map((payment) => ({
        currency: payment.currency,
        amount: Number(payment.amount),
      })),
    ),
    received: sumByCurrency(
      payments.map((payment) => ({
        currency: payment.currency,
        amount: Number(payment.paidAmount),
      })),
    ),
    outstanding: sumByCurrency(
      live.map((payment) => ({ currency: payment.currency, amount: owed(payment) })),
    ),
    overdue: sumByCurrency(
      overdue.map((payment) => ({ currency: payment.currency, amount: owed(payment) })),
    ),
    counts: {
      total: payments.length,
      outstanding: live.length,
      overdue: overdue.length,
      paid: payments.filter((payment) => payment.status === PaymentStatus.PAID).length,
    },
    aging,
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createPayment(
  input: CreatePaymentInput,
  actorId: string,
  audit: AuditMeta,
): Promise<PaymentView> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, deletedAt: null },
    select: { id: true, defaultCurrency: true },
  });
  if (!client) {
    throw new UnprocessableError('That client no longer exists.');
  }

  if (input.projectId) {
    const project = await prisma.project.count({
      where: { id: input.projectId, clientId: input.clientId, deletedAt: null },
    });
    if (project === 0) {
      throw new UnprocessableError('That project does not belong to this client.');
    }
  }

  const payment = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, REFERENCE_PREFIX.PAYMENT);
    return tx.payment.create({
      data: { ...input, reference, recordedById: actorId, status: PaymentStatus.PENDING },
      select: paymentSelect,
    });
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.PAYMENT,
    entityId: payment.id,
    summary: `Raised ${payment.reference} — ${payment.title}`,
    newValue: { amount: Number(payment.amount), currency: payment.currency, dueDate: input.dueDate },
  });

  return toPaymentView(payment);
}

export async function updatePayment(
  id: string,
  input: UpdatePaymentInput,
  actorId: string,
  audit: AuditMeta,
): Promise<PaymentView> {
  const current = await loadPayment(id);

  if (current.status === PaymentStatus.CANCELLED) {
    throw new ConflictError('This payment was cancelled and can no longer be edited.');
  }

  const { amountChangeReason, ...data } = input;
  const previousAmount = Number(current.amount);
  const paidAmount = Number(current.paidAmount);
  const amountChanged = data.amount !== undefined && data.amount !== previousAmount;

  if (amountChanged && data.amount! < paidAmount) {
    throw new UnprocessableError(
      `Already received ${paidAmount}. The amount cannot be set below what has been paid.`,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.update({
      where: { id },
      data: {
        ...(data as Prisma.PaymentUncheckedUpdateInput),
        // Changing what is owed can settle or unsettle the payment.
        ...(amountChanged ? { status: settlementStatus(data.amount!, paidAmount) } : {}),
      },
      select: paymentSelect,
    });

    // Changing what a client owes is money moving; it never happens silently.
    if (amountChanged) {
      await tx.pricingHistory.create({
        data: {
          entityType: EntityType.PAYMENT,
          entityId: id,
          changedById: actorId,
          previousValue: previousAmount,
          newValue: data.amount ?? 0,
          currency: payment.currency,
          reason: amountChangeReason ?? 'Payment amount updated',
        },
      });
    }

    return payment;
  });

  await recordAudit({
    ...audit,
    action: amountChanged ? AuditAction.VALUE_CHANGED : AuditAction.UPDATED,
    entityType: EntityType.PAYMENT,
    entityId: id,
    summary: amountChanged
      ? `${current.reference}: amount ${previousAmount} → ${data.amount}`
      : `Updated ${current.reference}`,
    previousValue: amountChanged ? { amount: previousAmount } : undefined,
    newValue: amountChanged ? { amount: data.amount ?? 0 } : (data as never),
  });

  return toPaymentView(updated);
}

/**
 * Records money arriving.
 *
 * Additive by design: a part payment followed by the balance leaves both on the
 * record, and the status follows from the arithmetic rather than being chosen.
 */
export async function recordReceipt(
  id: string,
  input: RecordReceiptInput,
  actorId: string,
  audit: AuditMeta,
): Promise<PaymentView> {
  const current = await loadPayment(id);

  if (current.status === PaymentStatus.CANCELLED) {
    throw new ConflictError('This payment was cancelled. Raise a new one instead.');
  }

  const amount = Number(current.amount);
  const alreadyPaid = Number(current.paidAmount);
  const outstanding = round2(amount - alreadyPaid);

  if (outstanding <= 0) {
    throw new ConflictError('This payment is already settled in full.');
  }
  if (input.amount > outstanding) {
    throw new UnprocessableError(
      `Only ${outstanding} is outstanding. Record ${outstanding} or less, or raise the amount first.`,
    );
  }

  const paidAmount = round2(alreadyPaid + input.amount);
  const status = settlementStatus(amount, paidAmount);

  const updated = await prisma.payment.update({
    where: { id },
    data: {
      paidAmount,
      status,
      paidAt: input.paidAt,
      ...(input.method ? { method: input.method } : {}),
      ...(input.transactionRef ? { transactionRef: input.transactionRef } : {}),
      recordedById: actorId,
    },
    select: paymentSelect,
  });

  await recordAudit({
    ...audit,
    action: status === PaymentStatus.PAID ? AuditAction.COMPLETED : AuditAction.UPDATED,
    entityType: EntityType.PAYMENT,
    entityId: id,
    summary:
      status === PaymentStatus.PAID
        ? `${current.reference} settled in full`
        : `${current.reference}: received ${input.amount} of ${amount}`,
    previousValue: { paidAmount: alreadyPaid, status: current.status },
    newValue: {
      paidAmount,
      status,
      received: input.amount,
      method: input.method ?? null,
      transactionRef: input.transactionRef ?? null,
      note: input.note ?? null,
    },
  });

  return toPaymentView(updated);
}

export async function cancelPayment(
  id: string,
  reason: string,
  audit: AuditMeta,
): Promise<PaymentView> {
  const current = await loadPayment(id);

  if (current.status === PaymentStatus.CANCELLED) {
    throw new ConflictError('This payment is already cancelled.');
  }
  if (Number(current.paidAmount) > 0) {
    throw new ConflictError(
      'Money has already been received against this payment. Cancelling would hide it — adjust the amount instead.',
    );
  }

  const updated = await prisma.payment.update({
    where: { id },
    data: { status: PaymentStatus.CANCELLED, notes: reason },
    select: paymentSelect,
  });

  await recordAudit({
    ...audit,
    action: AuditAction.STATUS_CHANGED,
    entityType: EntityType.PAYMENT,
    entityId: id,
    summary: `Cancelled ${current.reference}`,
    previousValue: { status: current.status },
    newValue: { status: PaymentStatus.CANCELLED, reason },
  });

  return toPaymentView(updated);
}

export async function deletePayment(id: string, audit: AuditMeta): Promise<void> {
  const current = await loadPayment(id);

  if (Number(current.paidAmount) > 0) {
    throw new ConflictError('A payment with money received against it is part of the record.');
  }

  await prisma.payment.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.PAYMENT,
    entityId: id,
    summary: `Deleted ${current.reference}`,
  });
}

/**
 * What a project has been billed and what is still owed on it.
 *
 * Read against the project value, this answers the question the brief asks:
 * outstanding is the value less what has actually arrived.
 */
export async function getProjectPosition(projectId: string): Promise<{
  value: number;
  currency: Currency;
  billed: number;
  received: number;
  outstanding: number;
  unbilled: number;
}> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { value: true, currency: true },
  });
  if (!project) {
    throw new NotFoundError('Project');
  }

  const payments = await prisma.payment.findMany({
    where: { projectId, deletedAt: null, status: { not: PaymentStatus.CANCELLED } },
    select: { amount: true, paidAmount: true },
  });

  const billed = round2(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
  const received = round2(payments.reduce((sum, payment) => sum + Number(payment.paidAmount), 0));
  const value = Number(project.value);

  return {
    value,
    currency: project.currency,
    billed,
    received,
    outstanding: round2(billed - received),
    // What the project is worth that has not been invoiced yet.
    unbilled: round2(Math.max(value - billed, 0)),
  };
}
