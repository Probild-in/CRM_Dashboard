import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityType, NotificationType, Priority } from '@probild/shared';
import { apiGet, apiGetPaginated, apiPost } from '@/lib/api';

export interface Notification {
  id: string;
  type: NotificationType;
  priority: Priority;
  title: string;
  message: string;
  entityType: EntityType | null;
  entityId: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export function useNotifications(params: { page: number; pageSize: number; unreadOnly?: boolean }) {
  return useQuery({
    queryKey: ['notifications', params],
    queryFn: () =>
      apiGetPaginated<Notification>('/notifications', {
        params: {
          page: params.page,
          pageSize: params.pageSize,
          ...(params.unreadOnly ? { unreadOnly: 'true' } : {}),
        },
      }),
    placeholderData: (previous) => previous,
  });
}

/**
 * The badge count.
 *
 * Polled rather than pushed: the worker writes notifications out of band, so
 * there is nothing for the browser to listen to. A minute is soon enough for a
 * reminder and cheap enough to leave running all day.
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiGet<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

function useNotificationMutation<TVariables, TData>(fn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkRead() {
  return useNotificationMutation((id: string) => apiPost(`/notifications/${id}/read`));
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<{ marked: number }> => apiPost('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
