import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeetingStatus } from '@probild/shared';
import { apiDelete, apiGet, apiGetPaginated, apiPatch, apiPost } from '@/lib/api';
import type { CalendarConnection, CalendarEntry, ConnectionState, Meeting } from './types';

export function useCalendarEntries(range: { from: string; to: string } | null) {
  return useQuery({
    queryKey: ['calendar', range],
    queryFn: () => apiGet<CalendarEntry[]>('/meetings/calendar', { params: range ?? undefined }),
    enabled: Boolean(range),
    placeholderData: (previous) => previous,
  });
}

export function useMeetings(params: {
  clientId?: string;
  leadId?: string;
  projectId?: string;
  upcoming?: boolean;
}) {
  return useQuery({
    queryKey: ['meetings', params],
    queryFn: () =>
      apiGetPaginated<Meeting>('/meetings', {
        params: {
          pageSize: 50,
          ...(params.clientId ? { clientId: params.clientId } : {}),
          ...(params.leadId ? { leadId: params.leadId } : {}),
          ...(params.projectId ? { projectId: params.projectId } : {}),
          ...(params.upcoming ? { upcoming: 'true' } : {}),
        },
      }),
  });
}

export function useMeeting(id: string | undefined) {
  return useQuery({
    queryKey: ['meeting', id],
    queryFn: () => apiGet<Meeting>(`/meetings/${id}`),
    enabled: Boolean(id),
  });
}

export interface MeetingFormBody {
  title: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  leadId?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  attendees?: Array<{ userId?: string | null; email?: string | null; name?: string | null }>;
  createMeetLink?: boolean;
}

function useMeetingMutation<TVariables, TData>(fn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['meetings'] });
      void queryClient.invalidateQueries({ queryKey: ['meeting'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['lead'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
    },
  });
}

export function useCreateMeeting() {
  return useMeetingMutation((body: MeetingFormBody) => apiPost<Meeting>('/meetings', body));
}

export function useUpdateMeeting() {
  return useMeetingMutation(({ id, ...body }: Partial<MeetingFormBody> & { id: string }) =>
    apiPatch<Meeting>(`/meetings/${id}`, body),
  );
}

export function useChangeMeetingStatus() {
  return useMeetingMutation(
    ({ id, ...body }: { id: string; status: MeetingStatus; outcome?: string }) =>
      apiPost<Meeting>(`/meetings/${id}/status`, body),
  );
}

export function useDeleteMeeting() {
  return useMeetingMutation((id: string) => apiDelete(`/meetings/${id}`));
}

/* ------------------------------------------------------------------ */
/* Google connection                                                   */
/* ------------------------------------------------------------------ */

export function useCalendarConnection() {
  return useQuery({
    queryKey: ['calendar', 'connection'],
    queryFn: () => apiGet<ConnectionState>('/calendar/connection'),
  });
}

function useConnectionInvalidation(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  };
}

/** Returns the consent URL; the caller sends the browser to Google. */
export function useConnectGoogle() {
  const invalidate = useConnectionInvalidation();
  return useMutation({
    mutationFn: (): Promise<{ authUrl: string }> =>
      apiPost<{ authUrl: string }>('/calendar/google/connect'),
    onSuccess: invalidate,
  });
}

export function useUpdateConnection() {
  const invalidate = useConnectionInvalidation();
  return useMutation({
    mutationFn: (body: { syncMeetings?: boolean; syncTasks?: boolean }) =>
      apiPatch<CalendarConnection>('/calendar/connection', body),
    onSuccess: invalidate,
  });
}

export function useDisconnectGoogle() {
  const invalidate = useConnectionInvalidation();
  return useMutation({
    mutationFn: (): Promise<void> => apiDelete('/calendar/connection'),
    onSuccess: invalidate,
  });
}

export function useSyncCalendar() {
  const invalidate = useConnectionInvalidation();
  return useMutation({
    mutationFn: (): Promise<{ pulled: number; updated: number; cancelled: number }> =>
      apiPost('/calendar/sync'),
    onSuccess: invalidate,
  });
}
