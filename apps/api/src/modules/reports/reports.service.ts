import {
  Currency,
  DealStage,
  LeadStatus,
  PaymentStatus,
  ProjectStatus,
  TERMINAL_LEAD_STATUSES,
  type LeadSource,
  type UserRole,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { recentMonths } from '../../lib/time.js';
import { round2 } from '../quotations/quotations.totals.js';
import { visibilityFilter as leadVisibility } from '../leads/leads.service.js';
import { projectVisibilityFilter } from '../projects/projects.service.js';

/**
 * Reports.
 *
 * Every figure here is per currency and every window is bounded by the reader's
 * timezone, so a report run from Mumbai and one run from London agree about
 * which month a payment landed in.
 */

export interface Viewer {
  id: string;
  role: UserRole;
  timezone: string;
}

export type MoneyByCurrency = Record<Currency, number>;

const ZERO: MoneyByCurrency = { INR: 0, USD: 0 };

function sumByCurrency(rows: Array<{ currency: Currency; amount: number }>): MoneyByCurrency {
  return rows.reduce<MoneyByCurrency>(
    (totals, row) => ({ ...totals, [row.currency]: round2(totals[row.currency] + row.amount) }),
    { ...ZERO },
  );
}

/* ------------------------------------------------------------------ */
/* Revenue                                                             */
/* ------------------------------------------------------------------ */

export async function revenueReport(viewer: Viewer, months: number) {
  const windows = recentMonths(new Date(), viewer.timezone, months);
  const from = windows[0]!.start;
  const to = windows[windows.length - 1]!.end;

  const [receipts, wonDeals, services] = await Promise.all([
    prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: { not: PaymentStatus.CANCELLED },
        paidAt: { gte: from, lte: to },
      },
      select: {
        paidAmount: true,
        currency: true,
        paidAt: true,
        client: { select: { id: true, companyName: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, stage: DealStage.WON, closedAt: { gte: from, lte: to } },
      select: { value: true, currency: true, closedAt: true },
    }),
    // What Probild actually sold, taken from accepted quotation lines.
    prisma.quotationItem.findMany({
      where: {
        quotation: {
          deletedAt: null,
          status: 'ACCEPTED',
          decidedAt: { gte: from, lte: to },
        },
      },
      select: {
        lineTotal: true,
        description: true,
        service: { select: { id: true, name: true } },
        quotation: { select: { currency: true } },
      },
    }),
  ]);

  const byMonth = windows.map((window) => ({
    key: window.key,
    label: window.label,
    received: sumByCurrency(
      receipts
        .filter((row) => row.paidAt && row.paidAt >= window.start && row.paidAt <= window.end)
        .map((row) => ({ currency: row.currency, amount: Number(row.paidAmount) })),
    ),
    won: sumByCurrency(
      wonDeals
        .filter((row) => row.closedAt && row.closedAt >= window.start && row.closedAt <= window.end)
        .map((row) => ({ currency: row.currency, amount: Number(row.value) })),
    ),
  }));

  const clients = new Map<string, { id: string; name: string; value: MoneyByCurrency }>();
  for (const receipt of receipts) {
    const entry = clients.get(receipt.client.id) ?? {
      id: receipt.client.id,
      name: receipt.client.companyName,
      value: { ...ZERO },
    };
    entry.value[receipt.currency] = round2(
      entry.value[receipt.currency] + Number(receipt.paidAmount),
    );
    clients.set(receipt.client.id, entry);
  }

  const byService = new Map<string, { name: string; value: MoneyByCurrency }>();
  for (const item of services) {
    const key = item.service?.id ?? 'unassigned';
    const entry = byService.get(key) ?? {
      name: item.service?.name ?? 'Not linked to a service',
      value: { ...ZERO },
    };
    const currency = item.quotation.currency;
    entry.value[currency] = round2(entry.value[currency] + Number(item.lineTotal));
    byService.set(key, entry);
  }

  return {
    window: { from: from.toISOString(), to: to.toISOString(), months },
    byMonth,
    byClient: [...clients.values()].sort(
      (a, b) => b.value.INR + b.value.USD - (a.value.INR + a.value.USD),
    ),
    byService: [...byService.entries()].map(([id, entry]) => ({ id, ...entry })),
    totals: {
      received: sumByCurrency(
        receipts.map((row) => ({ currency: row.currency, amount: Number(row.paidAmount) })),
      ),
      won: sumByCurrency(
        wonDeals.map((row) => ({ currency: row.currency, amount: Number(row.value) })),
      ),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export async function salesReport(viewer: Viewer, months: number) {
  const windows = recentMonths(new Date(), viewer.timezone, months);
  const from = windows[0]!.start;

  const scope: Prisma.LeadWhereInput = { deletedAt: null, ...leadVisibility(viewer) };

  const [leads, wonDeals] = await Promise.all([
    prisma.lead.findMany({
      where: { ...scope, createdAt: { gte: from } },
      select: {
        status: true,
        source: true,
        currency: true,
        expectedValue: true,
        createdAt: true,
        convertedAt: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, stage: DealStage.WON, closedAt: { gte: from } },
      select: {
        value: true,
        currency: true,
        closedAt: true,
        owner: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  const decided = (rows: typeof leads): { won: number; lost: number } => ({
    won: rows.filter((lead) => lead.status === LeadStatus.WON).length,
    lost: rows.filter((lead) => lead.status === LeadStatus.LOST).length,
  });

  /** Won out of decided. Open leads are not failures. */
  const rate = (won: number, lost: number): number | null =>
    won + lost === 0 ? null : Math.round((won / (won + lost)) * 1000) / 10;

  const owners = new Map<
    string,
    { id: string; name: string; leads: number; won: number; lost: number; value: MoneyByCurrency }
  >();

  for (const lead of leads) {
    const key = lead.assignedTo?.id ?? 'unassigned';
    const entry = owners.get(key) ?? {
      id: key,
      name: lead.assignedTo
        ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
        : 'Unassigned',
      leads: 0,
      won: 0,
      lost: 0,
      value: { ...ZERO },
    };
    entry.leads += 1;
    if (lead.status === LeadStatus.WON) entry.won += 1;
    if (lead.status === LeadStatus.LOST) entry.lost += 1;
    owners.set(key, entry);
  }

  for (const deal of wonDeals) {
    const key = deal.owner?.id ?? 'unassigned';
    const entry = owners.get(key);
    if (entry) {
      entry.value[deal.currency] = round2(entry.value[deal.currency] + Number(deal.value));
    }
  }

  const sources = new Map<LeadSource, { total: number; won: number; lost: number; value: MoneyByCurrency }>();
  for (const lead of leads) {
    const entry = sources.get(lead.source) ?? { total: 0, won: 0, lost: 0, value: { ...ZERO } };
    entry.total += 1;
    if (lead.status === LeadStatus.WON) {
      entry.won += 1;
      entry.value[lead.currency] = round2(
        entry.value[lead.currency] + Number(lead.expectedValue ?? 0),
      );
    }
    if (lead.status === LeadStatus.LOST) entry.lost += 1;
    sources.set(lead.source, entry);
  }

  const overall = decided(leads);

  return {
    window: { from: from.toISOString(), months },
    totals: {
      leads: leads.length,
      open: leads.filter((lead) => !TERMINAL_LEAD_STATUSES.includes(lead.status)).length,
      ...overall,
      rate: rate(overall.won, overall.lost),
      wonValue: sumByCurrency(
        wonDeals.map((deal) => ({ currency: deal.currency, amount: Number(deal.value) })),
      ),
    },
    byMonth: windows.map((window) => {
      const created = leads.filter(
        (lead) => lead.createdAt >= window.start && lead.createdAt <= window.end,
      );
      const closed = wonDeals.filter(
        (deal) => deal.closedAt && deal.closedAt >= window.start && deal.closedAt <= window.end,
      );
      return {
        key: window.key,
        label: window.label,
        created: created.length,
        won: closed.length,
        wonValue: sumByCurrency(
          closed.map((deal) => ({ currency: deal.currency, amount: Number(deal.value) })),
        ),
      };
    }),
    byOwner: [...owners.values()]
      .map((entry) => ({ ...entry, rate: rate(entry.won, entry.lost) }))
      .sort((a, b) => b.leads - a.leads),
    bySource: [...sources.entries()]
      .map(([source, entry]) => ({ source, ...entry, rate: rate(entry.won, entry.lost) }))
      .sort((a, b) => b.total - a.total),
  };
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

export async function projectReport(viewer: Viewer) {
  const now = new Date();
  const scope: Prisma.ProjectWhereInput = { deletedAt: null, ...projectVisibilityFilter(viewer) };

  const projects = await prisma.project.findMany({
    where: scope,
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      progress: true,
      value: true,
      currency: true,
      startDate: true,
      deliveryDate: true,
      completedAt: true,
      client: { select: { id: true, companyName: true } },
      manager: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { tasks: true, milestones: true } },
    },
  });

  const closed = projects.filter((project) => project.completedAt !== null);

  // On time means delivered on or before the date that was promised.
  const onTime = closed.filter(
    (project) => project.deliveryDate === null || project.completedAt! <= project.deliveryDate,
  );
  const late = closed.filter(
    (project) => project.deliveryDate !== null && project.completedAt! > project.deliveryDate,
  );

  const open = projects.filter(
    (project) =>
      project.status !== ProjectStatus.COMPLETED && project.status !== ProjectStatus.CANCELLED,
  );
  const slipping = open.filter(
    (project) => project.deliveryDate !== null && project.deliveryDate < now,
  );

  const daysLate = (project: (typeof closed)[number]): number =>
    project.deliveryDate === null
      ? 0
      : Math.max(
          0,
          Math.round((project.completedAt!.getTime() - project.deliveryDate.getTime()) / 86_400_000),
        );

  return {
    totals: {
      all: projects.length,
      open: open.length,
      completed: closed.length,
      slipping: slipping.length,
      onTime: onTime.length,
      late: late.length,
      onTimeRate:
        closed.length === 0 ? null : Math.round((onTime.length / closed.length) * 1000) / 10,
      averageDaysLate:
        late.length === 0
          ? 0
          : Math.round((late.reduce((sum, project) => sum + daysLate(project), 0) / late.length) * 10) /
            10,
      averageProgress:
        open.length === 0
          ? 0
          : Math.round(open.reduce((sum, project) => sum + project.progress, 0) / open.length),
      value: sumByCurrency(
        projects.map((project) => ({
          currency: project.currency,
          amount: Number(project.value),
        })),
      ),
    },
    byStatus: Object.values(ProjectStatus).map((status) => ({
      status,
      count: projects.filter((project) => project.status === status).length,
      value: sumByCurrency(
        projects
          .filter((project) => project.status === status)
          .map((project) => ({ currency: project.currency, amount: Number(project.value) })),
      ),
    })),
    delivery: closed
      .map((project) => ({
        id: project.id,
        reference: project.reference,
        name: project.name,
        client: project.client.companyName,
        manager: project.manager
          ? `${project.manager.firstName} ${project.manager.lastName}`
          : null,
        deliveryDate: project.deliveryDate,
        completedAt: project.completedAt,
        daysLate: daysLate(project),
        onTime: daysLate(project) === 0,
      }))
      .sort((a, b) => b.daysLate - a.daysLate),
    open: open
      .map((project) => ({
        id: project.id,
        reference: project.reference,
        name: project.name,
        client: project.client.companyName,
        status: project.status,
        progress: project.progress,
        deliveryDate: project.deliveryDate,
        isSlipping: project.deliveryDate !== null && project.deliveryDate < now,
        tasks: project._count.tasks,
      }))
      .sort((a, b) => (a.deliveryDate?.getTime() ?? Infinity) - (b.deliveryDate?.getTime() ?? Infinity)),
  };
}

/* ------------------------------------------------------------------ */
/* Outstanding                                                         */
/* ------------------------------------------------------------------ */

export async function outstandingReport() {
  const now = new Date();

  const payments = await prisma.payment.findMany({
    where: {
      deletedAt: null,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIALLY_PAID, PaymentStatus.OVERDUE] },
    },
    select: {
      id: true,
      reference: true,
      title: true,
      amount: true,
      paidAmount: true,
      currency: true,
      dueDate: true,
      status: true,
      client: { select: { id: true, companyName: true } },
      project: { select: { id: true, name: true } },
    },
  });

  const owed = (payment: (typeof payments)[number]): number =>
    round2(Number(payment.amount) - Number(payment.paidAmount));

  const byClient = new Map<
    string,
    { id: string; name: string; count: number; outstanding: MoneyByCurrency; overdue: MoneyByCurrency }
  >();

  for (const payment of payments) {
    const entry = byClient.get(payment.client.id) ?? {
      id: payment.client.id,
      name: payment.client.companyName,
      count: 0,
      outstanding: { ...ZERO },
      overdue: { ...ZERO },
    };
    entry.count += 1;
    entry.outstanding[payment.currency] = round2(
      entry.outstanding[payment.currency] + owed(payment),
    );
    if (payment.dueDate !== null && payment.dueDate < now) {
      entry.overdue[payment.currency] = round2(entry.overdue[payment.currency] + owed(payment));
    }
    byClient.set(payment.client.id, entry);
  }

  return {
    totals: {
      count: payments.length,
      outstanding: sumByCurrency(
        payments.map((payment) => ({ currency: payment.currency, amount: owed(payment) })),
      ),
      overdue: sumByCurrency(
        payments
          .filter((payment) => payment.dueDate !== null && payment.dueDate < now)
          .map((payment) => ({ currency: payment.currency, amount: owed(payment) })),
      ),
    },
    byClient: [...byClient.values()].sort(
      (a, b) =>
        b.outstanding.INR + b.outstanding.USD - (a.outstanding.INR + a.outstanding.USD),
    ),
    items: payments
      .map((payment) => ({
        id: payment.id,
        reference: payment.reference,
        title: payment.title,
        client: payment.client.companyName,
        project: payment.project?.name ?? null,
        currency: payment.currency,
        amount: Number(payment.amount),
        received: Number(payment.paidAmount),
        outstanding: owed(payment),
        dueDate: payment.dueDate,
        daysLate:
          payment.dueDate === null || payment.dueDate >= now
            ? 0
            : Math.floor((now.getTime() - payment.dueDate.getTime()) / 86_400_000),
      }))
      .sort((a, b) => b.daysLate - a.daysLate),
  };
}
