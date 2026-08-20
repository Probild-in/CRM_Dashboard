import type { Currency, MilestoneStatus, Priority, ProjectStatus } from '@probild/shared';

export interface ProjectMember {
  id: string;
  roleLabel: string | null;
  joinedAt: string;
  user: { id: string; firstName: string; lastName: string; email: string; role: string };
}

export interface Project {
  id: string;
  reference: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: Priority;
  value: number;
  currency: Currency;
  startDate: string | null;
  deliveryDate: string | null;
  completedAt: string | null;
  progress: number;
  createdAt: string;
  updatedAt: string;
  client: { id: string; reference: string; companyName: string };
  deal: { id: string; reference: string; title: string } | null;
  manager: { id: string; firstName: string; lastName: string; email: string } | null;
  members: ProjectMember[];
  services: Array<{ id: string; name: string }>;
  _count: { milestones: number; tasks: number };
  /** Derived by the API: past its delivery date and still open. */
  isOverdue: boolean;
  daysToDelivery: number | null;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: MilestoneStatus;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completionPercent: number;
  position: number;
  assignee: { id: string; firstName: string; lastName: string } | null;
  _count: { tasks: number };
  isOverdue: boolean;
}

export interface ProjectSummary {
  total: number;
  active: number;
  overdue: number;
  dueSoon: number;
  completed: number;
}
