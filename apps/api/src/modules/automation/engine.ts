import {
  AutomationRule,
  CLOSED_TASK_STATUSES,
  EntityType,
  MilestoneStatus,
  PaymentStatus,
  Priority,
  ProjectStatus,
  QuotationStatus,
  TERMINAL_LEAD_STATUSES,
  MeetingStatus,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { dayRange } from '../../lib/time.js';
import * as notifications from '../notifications/notifications.service.js';
import {
  compose,
  evaluate,
  notificationTypeFor,
  priorityFor,
  type WatchItem,
} from './rules.js';

/**
 * The automation engine.
 *
 * It runs on a schedule, asks the database what has a deadline, hands each one
 * to the pure rule evaluator, and turns the answers into notifications — once.
 * The once is the whole point, and it is enforced by a unique constraint rather
 * than by a check-then-write, so two workers racing cannot both win.
 */

/** How far ahead to look. Nothing beyond this can be ripe for any rule. */
const HORIZON_DAYS = 4;
/** How far back to look, so a restart after downtime still catches what is late. */
const LOOKBACK_DAYS = 30;

export interface RunSummary {
  scannedAt: string;
  watched: number;
  evaluated: number;
  notified: number;
  suppressed: number;
  alreadyDone: number;
  quotationsExpired: number;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/* Collecting what has a deadline                                      */
/* ------------------------------------------------------------------ */

async function collectWatchItems(now: Date): Promise<WatchItem[]> {
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const lookback = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const window = { gte: lookback, lte: horizon };

  const [tasks, leads, meetings, milestones, projects, payments, quotations] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,
        assigneeId: { not: null },
        status: { notIn: CLOSED_TASK_STATUSES },
        dueAt: window,
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        priority: true,
        assigneeId: true,
        reference: true,
        project: { select: { name: true } },
        assignee: { select: { timezone: true } },
      },
    }),

    prisma.lead.findMany({
      where: {
        deletedAt: null,
        assignedToId: { not: null },
        status: { notIn: TERMINAL_LEAD_STATUSES },
        nextFollowUpAt: window,
      },
      select: {
        id: true,
        companyName: true,
        contactPerson: true,
        nextFollowUpAt: true,
        priority: true,
        assignedToId: true,
        assignedTo: { select: { timezone: true } },
      },
    }),

    prisma.meeting.findMany({
      where: { deletedAt: null, status: MeetingStatus.SCHEDULED, startsAt: window },
      select: {
        id: true,
        title: true,
        startsAt: true,
        organizerId: true,
        organizer: { select: { timezone: true } },
        client: { select: { companyName: true } },
        lead: { select: { companyName: true } },
        attendees: { select: { userId: true } },
      },
    }),

    prisma.milestone.findMany({
      where: {
        deletedAt: null,
        assigneeId: { not: null },
        status: { notIn: [MilestoneStatus.COMPLETED, MilestoneStatus.CANCELLED] },
        dueDate: window,
      },
      select: {
        id: true,
        name: true,
        dueDate: true,
        assigneeId: true,
        assignee: { select: { timezone: true } },
        project: { select: { id: true, name: true } },
      },
    }),

    prisma.project.findMany({
      where: {
        deletedAt: null,
        managerId: { not: null },
        status: { notIn: [ProjectStatus.COMPLETED, ProjectStatus.CANCELLED] },
        deliveryDate: window,
      },
      select: {
        id: true,
        name: true,
        deliveryDate: true,
        priority: true,
        managerId: true,
        manager: { select: { timezone: true } },
        client: { select: { companyName: true } },
      },
    }),

    prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIALLY_PAID, PaymentStatus.OVERDUE] },
        dueDate: window,
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        amount: true,
        paidAmount: true,
        currency: true,
        recordedById: true,
        client: { select: { companyName: true, accountManagerId: true } },
      },
    }),

    prisma.quotation.findMany({
      where: {
        deletedAt: null,
        status: {
          notIn: [QuotationStatus.ACCEPTED, QuotationStatus.REJECTED, QuotationStatus.EXPIRED],
        },
        validUntil: window,
      },
      select: {
        id: true,
        reference: true,
        title: true,
        validUntil: true,
        total: true,
        currency: true,
        createdById: true,
        createdBy: { select: { timezone: true } },
        client: { select: { companyName: true } },
        lead: { select: { companyName: true } },
      },
    }),
  ]);

  const fallbackZone = env.DEFAULT_TIMEZONE;
  const items: WatchItem[] = [];

  for (const task of tasks) {
    items.push({
      entityType: EntityType.TASK,
      entityId: task.id,
      dueAt: task.dueAt!,
      recipientIds: [task.assigneeId!],
      timezone: task.assignee?.timezone ?? fallbackZone,
      title: task.title,
      context: task.project?.name ?? task.reference,
      actionUrl: '/tasks',
      priority: task.priority,
    });
  }

  for (const lead of leads) {
    items.push({
      entityType: EntityType.LEAD,
      entityId: lead.id,
      dueAt: lead.nextFollowUpAt!,
      recipientIds: [lead.assignedToId!],
      timezone: lead.assignedTo?.timezone ?? fallbackZone,
      title: lead.companyName,
      context: lead.contactPerson,
      actionUrl: `/leads/${lead.id}`,
      priority: lead.priority,
    });
  }

  for (const meeting of meetings) {
    // Everyone expected in the room hears about it, not just the organiser.
    const recipients = new Set<string>();
    if (meeting.organizerId) recipients.add(meeting.organizerId);
    for (const attendee of meeting.attendees) {
      if (attendee.userId) recipients.add(attendee.userId);
    }

    items.push({
      entityType: EntityType.MEETING,
      entityId: meeting.id,
      dueAt: meeting.startsAt,
      recipientIds: [...recipients],
      timezone: meeting.organizer?.timezone ?? fallbackZone,
      title: meeting.title,
      context: meeting.client?.companyName ?? meeting.lead?.companyName ?? null,
      actionUrl: '/calendar',
      priority: Priority.MEDIUM,
    });
  }

  for (const milestone of milestones) {
    items.push({
      entityType: EntityType.MILESTONE,
      entityId: milestone.id,
      dueAt: milestone.dueDate!,
      recipientIds: [milestone.assigneeId!],
      timezone: milestone.assignee?.timezone ?? fallbackZone,
      title: milestone.name,
      context: milestone.project.name,
      actionUrl: `/projects/${milestone.project.id}`,
      priority: Priority.MEDIUM,
    });
  }

  for (const project of projects) {
    items.push({
      entityType: EntityType.PROJECT,
      entityId: project.id,
      // A delivery date is a day; the deadline is the end of it.
      dueAt: dayRange(project.deliveryDate!, project.manager?.timezone ?? fallbackZone).end,
      recipientIds: [project.managerId!],
      timezone: project.manager?.timezone ?? fallbackZone,
      title: project.name,
      context: project.client.companyName,
      actionUrl: `/projects/${project.id}`,
      priority: project.priority,
    });
  }

  for (const payment of payments) {
    const recipients = [payment.recordedById, payment.client.accountManagerId].filter(
      (id): id is string => Boolean(id),
    );
    if (recipients.length === 0) continue;

    items.push({
      entityType: EntityType.PAYMENT,
      entityId: payment.id,
      dueAt: dayRange(payment.dueDate!, fallbackZone).end,
      recipientIds: [...new Set(recipients)],
      timezone: fallbackZone,
      title: payment.title,
      context: payment.client.companyName,
      actionUrl: '/payments',
      priority: Priority.HIGH,
      amount: {
        value: Number(payment.amount) - Number(payment.paidAmount),
        currency: payment.currency,
      },
    });
  }

  for (const quotation of quotations) {
    if (!quotation.createdById) continue;

    items.push({
      entityType: EntityType.QUOTATION,
      entityId: quotation.id,
      dueAt: dayRange(
        quotation.validUntil!,
        quotation.createdBy?.timezone ?? fallbackZone,
      ).end,
      recipientIds: [quotation.createdById],
      timezone: quotation.createdBy?.timezone ?? fallbackZone,
      title: quotation.title,
      context: quotation.client?.companyName ?? quotation.lead?.companyName ?? quotation.reference,
      actionUrl: `/quotations/${quotation.id}`,
      priority: Priority.HIGH,
      amount: { value: Number(quotation.total), currency: quotation.currency },
    });
  }

  return items;
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

