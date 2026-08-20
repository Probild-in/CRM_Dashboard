import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Currency, LeadSource, LeadStatus, Priority } from '@probild/shared';
import { apiDelete, apiGet, apiGetPaginated, apiPatch, apiPost } from '@/lib/api';
import type { Lead, LeadActivity, LeadSummary, PipelineBoard, ServiceOption } from './types';

export interface LeadFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: LeadStatus | '';
  priority?: Priority | '';
  source?: LeadSource | '';
  assignedToId?: string;
  followUpOverdue?: boolean;
  openOnly?: boolean;
  unassigned?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Drops empty filters so they never reach the query string. */
function toParams(filters: LeadFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: filters.page,
    pageSize: filters.pageSize,
  };
  if (filters.search) params.search = filters.search;
  if (filters.status) params.status = filters.status;
  if (filters.priority) params.priority = filters.priority;
  if (filters.source) params.source = filters.source;
  if (filters.assignedToId) params.assignedToId = filters.assignedToId;
  if (filters.followUpOverdue) params.followUpOverdue = 'true';
  if (filters.openOnly) params.openOnly = 'true';
  if (filters.unassigned) params.unassigned = 'true';
  if (filters.sortBy) params.sortBy = filters.sortBy;
  if (filters.sortOrder) params.sortOrder = filters.sortOrder;
  return params;
}

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: ['leads', filters],
    queryFn: () => apiGetPaginated<Lead>('/leads', { params: toParams(filters) }),
    placeholderData: (previous) => previous,
  });
}

export function useLeadSummary() {
  return useQuery({
    queryKey: ['leads', 'summary'],
    queryFn: () => apiGet<LeadSummary>('/leads/summary'),
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: () => apiGet<Lead>(`/leads/${id}`),
    enabled: Boolean(id),
  });
}

export function useLeadActivities(id: string | undefined) {
  return useQuery({
    queryKey: ['lead', id, 'activities'],
    queryFn: () => apiGet<LeadActivity[]>(`/leads/${id}/activities`),
    enabled: Boolean(id),
  });
}

export function usePipeline(assignedToId?: string) {
  return useQuery({
    queryKey: ['pipeline', assignedToId ?? 'all'],
    queryFn: () =>
      apiGet<PipelineBoard>('/leads/pipeline', {
        params: assignedToId ? { assignedToId } : undefined,
      }),
  });
}

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => apiGet<ServiceOption[]>('/services'),
    staleTime: 10 * 60_000,
  });
}

export interface LeadFormBody {
  companyName: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  country?: string;
  city?: string;
  industry?: string;
  website?: string;
  linkedin?: string;
  source: LeadSource;
  priority: Priority;
  interestedServiceId?: string | null;
  expectedValue?: number | null;
  currency: Currency;
  expectedCloseDate?: string | null;
  nextFollowUpAt?: string | null;
  assignedToId?: string | null;
  notes?: string;
}

/** Every mutation refreshes the list, the board and the header counts together. */
function useLeadMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['lead'] });
      void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
    },
  });
}

export function useCreateLead() {
  return useLeadMutation((body: LeadFormBody) => apiPost<Lead>('/leads', body));
}

export function useUpdateLead() {
  return useLeadMutation(({ id, ...body }: Partial<LeadFormBody> & { id: string }) =>
    apiPatch<Lead>(`/leads/${id}`, body),
  );
}

export function useChangeLeadStatus() {
  return useLeadMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      status: LeadStatus;
      lostReason?: string;
      note?: string;
    }) => apiPost<Lead>(`/leads/${id}/status`, body),
  );
}

export function useAssignLead() {
  return useLeadMutation(({ id, assignedToId }: { id: string; assignedToId: string | null }) =>
    apiPost<Lead>(`/leads/${id}/assign`, { assignedToId }),
  );
}

export function useLogActivity() {
  return useLeadMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      type: string;
      title: string;
      body?: string;
      occurredAt?: string;
      nextFollowUpAt?: string | null;
    }) => apiPost<Lead>(`/leads/${id}/activities`, body),
  );
}

export function useDeleteLead() {
  return useLeadMutation((id: string) => apiDelete(`/leads/${id}`));
}
