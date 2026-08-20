import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Priority, TaskStatus } from '@probild/shared';
import { apiDelete, apiGet, apiGetPaginated, apiPatch, apiPost } from '@/lib/api';
import type { Task, TaskComment, TaskSummary } from './types';

export interface TaskFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: TaskStatus | '';
  priority?: Priority | '';
  projectId?: string;
  assigneeId?: string;
  overdue?: boolean;
  dueToday?: boolean;
  dueThisWeek?: boolean;
  openOnly?: boolean;
  unassigned?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

function toParams(filters: TaskFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: filters.page,
    pageSize: filters.pageSize,
  };
  if (filters.search) params.search = filters.search;
  if (filters.status) params.status = filters.status;
  if (filters.priority) params.priority = filters.priority;
  if (filters.projectId) params.projectId = filters.projectId;
  if (filters.assigneeId) params.assigneeId = filters.assigneeId;
  if (filters.overdue) params.overdue = 'true';
  if (filters.dueToday) params.dueToday = 'true';
  if (filters.dueThisWeek) params.dueThisWeek = 'true';
  if (filters.openOnly) params.openOnly = 'true';
  if (filters.unassigned) params.unassigned = 'true';
  if (filters.sortBy) params.sortBy = filters.sortBy;
  if (filters.sortOrder) params.sortOrder = filters.sortOrder;
  return params;
}

export function useTasks(filters: TaskFilters) {
  return useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => apiGetPaginated<Task>('/tasks', { params: toParams(filters) }),
    placeholderData: (previous) => previous,
  });
}

export function useTaskSummary() {
  return useQuery({
    queryKey: ['tasks', 'summary'],
    queryFn: () => apiGet<TaskSummary>('/tasks/summary'),
  });
}

export function useTaskComments(id: string | undefined) {
  return useQuery({
    queryKey: ['task', id, 'comments'],
    queryFn: () => apiGet<TaskComment[]>(`/tasks/${id}/comments`),
    enabled: Boolean(id),
  });
}

export interface TaskFormBody {
  title: string;
  description?: string;
  projectId?: string | null;
  milestoneId?: string | null;
  clientId?: string | null;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority: Priority;
  startDate?: string | null;
  dueAt?: string | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
}

function useTaskMutation<TVariables, TData>(fn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['task'] });
      void queryClient.invalidateQueries({ queryKey: ['project'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
    },
  });
}

export function useCreateTask() {
  return useTaskMutation((body: TaskFormBody) => apiPost<Task>('/tasks', body));
}

export function useUpdateTask() {
  return useTaskMutation(({ id, ...body }: Partial<TaskFormBody> & { id: string }) =>
    apiPatch<Task>(`/tasks/${id}`, body),
  );
}

export function useChangeTaskStatus() {
  return useTaskMutation(
    ({ id, ...body }: { id: string; status: TaskStatus; actualHours?: number | null }) =>
      apiPost<Task>(`/tasks/${id}/status`, body),
  );
}

export function useAssignTask() {
  return useTaskMutation(({ id, assigneeId }: { id: string; assigneeId: string | null }) =>
    apiPost<Task>(`/tasks/${id}/assign`, { assigneeId }),
  );
}

export function useAddTaskComment() {
  return useTaskMutation(({ id, body }: { id: string; body: string }) =>
    apiPost<TaskComment>(`/tasks/${id}/comments`, { body }),
  );
}

export function useDeleteTask() {
  return useTaskMutation((id: string) => apiDelete(`/tasks/${id}`));
}
