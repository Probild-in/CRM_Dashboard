import type {
  Currency,
  LeadSource,
  LeadStatus,
  MeetingStatus,
  PaymentStatus,
  Priority,
  ProjectStatus,
  TaskStatus,
} from '@probild/shared';

export type MoneyByCurrency = Record<Currency, number>;

export interface FollowUpCard {
  id: string;
  reference: string;
  companyName: string;
  contactPerson: string | null;
  nextFollowUpAt: string;
  priority: Priority;
}

export interface TaskCard {
  id: string;
  reference: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  assignee: { id: string; firstName: string; lastName: string } | null;
  project: { id: string; name: string } | null;
}

export interface ProjectCard {
  id: string;
  reference: string;
  name: string;
  status: ProjectStatus;
  progress: number;
  deliveryDate: string | null;
  value: number;
  currency: Currency;
  client: { id: string; companyName: string };
}

export interface PaymentCard {
  id: string;
  reference: string;
  title: string;
  status: PaymentStatus;
  amount: number;
  paidAmount: number;
  outstanding: number;
  currency: Currency;
  dueDate: string | null;
  client: { id: string; companyName: string };
}

export interface MeetingCard {
  id: string;
  title: string;
  status: MeetingStatus;
  startsAt: string;
  endsAt: string;
  location: string | null;
  meetingUrl: string | null;
  client: { id: string; companyName: string } | null;
  lead: { id: string; companyName: string } | null;
}

export interface DashboardOverview {
  generatedAt: string;
  timezone: string;
  kpis: {
    totalLeads: number;
    activeLeads: number;
    wonLeads: number;
    lostLeads: number;
    pipelineValue: MoneyByCurrency;
    wonDealValue: MoneyByCurrency;
    monthlyRevenue: MoneyByCurrency;
    pendingPayments: MoneyByCurrency;
    activeProjects: number;
    projectsDueSoon: number;
    overdueTasks: number;
  };
  today: { followUps: FollowUpCard[]; tasks: TaskCard[]; meetings: MeetingCard[] };
  overdue: {
    followUps: FollowUpCard[];
    tasks: TaskCard[];
    projects: ProjectCard[];
    payments: PaymentCard[];
  };
  upcoming: {
    tasks: TaskCard[];
    projects: ProjectCard[];
    meetings: MeetingCard[];
    payments: PaymentCard[];
  };
}

export interface SalesDashboard {
  pipeline: Array<{ status: LeadStatus; count: number; value: MoneyByCurrency }>;
  conversion: { won: number; lost: number; decided: number; rate: number | null };
  sources: Array<{
    source: LeadSource;
    total: number;
    won: number;
    lost: number;
    rate: number | null;
  }>;
  revenueByMonth: Array<{
    key: string;
    label: string;
    won: MoneyByCurrency;
    received: MoneyByCurrency;
  }>;
}

export interface DeliveryDashboard {
  projectsByStatus: Array<{ status: ProjectStatus; count: number }>;
  tasksByStatus: Array<{ status: TaskStatus; count: number }>;
  averageCompletion: number;
  delayed: Array<{
    id: string;
    reference: string;
    name: string;
    status: ProjectStatus;
    progress: number;
    deliveryDate: string | null;
    client: { id: string; companyName: string };
  }>;
  workload: Array<{ userId: string | null; name: string; openTasks: number }>;
}
