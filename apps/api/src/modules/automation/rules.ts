import {
  AutomationRule,
  EntityType,
  NotificationType,
  Priority,
  type Currency,
} from '@probild/shared';
import { dayRange } from '../../lib/time.js';

/**
 * Rule evaluation, as a pure function.
 *
 * Nothing here touches the database or the queue: given the deadlines that
 * exist and the current instant, it decides which reminders are due. That makes
 * the part of the system most likely to be subtly wrong the part that is
 * easiest to test exhaustively.
 */

/** One thing with a deadline that somebody is responsible for. */
export interface WatchItem {
  entityType: EntityType;
  entityId: string;
  /** The moment the thing is due, in UTC. */
  dueAt: Date;
  /** Who hears about it. Reminders go to the owner, not to everyone. */
  recipientIds: string[];
  /** The recipient's wall clock, for the calendar-based rules. */
  timezone: string;
  /** Shown in the notification. */
  title: string;
  context: string | null;
  actionUrl: string;
  priority: Priority;
  /** Included in the message when the thing carries an amount. */
  amount?: { value: number; currency: Currency } | null;
}

/**
 * Which rules apply to which kind of deadline.
 *
 * A meeting does not need an "overdue" nag — it either happened or it did not.
 * A quotation expires rather than going overdue. The differences are the point.
 */
export const RULES_BY_ENTITY: Partial<Record<EntityType, AutomationRule[]>> = {
  [EntityType.TASK]: [
    AutomationRule.DUE_TOMORROW,
    AutomationRule.DUE_TODAY,
    AutomationRule.DUE_IN_2_HOURS,
    AutomationRule.DUE_NOW,
    AutomationRule.OVERDUE,
  ],
  [EntityType.LEAD]: [
    AutomationRule.DUE_TOMORROW,
    AutomationRule.DUE_TODAY,
    AutomationRule.OVERDUE,
  ],
  [EntityType.MEETING]: [AutomationRule.DUE_TOMORROW, AutomationRule.DUE_IN_2_HOURS],
  [EntityType.MILESTONE]: [
    AutomationRule.DUE_IN_3_DAYS,
    AutomationRule.DUE_TOMORROW,
    AutomationRule.OVERDUE,
  ],
  [EntityType.PROJECT]: [
    AutomationRule.DUE_IN_3_DAYS,
    AutomationRule.DUE_TOMORROW,
    AutomationRule.OVERDUE,
  ],
  [EntityType.PAYMENT]: [
    AutomationRule.DUE_IN_3_DAYS,
    AutomationRule.DUE_TODAY,
    AutomationRule.OVERDUE,
  ],
  [EntityType.QUOTATION]: [AutomationRule.DUE_IN_3_DAYS, AutomationRule.EXPIRED],
};

/**
 * Most urgent first.
 *
 * Order matters: on any scan only the most urgent newly-ripe rule speaks, and
 * the rest are recorded silently. Without that, a task created an hour before
 * its deadline would fire five reminders at once.
 */
export const RULE_URGENCY: AutomationRule[] = [
  AutomationRule.OVERDUE,
  AutomationRule.EXPIRED,
  AutomationRule.DUE_NOW,
  AutomationRule.DUE_IN_2_HOURS,
  AutomationRule.DUE_TODAY,
  AutomationRule.DUE_TOMORROW,
  AutomationRule.DUE_IN_3_DAYS,
];

/** The instant a rule becomes ripe for a given deadline. */
export function thresholdFor(rule: AutomationRule, item: WatchItem): Date {
  const due = item.dueAt;

  switch (rule) {
    case AutomationRule.DUE_IN_3_DAYS:
      return new Date(due.getTime() - 3 * 86_400_000);

    // "Tomorrow" and "today" are calendar words, so they are answered on the
    // recipient's wall clock rather than by subtracting hours from the deadline.
    case AutomationRule.DUE_TOMORROW: {
      const dueDay = dayRange(due, item.timezone);
      return new Date(dueDay.start.getTime() - 86_400_000);
    }
    case AutomationRule.DUE_TODAY:
      return dayRange(due, item.timezone).start;

    case AutomationRule.DUE_IN_2_HOURS:
      return new Date(due.getTime() - 2 * 3_600_000);

    case AutomationRule.DUE_NOW:
      return due;

    case AutomationRule.OVERDUE:
    case AutomationRule.EXPIRED:
      // Strictly after the deadline, so "due now" and "overdue" never tie.
      return new Date(due.getTime() + 60_000);

    default:
      return due;
  }
}

/**
 * The identity of one reminder.
 *
 * The deadline is part of the key on purpose: move a task's due date and its
 * reminders legitimately fire again for the new date, but nothing repeats for
 * a date that has already been announced.
 */
export function dedupeKeyFor(item: WatchItem, rule: AutomationRule): string {
  return `${item.entityType}:${item.entityId}:${rule}:${item.dueAt.toISOString()}`;
}

