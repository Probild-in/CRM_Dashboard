import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Currency, QuotationStatus } from '@probild/shared';
import { apiDelete, apiGet, apiGetPaginated, apiPatch, apiPost } from '@/lib/api';
import type { PricingHistoryEntry, Quotation } from './types';

export interface QuotationFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: QuotationStatus | '';
  clientId?: string;
  expiringSoon?: boolean;
}

export function useQuotations(filters: QuotationFilters) {
  return useQuery({
    queryKey: ['quotations', filters],
    queryFn: () =>
      apiGetPaginated<Quotation>('/quotations', {
        params: {
          page: filters.page,
          pageSize: filters.pageSize,
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.clientId ? { clientId: filters.clientId } : {}),
          ...(filters.expiringSoon ? { expiringSoon: 'true' } : {}),
        },
      }),
    placeholderData: (previous) => previous,
  });
}

export function useQuotation(id: string | undefined) {
  return useQuery({
    queryKey: ['quotation', id],
    queryFn: () => apiGet<Quotation>(`/quotations/${id}`),
    enabled: Boolean(id),
  });
}

export function usePricingHistory(id: string | undefined) {
  return useQuery({
    queryKey: ['quotation', id, 'pricing-history'],
    queryFn: () => apiGet<PricingHistoryEntry[]>(`/quotations/${id}/pricing-history`),
    enabled: Boolean(id),
  });
}

export interface QuotationItemBody {
  serviceId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

export interface QuotationFormBody {
  title: string;
  clientId?: string | null;
  leadId?: string | null;
  dealId?: string | null;
  currency: Currency;
  issueDate: string;
  validUntil?: string | null;
  discountAmount: number;
  taxPercent: number;
  paymentTerms?: string;
  notes?: string;
  items: QuotationItemBody[];
  /** Recorded in the pricing trail when the total moves. */
  changeReason?: string;
}

function useQuotationMutation<TVariables, TData>(fn: (variables: TVariables) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['quotations'] });
      void queryClient.invalidateQueries({ queryKey: ['quotation'] });
      void queryClient.invalidateQueries({ queryKey: ['client'] });
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useCreateQuotation() {
  return useQuotationMutation((body: QuotationFormBody) =>
    apiPost<Quotation>('/quotations', body),
  );
}

export function useUpdateQuotation() {
  return useQuotationMutation(({ id, ...body }: Partial<QuotationFormBody> & { id: string }) =>
    apiPatch<Quotation>(`/quotations/${id}`, body),
  );
}

export function useChangeQuotationStatus() {
  return useQuotationMutation(
    ({ id, ...body }: { id: string; status: QuotationStatus; note?: string }) =>
      apiPost<Quotation>(`/quotations/${id}/status`, body),
  );
}

export function useDeleteQuotation() {
  return useQuotationMutation((id: string) => apiDelete(`/quotations/${id}`));
}

/**
 * Mirrors the server's calculation so the builder can preview a total while
 * you type. The server recomputes on save and its answer is the one stored.
 */
export function previewTotals(
  items: QuotationItemBody[],
  discountAmount: number,
  taxPercent: number,
): { subtotal: number; discountAmount: number; taxAmount: number; total: number } {
  const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

  const subtotal = round2(
    items.reduce(
      (sum, item) =>
        sum + round2(item.quantity * item.unitPrice * (1 - item.discountPercent / 100)),
      0,
    ),
  );
  const applied = round2(Math.min(Math.max(discountAmount, 0), subtotal));
  const base = round2(subtotal - applied);
  const taxAmount = round2((base * taxPercent) / 100);

  return { subtotal, discountAmount: applied, taxAmount, total: round2(base + taxAmount) };
}
