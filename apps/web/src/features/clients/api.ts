import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientStatus, Currency } from '@probild/shared';
import { apiDelete, apiGet, apiGetPaginated, apiPatch, apiPost } from '@/lib/api';
import type { Client, ClientOverview, Contact, Deal } from './types';

export interface ClientFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: ClientStatus | '';
  accountManagerId?: string;
}

export function useClients(filters: ClientFilters) {
  return useQuery({
    queryKey: ['clients', filters],
    queryFn: () =>
      apiGetPaginated<Client>('/clients', {
        params: {
          page: filters.page,
          pageSize: filters.pageSize,
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.accountManagerId ? { accountManagerId: filters.accountManagerId } : {}),
        },
      }),
    placeholderData: (previous) => previous,
  });
}

export function useClientOverview(id: string | undefined) {
  return useQuery({
    queryKey: ['client', id, 'overview'],
    queryFn: () => apiGet<ClientOverview>(`/clients/${id}/overview`),
    enabled: Boolean(id),
  });
}

export interface ClientFormBody {
  companyName: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  linkedin?: string;
  industry?: string;
  country?: string;
  city?: string;
  addressLine?: string;
  postalCode?: string;
  taxId?: string;
  status: ClientStatus;
  defaultCurrency: Currency;
  accountManagerId?: string | null;
  notes?: string;
}

function useClientMutation<TVariables, TData>(fn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
    },
  });
}

export function useCreateClient() {
  return useClientMutation((body: ClientFormBody) => apiPost<Client>('/clients', body));
}

export function useUpdateClient() {
  return useClientMutation(({ id, ...body }: Partial<ClientFormBody> & { id: string }) =>
    apiPatch<Client>(`/clients/${id}`, body),
  );
}

export function useDeleteClient() {
  return useClientMutation((id: string) => apiDelete(`/clients/${id}`));
}

export interface ContactFormBody {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  designation?: string;
  isPrimary: boolean;
}

export function useCreateContact(clientId: string) {
  return useClientMutation((body: ContactFormBody) =>
    apiPost<Contact>(`/clients/${clientId}/contacts`, body),
  );
}

export function useUpdateContact(clientId: string) {
  return useClientMutation(({ id, ...body }: Partial<ContactFormBody> & { id: string }) =>
    apiPatch<Contact>(`/clients/${clientId}/contacts/${id}`, body),
  );
}

export function useDeleteContact(clientId: string) {
  return useClientMutation((id: string) => apiDelete(`/clients/${clientId}/contacts/${id}`));
}

export interface ConvertLeadBody {
  companyName?: string;
  accountManagerId?: string | null;
  createDeal: boolean;
  dealTitle?: string;
  dealValue?: number | null;
}

/** Converting touches leads, clients and deals, so all three caches drop. */
export function useConvertLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...body }: ConvertLeadBody & { leadId: string }) =>
      apiPost<{ client: Client; dealId: string | null }>(`/leads/${leadId}/convert`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['lead'] });
      void queryClient.invalidateQueries({ queryKey: ['pipeline'] });
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useDeals(params: { clientId?: string; leadId?: string }) {
  return useQuery({
    queryKey: ['deals', params],
    queryFn: () => apiGetPaginated<Deal>('/deals', { params: { ...params, pageSize: 50 } }),
    enabled: Boolean(params.clientId || params.leadId),
  });
}
