import type {
  ClientStatus,
  Currency,
  DealStage,
  MeetingStatus,
  PaymentStatus,
  ProjectStatus,
  QuotationStatus,
  TaskStatus,
} from '@probild/shared';

export interface Client {
  id: string;
  reference: string;
  companyName: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  linkedin: string | null;
  industry: string | null;
  country: string | null;
  city: string | null;
  addressLine: string | null;
  postalCode: string | null;
  taxId: string | null;
  status: ClientStatus;
  defaultCurrency: Currency;
  onboardedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  accountManager: { id: string; firstName: string; lastName: string; email: string } | null;
}

export interface Contact {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  designation: string | null;
  isPrimary: boolean;
  notes: string | null;
}

export interface Deal {
  id: string;
  reference: string;
  title: string;
  stage: DealStage;
  value: number;
  currency: Currency;
  probability: number;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  createdAt: string;
  owner: { id: string; firstName: string; lastName: string } | null;
}

/** Money totals are keyed by currency — INR and USD are never added together. */
export type MoneyByCurrency = Partial<Record<Currency, number>>;

export interface ClientOverview {
  client: Client;
  contacts: Contact[];
  deals: Deal[];
  quotations: Array<{
    id: string;
    reference: string;
    title: string;
    status: QuotationStatus;
    total: number;
    currency: Currency;
    issueDate: string;
    validUntil: string | null;
  }>;
  projects: Array<{
    id: string;
    reference: string;
    name: string;
    status: ProjectStatus;
    value: number;
    currency: Currency;
    deliveryDate: string | null;
    progress: number;
  }>;
  tasks: Array<{
    id: string;
    reference: string;
    title: string;
    status: TaskStatus;
    dueAt: string | null;
    assignee: { id: string; firstName: string; lastName: string } | null;
  }>;
  meetings: Array<{
    id: string;
    title: string;
    status: MeetingStatus;
    startsAt: string;
    endsAt: string;
  }>;
  payments: Array<{
    id: string;
    reference: string;
    title: string;
    status: PaymentStatus;
    amount: number;
    paidAmount: number;
    currency: Currency;
    dueDate: string | null;
  }>;
  documents: Array<{ id: string; name: string; mimeType: string; createdAt: string }>;
  originLeads: Array<{
    id: string;
    reference: string;
    companyName: string;
    convertedAt: string | null;
    source: string;
  }>;
  activity: Array<{
    id: string;
    action: string;
    summary: string | null;
    createdAt: string;
    user: { id: string; firstName: string; lastName: string } | null;
  }>;
  stats: {
    dealCount: number;
    openDealCount: number;
    wonValue: MoneyByCurrency;
    openValue: MoneyByCurrency;
    quotationCount: number;
    acceptedQuotationValue: MoneyByCurrency;
    projectCount: number;
    activeProjectCount: number;
    billed: MoneyByCurrency;
    received: MoneyByCurrency;
    outstanding: MoneyByCurrency;
  };
}
