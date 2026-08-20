import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { DashboardOverview, DeliveryDashboard, SalesDashboard } from './types';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiGet<DashboardOverview>('/dashboard'),
    // The agenda goes stale quickly; a minute is short enough to trust.
    staleTime: 60_000,
  });
}

export function useSalesDashboard(months = 6) {
  return useQuery({
    queryKey: ['dashboard', 'sales', months],
    queryFn: () => apiGet<SalesDashboard>('/dashboard/sales', { params: { months } }),
    staleTime: 60_000,
  });
}

export function useDeliveryDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'delivery'],
    queryFn: () => apiGet<DeliveryDashboard>('/dashboard/delivery'),
    staleTime: 60_000,
  });
}
