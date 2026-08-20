/**
 * Domain enums shared by the API and the web client.
 *
 * These values are mirrored 1:1 by the Prisma enums in apps/api/prisma/schema.prisma.
 * Keeping them here means the frontend never hardcodes a status string.
 */

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SALES: 'SALES',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const Currency = {
  INR: 'INR',
  USD: 'USD',
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

/** Sales pipeline: NEW -> CONTACTED -> QUALIFIED -> MEETING -> PROPOSAL -> NEGOTIATION -> WON/LOST */
export const LeadStatus = {
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  QUALIFIED: 'QUALIFIED',
  MEETING: 'MEETING',
  PROPOSAL: 'PROPOSAL',
  NEGOTIATION: 'NEGOTIATION',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

/** Ordered pipeline stages used for board columns and progression checks. */
export const LEAD_PIPELINE_ORDER: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.MEETING,
  LeadStatus.PROPOSAL,
  LeadStatus.NEGOTIATION,
  LeadStatus.WON,
  LeadStatus.LOST,
];

export const TERMINAL_LEAD_STATUSES: LeadStatus[] = [LeadStatus.WON, LeadStatus.LOST];

/**
 * Kinds of entry on a lead's timeline.
 *
 * The first group is logged by a person; the second is written by the system
 * when a field that matters changes. Both share one timeline so the history
 * reads in order.
 */
export const LeadActivityType = {
  CALL: 'CALL',
  EMAIL: 'EMAIL',
  MEETING: 'MEETING',
  WHATSAPP: 'WHATSAPP',
  NOTE: 'NOTE',

  CREATED: 'CREATED',
  STATUS_CHANGE: 'STATUS_CHANGE',
  VALUE_CHANGE: 'VALUE_CHANGE',
  FOLLOW_UP_SET: 'FOLLOW_UP_SET',
  ASSIGNED: 'ASSIGNED',
  CONVERTED: 'CONVERTED',
} as const;
export type LeadActivityType = (typeof LeadActivityType)[keyof typeof LeadActivityType];

/** The types a person may log by hand. The rest are written by the system. */
export const LOGGABLE_ACTIVITY_TYPES: LeadActivityType[] = [
  LeadActivityType.CALL,
  LeadActivityType.EMAIL,
  LeadActivityType.MEETING,
  LeadActivityType.WHATSAPP,
  LeadActivityType.NOTE,
];

/** Logging one of these means contact was made, so `lastContactedAt` moves. */
export const CONTACT_ACTIVITY_TYPES: LeadActivityType[] = [
  LeadActivityType.CALL,
  LeadActivityType.EMAIL,
  LeadActivityType.MEETING,
  LeadActivityType.WHATSAPP,
];

/** Stages shown as columns on the pipeline board, in order. Won and lost sit outside it. */
export const PIPELINE_BOARD_STAGES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.MEETING,
  LeadStatus.PROPOSAL,
  LeadStatus.NEGOTIATION,
];

export const Priority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const LeadSource = {
  WEBSITE: 'WEBSITE',
  REFERRAL: 'REFERRAL',
  COLD_EMAIL: 'COLD_EMAIL',
  COLD_CALL: 'COLD_CALL',
  LINKEDIN: 'LINKEDIN',
  UPWORK: 'UPWORK',
  SOCIAL_MEDIA: 'SOCIAL_MEDIA',
  EVENT: 'EVENT',
  PARTNER: 'PARTNER',
  ADVERTISEMENT: 'ADVERTISEMENT',
  OTHER: 'OTHER',
} as const;
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const ClientStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  CHURNED: 'CHURNED',
} as const;
export type ClientStatus = (typeof ClientStatus)[keyof typeof ClientStatus];

export const DealStage = {
  OPEN: 'OPEN',
  NEGOTIATION: 'NEGOTIATION',
  WON: 'WON',
  LOST: 'LOST',
} as const;
export type DealStage = (typeof DealStage)[keyof typeof DealStage];

export const QuotationStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  VIEWED: 'VIEWED',
  NEGOTIATION: 'NEGOTIATION',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
} as const;
export type QuotationStatus = (typeof QuotationStatus)[keyof typeof QuotationStatus];

export const ProjectStatus = {
  PLANNING: 'PLANNING',
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  IN_REVIEW: 'IN_REVIEW',
  CLIENT_REVIEW: 'CLIENT_REVIEW',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const MilestoneStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
} as const;
export type MilestoneStatus = (typeof MilestoneStatus)[keyof typeof MilestoneStatus];

export const TaskStatus = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  REVIEW: 'REVIEW',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** Statuses that stop a task from ever being counted as overdue. */
export const CLOSED_TASK_STATUSES: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.CANCELLED];

export const MeetingStatus = {
  SCHEDULED: 'SCHEDULED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type MeetingStatus = (typeof MeetingStatus)[keyof typeof MeetingStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = {
  BANK_TRANSFER: 'BANK_TRANSFER',
  UPI: 'UPI',
  CARD: 'CARD',
  CASH: 'CASH',
  CHEQUE: 'CHEQUE',
  PAYPAL: 'PAYPAL',
  STRIPE: 'STRIPE',
  RAZORPAY: 'RAZORPAY',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const NotificationType = {
  TASK: 'TASK',
  MEETING: 'MEETING',
  FOLLOW_UP: 'FOLLOW_UP',
  PROJECT: 'PROJECT',
  MILESTONE: 'MILESTONE',
  PAYMENT: 'PAYMENT',
  QUOTATION: 'QUOTATION',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Entities that can be referenced by notifications, audit logs and documents. */
export const EntityType = {
  USER: 'USER',
  LEAD: 'LEAD',
  CLIENT: 'CLIENT',
  CONTACT: 'CONTACT',
  DEAL: 'DEAL',
  QUOTATION: 'QUOTATION',
  PROJECT: 'PROJECT',
  MILESTONE: 'MILESTONE',
  TASK: 'TASK',
  MEETING: 'MEETING',
  PAYMENT: 'PAYMENT',
  DOCUMENT: 'DOCUMENT',
  SERVICE: 'SERVICE',
  SETTING: 'SETTING',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export const AuditAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  DELETED: 'DELETED',
  RESTORED: 'RESTORED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  VALUE_CHANGED: 'VALUE_CHANGED',
  ASSIGNED: 'ASSIGNED',
  CONVERTED: 'CONVERTED',
  COMPLETED: 'COMPLETED',
  LOGGED_IN: 'LOGGED_IN',
  LOGGED_OUT: 'LOGGED_OUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Reminder offsets emitted by the automation engine (Phase 7). */
export const AutomationRule = {
  DUE_IN_3_DAYS: 'DUE_IN_3_DAYS',
  DUE_TOMORROW: 'DUE_TOMORROW',
  DUE_TODAY: 'DUE_TODAY',
  DUE_IN_2_HOURS: 'DUE_IN_2_HOURS',
  DUE_NOW: 'DUE_NOW',
  OVERDUE: 'OVERDUE',
  EXPIRED: 'EXPIRED',
} as const;
export type AutomationRule = (typeof AutomationRule)[keyof typeof AutomationRule];

/** What a document is, so a client profile can group its papers. */
export const DocumentKind = {
  AGREEMENT: 'AGREEMENT',
  QUOTATION: 'QUOTATION',
  INVOICE: 'INVOICE',
  PROPOSAL: 'PROPOSAL',
  REPORT: 'REPORT',
  OTHER: 'OTHER',
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

/** Whether a document reached the person it was sent to. */
export const DocumentSendStatus = {
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;
export type DocumentSendStatus = (typeof DocumentSendStatus)[keyof typeof DocumentSendStatus];