export interface RuleOutcome {
  rule: AutomationRule;
  dedupeKey: string;
  threshold: Date;
  /** True when the rule is ripe but a more urgent one is speaking instead. */
  suppressed: boolean;
}

/**
 * Decides what to do about one deadline, right now.
 *
 * Every ripe rule is returned so the caller can record it; exactly one of them
 * — the most urgent — is unsuppressed and becomes a notification.
 */
export function evaluate(item: WatchItem, now: Date): RuleOutcome[] {
  const applicable = RULES_BY_ENTITY[item.entityType] ?? [];

  const ripe = RULE_URGENCY.filter(
    (rule) => applicable.includes(rule) && thresholdFor(rule, item) <= now,
  );

  return ripe.map((rule, index) => ({
    rule,
    dedupeKey: dedupeKeyFor(item, rule),
    threshold: thresholdFor(rule, item),
    suppressed: index > 0,
  }));
}

/* ------------------------------------------------------------------ */
/* Wording                                                             */
/* ------------------------------------------------------------------ */

const NOTIFICATION_TYPES: Partial<Record<EntityType, NotificationType>> = {
  [EntityType.TASK]: NotificationType.TASK,
  [EntityType.LEAD]: NotificationType.FOLLOW_UP,
  [EntityType.MEETING]: NotificationType.MEETING,
  [EntityType.MILESTONE]: NotificationType.MILESTONE,
  [EntityType.PROJECT]: NotificationType.PROJECT,
  [EntityType.PAYMENT]: NotificationType.PAYMENT,
  [EntityType.QUOTATION]: NotificationType.QUOTATION,
};

export function notificationTypeFor(entityType: EntityType): NotificationType {
  return NOTIFICATION_TYPES[entityType] ?? NotificationType.SYSTEM;
}

/** A late thing is urgent whatever the record says; otherwise the record decides. */
export function priorityFor(rule: AutomationRule, item: WatchItem): Priority {
  if (rule === AutomationRule.OVERDUE || rule === AutomationRule.EXPIRED) {
    return Priority.URGENT;
  }
  if (rule === AutomationRule.DUE_NOW || rule === AutomationRule.DUE_IN_2_HOURS) {
    return item.priority === Priority.LOW ? Priority.MEDIUM : Priority.HIGH;
  }
  return item.priority;
}

const NOUNS: Partial<Record<EntityType, string>> = {
  [EntityType.TASK]: 'Task',
  [EntityType.LEAD]: 'Follow-up',
  [EntityType.MEETING]: 'Meeting',
  [EntityType.MILESTONE]: 'Milestone',
  [EntityType.PROJECT]: 'Project',
  [EntityType.PAYMENT]: 'Payment',
  [EntityType.QUOTATION]: 'Quotation',
};

/**
 * What the notification says.
 *
 * Plain sentences, in the same voice as the rest of the app — the reminder tells
 * you what is happening and when, not that "an automation rule has triggered".
 */
export function compose(
  item: WatchItem,
  rule: AutomationRule,
): { title: string; message: string } {
  const noun = NOUNS[item.entityType] ?? 'Item';
  const when = describeWhen(rule);
  const context = item.context ? ` · ${item.context}` : '';

  const title =
    item.entityType === EntityType.LEAD
      ? `Follow up with ${item.title}`
      : `${noun} ${when}: ${item.title}`;

  const amount =
    item.amount && item.amount.value > 0
      ? ` It is for ${formatAmount(item.amount.value, item.amount.currency)}.`
      : '';

  const message =
    rule === AutomationRule.OVERDUE
      ? `"${item.title}"${context} passed its ${dueWord(item.entityType)} and is still open.${amount}`
      : rule === AutomationRule.EXPIRED
        ? `"${item.title}"${context} has passed its validity date. Send a revision or close it.${amount}`
        : `"${item.title}"${context} is ${when}.${amount}`;

  return { title, message };
}

function describeWhen(rule: AutomationRule): string {
  switch (rule) {
    case AutomationRule.DUE_IN_3_DAYS:
      return 'due in three days';
    case AutomationRule.DUE_TOMORROW:
      return 'due tomorrow';
    case AutomationRule.DUE_TODAY:
      return 'due today';
    case AutomationRule.DUE_IN_2_HOURS:
      return 'due in two hours';
    case AutomationRule.DUE_NOW:
      return 'due now';
    case AutomationRule.OVERDUE:
      return 'overdue';
    case AutomationRule.EXPIRED:
      return 'expired';
    default:
      return 'due';
  }
}

function dueWord(entityType: EntityType): string {
  if (entityType === EntityType.PROJECT) return 'delivery date';
  if (entityType === EntityType.PAYMENT) return 'due date';
  if (entityType === EntityType.LEAD) return 'follow-up date';
  return 'deadline';
}

function formatAmount(value: number, currency: Currency): string {
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
