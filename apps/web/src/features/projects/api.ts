import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Currency, MilestoneStatus, Priority, ProjectStatus } from '@probild/shared';
import { apiDelete, apiGet, apiGetPaginated, apiPatch, apiPost } from '@/lib/api';
import type { Milestone, Project, ProjectSummary } from './types';

export interface ProjectFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: ProjectStatus | '';
  priority?: Priority | '';
  clientId?: string;
  managerId?: string;
  overdue?: boolean;
  dueSoon?: boolean;
  activeOnly?: boolean;
}

function toParams(filters: ProjectFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: filters.page,
    pageSize: filters.pageSize,
  };
  if (filters.search) params.search = filters.search;
  if (filters.status) params.status = filters.status;
  if (filters.priority) params.priority = filters.priority;
  if (filters.clientId) params.clientId = filters.clientId;
  if (filters.managerId) params.managerId = filters.managerId;
  if (filters.overdue) params.overdue = 'true';
  if (filters.dueSoon) params.dueSoon = 'true';
  if (filters.activeOnly) params.activeOnly = 'true';
  return params;
}

export function useProjects(filters: ProjectFilters) {
  return useQuery({
    queryKey: ['projects', filters],
    queryFn: () => apiGetPaginated<Project>('/projects', { params: toParams(filters) }),
    placeholderData: (previous) => previous,
  });
}

export function useProjectSummary() {
  return useQuery({
    queryKey: ['projects', 'summary'],
    queryFn: () => apiGet<ProjectSummary>('/projects/summary'),
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => apiGet<Project>(`/projects/${id}`),
    enabled: Boolean(id),
  });
}

export function useMilestones(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId, 'milestones'],
    queryFn: () => apiGet<Milestone[]>(`/projects/${projectId}/milestones`),
    enabled: Boolean(projectId),
  });
}

export interface ProjectFormBody {
  clientId: string;
  dealId?: string | null;
  managerId?: string | null;
  name: string;
  description?: string;
  status?: ProjectStatus;
  priority: Priority;
  value: number;
  currency: Currency;
  startDate?: string | null;
  deliveryDate?: string | null;
  serviceIds?: string[];
  memberIds?: string[];
  valueChangeReason?: string;
}

/** Milestones move project progress, so both caches drop on every write. */
function useProjectMutation<TVariables, TData>(fn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['project'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
    },
  });
}

export function useCreateProject() {
  return useProjectMutation((body: ProjectFormBody) => apiPost<Project>('/projects', body));
}

export function useUpdateProject() {
  return useProjectMutation(({ id, ...body }: Partial<ProjectFormBody> & { id: string }) =>
    apiPatch<Project>(`/projects/${id}`, body),
  );
}

export function useChangeProjectStatus() {
  return useProjectMutation(({ id, ...body }: { id: string; status: ProjectStatus; note?: string }) =>
    apiPost<Project>(`/projects/${id}/status`, body),
  );
}

export function useDeleteProject() {
  return useProjectMutation((id: string) => apiDelete(`/projects/${id}`));
}

export function useAddMember(projectId: string) {
  return useProjectMutation((body: { userId: string; roleLabel?: string }) =>
    apiPost<Project>(`/projects/${projectId}/members`, body),
  );
}

export function useRemoveMember(projectId: string) {
  return useProjectMutation((userId: string) =>
    apiDelete(`/projects/${projectId}/members/${userId}`),
  );
}

export interface MilestoneFormBody {
  name: string;
  description?: string;
  assigneeId?: string | null;
  status?: MilestoneStatus;
  startDate?: string | null;
  dueDate?: string | null;
  completionPercent?: number;
}

export function useCreateMilestone(projectId: string) {
  return useProjectMutation((body: MilestoneFormBody) =>
    apiPost<Milestone>(`/projects/${projectId}/milestones`, body),
  );
}

export function useUpdateMilestone(projectId: string) {
  return useProjectMutation(({ id, ...body }: Partial<MilestoneFormBody> & { id: string }) =>
    apiPatch<Milestone>(`/projects/${projectId}/milestones/${id}`, body),
  );
}

export function useDeleteMilestone(projectId: string) {
  return useProjectMutation((id: string) =>
    apiDelete(`/projects/${projectId}/milestones/${id}`),
  );
}
