import type {
  Currency,
  LeadActivityType,
  LeadSource,
  LeadStatus,
  Priority,
} from '@probild/shared';

export interface LeadPerson {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface Lead {
  id: string;
  reference: string;
  companyName: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  country: string | null;
  city: string | null;
  industry: string | null;
  website: string | null;
  linkedin: string | null;
  source: LeadSource;
  status: LeadStatus;
  priority: Priority;
  expectedValue: number | null;
  currency: Currency;
  expectedCloseDate: string | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  lostReason: string | null;
  notes: string | null;
  convertedClientId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  interestedService: { id: string; name: string } | null;
  assignedTo: LeadPerson | null;
  createdBy: LeadPerson | null;
  /** Derived by the API: an open lead whose follow-up date has passed. */
  isFollowUpOverdue: boolean;
}

export interface LeadActivity {
  id: string;
  leadId: string;
  type: LeadActivityType;
  title: string;
  body: string | null;
  fromValue: string | null;
  toValue: string | null;
  occurredAt: string;
  createdAt: string;
  user: LeadPerson | null;
}

export interface LeadSummary {
  total: number;
  open: number;
  followUpOverdue: number;
  unassigned: number;
  byPriority: Record<Priority, number>;
}

export interface PipelineStage {
  status: LeadStatus;
  count: number;
  value: Record<Currency, number>;
  leads: Lead[];
}

export interface PipelineBoard {
  stages: PipelineStage[];
  closed: { won: PipelineStage; lost: PipelineStage };
}

export interface ServiceOption {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
}
