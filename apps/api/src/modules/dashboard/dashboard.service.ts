import {
  CLOSED_TASK_STATUSES,
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
import { dayRange, forwardRange, monthRange, recentMonths } from '../../lib/time.js';
import { visibilityFilter as leadVisibility } from '../leads/leads.service.js';
import { projectVisibilityFilter } from '../projects/projects.service.js';
import { taskVisibilityFilter } from '../tasks/tasks.service.js';

export interface Viewer {
  id: string;
  role: UserRole;
  timezone: string;
}

/** Money is reported per currency; INR and USD are never added together. */
export type MoneyByCurrency = Record<Currency, number>;

const ZERO_MONEY: MoneyByCurrency = { INR: 0, USD: 0 };

const CLOSED_PROJECT_STATUSES: ProjectStatus[] = [
  ProjectStatus.COMPLETED,
  ProjectStatus.CANCELLED,
];

const UNSETTLED_PAYMENTS: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.PARTIALLY_PAID,
  PaymentStatus.OVERDUE,
];

function sumByCurrency(
  rows: Array<{ currency: Currency; amount: number }>,
): MoneyByCurrency {
  return rows.reduce<MoneyByCurrency>(
    (totals, row) => ({ ...totals, [row.currency]: totals[row.currency] + row.amount }),
    { ...ZERO_MONEY },
  );
}

/* ------------------------------------------------------------------ */
/* Overview — what needs attention today                               */
/* ------------------------------------------------------------------ */

