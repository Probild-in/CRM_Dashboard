import type { Tone } from './Badge';

/** Role and status vocabularies both map onto the same five tones. */
export const ROLE_TONES: Record<string, Tone> = {
  SUPER_ADMIN: 'accent',
  SALES: 'success',
  PROJECT_MANAGER: 'warning',
  EMPLOYEE: 'neutral',
};

export const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'success',
  INVITED: 'accent',
  SUSPENDED: 'danger',
};

/** Pipeline stages: cool while open, decisive once closed. */
export const LEAD_STATUS_TONES: Record<string, Tone> = {
  NEW: 'neutral',
  CONTACTED: 'neutral',
  QUALIFIED: 'accent',
  MEETING: 'accent',
  PROPOSAL: 'warning',
  NEGOTIATION: 'warning',
  WON: 'success',
  LOST: 'danger',
};

export const PRIORITY_TONES: Record<string, Tone> = {
  LOW: 'neutral',
  MEDIUM: 'neutral',
  HIGH: 'warning',
  URGENT: 'danger',
};

export const QUOTATION_STATUS_TONES: Record<string, Tone> = {
  DRAFT: 'neutral',
  SENT: 'accent',
  VIEWED: 'accent',
  NEGOTIATION: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'danger',
};

export const DEAL_STAGE_TONES: Record<string, Tone> = {
  OPEN: 'accent',
  NEGOTIATION: 'warning',
  WON: 'success',
  LOST: 'danger',
};

export const CLIENT_STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  CHURNED: 'danger',
};

export const PROJECT_STATUS_TONES: Record<string, Tone> = {
  PLANNING: 'neutral',
  ACTIVE: 'accent',
  ON_HOLD: 'warning',
  IN_REVIEW: 'warning',
  CLIENT_REVIEW: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

export const TASK_STATUS_TONES: Record<string, Tone> = {
  TODO: 'neutral',
  IN_PROGRESS: 'accent',
  REVIEW: 'warning',
  BLOCKED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const MILESTONE_STATUS_TONES: Record<string, Tone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'accent',
  COMPLETED: 'success',
  BLOCKED: 'danger',
  CANCELLED: 'neutral',
};

export const PAYMENT_STATUS_TONES: Record<string, Tone> = {
  PENDING: 'neutral',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'neutral',
};
