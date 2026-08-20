import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Currency, PaymentMethod, PaymentStatus } from '@probild/shared';
import { apiDelete, apiGet, apiGetPaginated, apiPatch, apiPost } from '@/lib/api';
import type { Payment, PaymentSummary } from './types';

export interface PaymentFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: PaymentStatus | '';
  clientId?: string;
  overdue?: boolean;
  outstandingOnly?: boolean;
}

export function usePayments(filters: PaymentFilters) {
  return useQuery({
    queryKey: ['payments', filters],
    queryFn: () =>
      apiGetPaginated<Payment>('/payments', {
        params: {
          page: filters.page,
          pageSize: filters.pageSize,
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
          ...(filters.overdue ? { overdue: 'true' } : {}),
          ...(filters.outstandingOnly ? { outstandingOnly: 'true' } : {}),
        },
      }),
    placeholderData: (previous) => previous,
  });
}

export function usePaymentSummary() {
  return useQuery({
    queryKey: ['payments', 'summary'],
    queryFn: () => apiGet<PaymentSummary>('/payments/summary'),
  });
}

export interface PaymentFormBody {
  clientId: string;
  projectId?: string | null;
  title: string;
  amount: number;
  currency: Currency;
  dueDate?: string | null;
  method?: PaymentMethod | null;
  transactionRef?: string;
  notes?: string;
  amountChangeReason?: string;
}

/** A receipt moves money, so the dashboard and the client profile drop too. */
function usePaymentMutation<TVariables, TData>(fn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useCreatePayment() {
  return usePaymentMutation((body: PaymentFormBody) => apiPost<Payment>('/payments', body));
}

export function useUpdatePayment() {
  return usePaymentMutation(({ id, ...body }: Partial<PaymentFormBody> & { id: string }) =>
    apiPatch<Payment>(`/payments/${id}`, body),
  );
}

export interface ReceiptBody {
  amount: number;
  paidAt?: string;
  method?: PaymentMethod | null;
  transactionRef?: string;
  note?: string;
}

export function useRecordReceipt() {
  return usePaymentMutation(({ id, ...body }: ReceiptBody & { id: string }) =>
    apiPost<Payment>(`/payments/${id}/receipts`, body),
  );
}

export function useCancelPayment() {
  return usePaymentMutation(({ id, reason }: { id: string; reason: string }) =>
    apiPost<Payment>(`/payments/${id}/cancel`, { reason }),
  );
}

export function useDeletePayment() {
  return usePaymentMutation((id: string) => apiDelete(`/payments/${id}`));
}