export async function getOverview(viewer: Viewer) {
  const now = new Date();
  const today = dayRange(now, viewer.timezone);
  const week = forwardRange(now, viewer.timezone, 7);
  const thisMonth = monthRange(now, viewer.timezone);

  const leadScope: Prisma.LeadWhereInput = { deletedAt: null, ...leadVisibility(viewer) };
  const projectScope: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...projectVisibilityFilter(viewer),
  };
  const taskScope: Prisma.TaskWhereInput = { deletedAt: null, ...taskVisibilityFilter(viewer) };

  const [
    totalLeads,
    activeLeads,
    wonLeads,
    lostLeads,
    openLeadValues,
    wonDealValues,
    monthlyReceived,
    pendingPayments,
    activeProjects,
    projectsDueSoon,
    overdueTasks,
    followUpsToday,
    tasksToday,
    meetingsToday,
    overdueFollowUps,
    overdueTaskList,
    overdueProjects,
    overduePayments,
    upcomingTasks,
    upcomingProjects,
    upcomingMeetings,
    upcomingPayments,
    /*
     * Read in parallel, not in one transaction.
     *
     * These 22 reads were a `$transaction([...])`, which Prisma runs
     * sequentially. Against a remote database that is 22 round trips in series —
     * 5.4s measured, past Prisma's 5s transaction ceiling, so the endpoint
     * returned 500 rather than a dashboard.
     *
     * The batch bought a consistent snapshot across the reads. A dashboard does
     * not need one: each panel is an independent headline figure, and the two
     * sections below already read with Promise.all for the same reason.
     */
  ] = await Promise.all([
    prisma.lead.count({ where: leadScope }),
    prisma.lead.count({ where: { ...leadScope, status: { notIn: TERMINAL_LEAD_STATUSES } } }),
    prisma.lead.count({ where: { ...leadScope, status: LeadStatus.WON } }),
    prisma.lead.count({ where: { ...leadScope, status: LeadStatus.LOST } }),

    prisma.lead.findMany({
      where: { ...leadScope, status: { notIn: TERMINAL_LEAD_STATUSES } },
      select: { expectedValue: true, currency: true },
    }),
    prisma.deal.findMany({
      where: { deletedAt: null, stage: DealStage.WON },
      select: { value: true, currency: true },
    }),
    prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: { not: PaymentStatus.CANCELLED },
        paidAt: { gte: thisMonth.start, lte: thisMonth.end },
      },
      select: { paidAmount: true, currency: true },
    }),
    prisma.payment.findMany({
      where: { deletedAt: null, status: { in: UNSETTLED_PAYMENTS } },
      select: { amount: true, paidAmount: true, currency: true },
    }),

    prisma.project.count({
      where: { ...projectScope, status: { notIn: CLOSED_PROJECT_STATUSES } },
    }),
    prisma.project.count({
      where: {
        ...projectScope,
        status: { notIn: CLOSED_PROJECT_STATUSES },
        deliveryDate: { gte: now, lte: new Date(now.getTime() + 14 * 86_400_000) },
      },
    }),
    prisma.task.count({
      where: { ...taskScope, status: { notIn: CLOSED_TASK_STATUSES }, dueAt: { lt: now } },
    }),

    // Today
    prisma.lead.findMany({
      where: {
        ...leadScope,
        status: { notIn: TERMINAL_LEAD_STATUSES },
        nextFollowUpAt: { gte: today.start, lte: today.end },
      },
      orderBy: { nextFollowUpAt: 'asc' },
      select: {
        id: true,
        reference: true,
        companyName: true,
        contactPerson: true,
        nextFollowUpAt: true,
        priority: true,
      },
    }),
    prisma.task.findMany({
      where: {
        ...taskScope,
        status: { notIn: CLOSED_TASK_STATUSES },
        dueAt: { gte: today.start, lte: today.end },
      },
      orderBy: { dueAt: 'asc' },
      select: taskCardSelect,
    }),
    prisma.meeting.findMany({
      where: { deletedAt: null, startsAt: { gte: today.start, lte: today.end } },
      orderBy: { startsAt: 'asc' },
      select: meetingCardSelect,
    }),

    // Overdue
    prisma.lead.findMany({
      where: {
        ...leadScope,
        status: { notIn: TERMINAL_LEAD_STATUSES },
        nextFollowUpAt: { lt: today.start },
      },
      orderBy: { nextFollowUpAt: 'asc' },
      take: 10,
      select: {
        id: true,
        reference: true,
        companyName: true,
        contactPerson: true,
        nextFollowUpAt: true,
        priority: true,
      },
    }),
    prisma.task.findMany({
      where: { ...taskScope, status: { notIn: CLOSED_TASK_STATUSES }, dueAt: { lt: now } },
      orderBy: { dueAt: 'asc' },
      take: 10,
      select: taskCardSelect,
    }),
    prisma.project.findMany({
      where: {
        ...projectScope,
        status: { notIn: CLOSED_PROJECT_STATUSES },
        deliveryDate: { lt: today.start },
      },
      orderBy: { deliveryDate: 'asc' },
      take: 10,
      select: projectCardSelect,
    }),
    prisma.payment.findMany({
      where: { deletedAt: null, status: { in: UNSETTLED_PAYMENTS }, dueDate: { lt: today.start } },
      orderBy: { dueDate: 'asc' },
      take: 10,
      select: paymentCardSelect,
    }),

    // Next seven days
    prisma.task.findMany({
      where: {
        ...taskScope,
        status: { notIn: CLOSED_TASK_STATUSES },
        dueAt: { gt: today.end, lte: week.end },
      },
      orderBy: { dueAt: 'asc' },
      take: 10,
      select: taskCardSelect,
    }),
    prisma.project.findMany({
      where: {
        ...projectScope,
        status: { notIn: CLOSED_PROJECT_STATUSES },
        deliveryDate: { gt: today.end, lte: week.end },
      },
      orderBy: { deliveryDate: 'asc' },
      take: 10,
      select: projectCardSelect,
    }),
    prisma.meeting.findMany({
      where: { deletedAt: null, startsAt: { gt: today.end, lte: week.end } },
      orderBy: { startsAt: 'asc' },
      take: 10,
      select: meetingCardSelect,
    }),
    prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: { in: UNSETTLED_PAYMENTS },
        dueDate: { gt: today.end, lte: week.end },
      },
      orderBy: { dueDate: 'asc' },
      take: 10,
      select: paymentCardSelect,
    }),
  ]);

  return {
    generatedAt: now.toISOString(),
    timezone: viewer.timezone,
    kpis: {
      totalLeads,
      activeLeads,
      wonLeads,
      lostLeads,
      pipelineValue: sumByCurrency(
        openLeadValues.map((lead) => ({
          currency: lead.currency,
          amount: Number(lead.expectedValue ?? 0),
        })),
      ),
      wonDealValue: sumByCurrency(
        wonDealValues.map((deal) => ({ currency: deal.currency, amount: Number(deal.value) })),
      ),
      monthlyRevenue: sumByCurrency(
        monthlyReceived.map((payment) => ({
          currency: payment.currency,
          amount: Number(payment.paidAmount),
        })),
      ),
      pendingPayments: sumByCurrency(
        pendingPayments.map((payment) => ({
          currency: payment.currency,
          amount: Number(payment.amount) - Number(payment.paidAmount),
        })),
      ),
      activeProjects,
      projectsDueSoon,
      overdueTasks,
    },
    today: {
      followUps: followUpsToday,
      tasks: tasksToday.map(toTaskCard),
      meetings: meetingsToday,
    },
    overdue: {
      followUps: overdueFollowUps,
      tasks: overdueTaskList.map(toTaskCard),
      projects: overdueProjects.map(toProjectCard),
      payments: overduePayments.map(toPaymentCard),
    },
    upcoming: {
      tasks: upcomingTasks.map(toTaskCard),
      projects: upcomingProjects.map(toProjectCard),
      meetings: upcomingMeetings,
      payments: upcomingPayments.map(toPaymentCard),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Card projections                                                    */
/* ------------------------------------------------------------------ */

const taskCardSelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  priority: true,
  dueAt: true,
  assignee: { select: { id: true, firstName: true, lastName: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskSelect;

const projectCardSelect = {
  id: true,
  reference: true,
  name: true,
  status: true,
  progress: true,
  deliveryDate: true,
  value: true,
  currency: true,
  client: { select: { id: true, companyName: true } },
} satisfies Prisma.ProjectSelect;

const paymentCardSelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  amount: true,
  paidAmount: true,
  currency: true,
  dueDate: true,
  client: { select: { id: true, companyName: true } },
} satisfies Prisma.PaymentSelect;

const meetingCardSelect = {
  id: true,
  title: true,
  status: true,
  startsAt: true,
  endsAt: true,
  location: true,
  meetingUrl: true,
  client: { select: { id: true, companyName: true } },
  lead: { select: { id: true, companyName: true } },
} satisfies Prisma.MeetingSelect;

type TaskCard = Prisma.TaskGetPayload<{ select: typeof taskCardSelect }>;
type ProjectCard = Prisma.ProjectGetPayload<{ select: typeof projectCardSelect }>;
type PaymentCard = Prisma.PaymentGetPayload<{ select: typeof paymentCardSelect }>;

function toTaskCard(task: TaskCard) {
  return task;
}

function toProjectCard(project: ProjectCard) {
  return { ...project, value: Number(project.value) };
}

function toPaymentCard(payment: PaymentCard) {
  return {
    ...payment,
    amount: Number(payment.amount),
    paidAmount: Number(payment.paidAmount),
    outstanding: Number(payment.amount) - Number(payment.paidAmount),
  };
}

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export async function getSales(viewer: Viewer, months = 6) {
  const now = new Date();
  const leadScope: Prisma.LeadWhereInput = { deletedAt: null, ...leadVisibility(viewer) };
  const windows = recentMonths(now, viewer.timezone, months);

  const [leads, wonDeals, receipts] = await Promise.all([
    prisma.lead.findMany({
      where: leadScope,
      select: { status: true, source: true, currency: true, expectedValue: true },
    }),
    prisma.deal.findMany({
      where: {
        deletedAt: null,
        stage: DealStage.WON,
        closedAt: { gte: windows[0]!.start, lte: windows[windows.length - 1]!.end },
      },
      select: { value: true, currency: true, closedAt: true },
    }),
    prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: { not: PaymentStatus.CANCELLED },
        paidAt: { gte: windows[0]!.start, lte: windows[windows.length - 1]!.end },
      },
      select: { paidAmount: true, currency: true, paidAt: true },
    }),
  ]);

  const stageOrder: LeadStatus[] = [
    LeadStatus.NEW,
    LeadStatus.CONTACTED,
    LeadStatus.QUALIFIED,
    LeadStatus.MEETING,
    LeadStatus.PROPOSAL,
    LeadStatus.NEGOTIATION,
  ];

  const pipeline = stageOrder.map((status) => {
    const inStage = leads.filter((lead) => lead.status === status);
    return {
      status,
      count: inStage.length,
      value: sumByCurrency(
        inStage.map((lead) => ({
          currency: lead.currency,
          amount: Number(lead.expectedValue ?? 0),
        })),
      ),
    };
  });

  const sources = new Map<LeadSource, { total: number; won: number; lost: number }>();
  for (const lead of leads) {
    const entry = sources.get(lead.source) ?? { total: 0, won: 0, lost: 0 };
    entry.total += 1;
    if (lead.status === LeadStatus.WON) entry.won += 1;
    if (lead.status === LeadStatus.LOST) entry.lost += 1;
    sources.set(lead.source, entry);
  }

  const won = leads.filter((lead) => lead.status === LeadStatus.WON).length;
  const lost = leads.filter((lead) => lead.status === LeadStatus.LOST).length;
  const decided = won + lost;

  return {
    pipeline,
    // Conversion is won out of *decided* leads. Counting open ones as losses
    // would make a healthy pipeline look like a failing one.
    conversion: {
      won,
      lost,
      decided,
      rate: decided === 0 ? null : Math.round((won / decided) * 1000) / 10,
    },
    sources: Array.from(sources.entries())
      .map(([source, entry]) => ({
        source,
        ...entry,
        rate:
          entry.won + entry.lost === 0
            ? null
            : Math.round((entry.won / (entry.won + entry.lost)) * 1000) / 10,
      }))
      .sort((a, b) => b.total - a.total),
    revenueByMonth: windows.map((window) => ({
      key: window.key,
      label: window.label,
      won: sumByCurrency(
        wonDeals
          .filter((deal) => deal.closedAt && deal.closedAt >= window.start && deal.closedAt <= window.end)
          .map((deal) => ({ currency: deal.currency, amount: Number(deal.value) })),
      ),
      received: sumByCurrency(
        receipts
          .filter((payment) => payment.paidAt && payment.paidAt >= window.start && payment.paidAt <= window.end)
          .map((payment) => ({
            currency: payment.currency,
            amount: Number(payment.paidAmount),
          })),
      ),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

export async function getDelivery(viewer: Viewer) {
  const now = new Date();
  const projectScope: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...projectVisibilityFilter(viewer),
  };
  const taskScope: Prisma.TaskWhereInput = { deletedAt: null, ...taskVisibilityFilter(viewer) };

  const [projects, taskStatuses, workload] = await Promise.all([
    prisma.project.findMany({
      where: projectScope,
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        progress: true,
        deliveryDate: true,
        client: { select: { id: true, companyName: true } },
      },
    }),
    prisma.task.groupBy({
      by: ['status'],
      where: taskScope,
      orderBy: { status: 'asc' },
      _count: true,
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { ...taskScope, status: { notIn: CLOSED_TASK_STATUSES } },
      orderBy: { assigneeId: 'asc' },
      _count: true,
    }),
  ]);

  const open = projects.filter(
    (project) => !CLOSED_PROJECT_STATUSES.includes(project.status),
  );
  const delayed = open.filter(
    (project) => project.deliveryDate !== null && project.deliveryDate < now,
  );

  // Who the open tasks belong to, so a stalled queue is visible.
  const assigneeIds = workload
    .map((entry) => entry.assigneeId)
    .filter((id): id is string => id !== null);
  const people =
    assigneeIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, firstName: true, lastName: true },
        });

  return {
    projectsByStatus: Object.values(ProjectStatus).map((status) => ({
      status,
      count: projects.filter((project) => project.status === status).length,
    })),
    tasksByStatus: taskStatuses.map((entry) => ({ status: entry.status, count: entry._count })),
    averageCompletion:
      open.length === 0
        ? 0
        : Math.round(open.reduce((sum, project) => sum + project.progress, 0) / open.length),
    delayed: delayed
      .sort((a, b) => (a.deliveryDate?.getTime() ?? 0) - (b.deliveryDate?.getTime() ?? 0))
      .slice(0, 10),
    workload: workload
      .map((entry) => {
        const person = people.find((candidate) => candidate.id === entry.assigneeId);
        return {
          userId: entry.assigneeId,
          name: person ? `${person.firstName} ${person.lastName}` : 'Unassigned',
          openTasks: entry._count,
        };
      })
      .sort((a, b) => b.openTasks - a.openTasks),
  };
}