/**
 * Claims a reminder.
 *
 * The insert *is* the check. Two workers scanning at once both try to write the
 * same dedupe key; the unique index lets exactly one through and the other gets
 * P2002 and stands down. A read-then-write would let both send.
 */
async function claim(
  item: WatchItem,
  rule: AutomationRule,
  dedupeKey: string,
  threshold: Date,
  notificationCount: number,
): Promise<boolean> {
  try {
    await prisma.automationExecution.create({
      data: {
        entityType: item.entityType,
        entityId: item.entityId,
        rule,
        dedupeKey,
        scheduledFor: threshold,
        notificationCount,
        payload: { title: item.title, recipients: item.recipientIds.length },
      },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      // Already announced. This is the normal path on every rerun.
      return false;
    }
    throw error;
  }
}

export async function run(now = new Date()): Promise<RunSummary> {
  const startedAt = Date.now();

  const items = await collectWatchItems(now);
  let evaluated = 0;
  let notified = 0;
  let suppressed = 0;
  let alreadyDone = 0;

  for (const item of items) {
    const outcomes = evaluate(item, now);
    evaluated += outcomes.length;

    for (const outcome of outcomes) {
      if (outcome.suppressed) {
        // Ripe, but a more urgent rule is speaking. Recorded so it never
        // surfaces later as if it were news.
        const claimed = await claim(item, outcome.rule, outcome.dedupeKey, outcome.threshold, 0);
        if (claimed) suppressed += 1;
        else alreadyDone += 1;
        continue;
      }

      const claimed = await claim(
        item,
        outcome.rule,
        outcome.dedupeKey,
        outcome.threshold,
        item.recipientIds.length,
      );

      if (!claimed) {
        alreadyDone += 1;
        continue;
      }

      const { title, message } = compose(item, outcome.rule);

      await notifications.createMany(
        item.recipientIds.map((userId) => ({
          userId,
          type: notificationTypeFor(item.entityType),
          priority: priorityFor(outcome.rule, item),
          title,
          message,
          entityType: item.entityType,
          entityId: item.entityId,
          actionUrl: item.actionUrl,
        })),
      );

      notified += item.recipientIds.length;
    }
  }

  const quotationsExpired = await expireQuotations(now);

  const summary: RunSummary = {
    scannedAt: now.toISOString(),
    watched: items.length,
    evaluated,
    notified,
    suppressed,
    alreadyDone,
    quotationsExpired,
    durationMs: Date.now() - startedAt,
  };

  logger.info(summary, 'Automation scan finished');
  return summary;
}

/**
 * A quotation past its validity date is expired — that is a fact about the
 * record, not just something to mention, so the status moves too.
 */
async function expireQuotations(now: Date): Promise<number> {
  const result = await prisma.quotation.updateMany({
    where: {
      deletedAt: null,
      validUntil: { lt: startOfToday(now) },
      status: {
        notIn: [QuotationStatus.ACCEPTED, QuotationStatus.REJECTED, QuotationStatus.EXPIRED],
      },
    },
    data: { status: QuotationStatus.EXPIRED },
  });
  return result.count;
}

function startOfToday(now: Date): Date {
  return dayRange(now, env.DEFAULT_TIMEZONE).start;
}

/** Removes read notifications older than the retention window. */
export async function pruneNotifications(olderThanDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const result = await prisma.notification.deleteMany({
    where: { readAt: { not: null, lt: cutoff } },
  });
  return result.count;
}

export type { Prisma };
