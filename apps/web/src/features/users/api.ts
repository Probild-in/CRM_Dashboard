import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthUser, UserRole, UserStatus } from '@probild/shared';
import { apiDelete, apiGetPaginated, apiPatch, apiPost } from '@/lib/api';

export interface UserListParams {
  page: number;
  pageSize: number;
  search?: string;
  role?: UserRole | '';
  status?: UserStatus | '';
}

const usersKey = (params: UserListParams) => ['users', params] as const;

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: usersKey(params),
    queryFn: () =>
      apiGetPaginated<AuthUser>('/users', {
        params: {
          page: params.page,
          pageSize: params.pageSize,
          ...(params.search ? { search: params.search } : {}),
          ...(params.role ? { role: params.role } : {}),
          ...(params.status ? { status: params.status } : {}),
        },
      }),
    placeholderData: (previous) => previous,
  });
}

export interface CreateUserBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  designation?: string;
  phone?: string;
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserBody) => apiPost<AuthUser>('/users', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<CreateUserBody> & { id: string }) =>
      apiPatch<AuthUser>(`/users/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      apiPost<void>(`/users/${id}/reset-password`, { newPassword }),
  });
}

export function useUpdateOwnProfile() {
  return useMutation({
    mutationFn: (body: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      designation?: string;
      timezone?: string;
    }) => apiPatch<AuthUser>('/users/me', body),
  });
}

export function useChangeOwnPassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      apiPost<void>('/auth/change-password', body),
  });
}
