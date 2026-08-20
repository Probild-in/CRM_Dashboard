import type { Priority, TaskStatus } from '@probild/shared';

export interface Task {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  startDate: string | null;
  /** One UTC instant; the UI splits it into a date and a time. */
  dueAt: string | null;
  completedAt: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; reference: string; name: string; status: string } | null;
  milestone: { id: string; name: string } | null;
  client: { id: string; reference: string; companyName: string } | null;
  assignee: { id: string; firstName: string; lastName: string; email: string } | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  _count: { comments: number };
  /**
   * Derived by the API on every read. A late task keeps its real status —
   * lateness is reported alongside it, never written into it.
   */
  isOverdue: boolean;
  isDueToday: boolean;
  hoursUntilDue: number | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string } | null;
}

export interface TaskSummary {
  total: number;
  open: number;
  overdue: number;
  dueToday: number;
  unassigned: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<Priority, number>;
}
