import { useQuery } from '@tanstack/react-query';
import type { Currency, LeadSource, ProjectStatus } from '@probild/shared';
import { apiGet } from '@/lib/api';

export type MoneyByCurrency = Record<Currency, number>;

export interface RevenueReport {
  window: { from: string; to: string; months: number };
  byMonth: Array<{ key: string; label: string; received: MoneyByCurrency; won: MoneyByCurrency }>;
  byClient: Array<{ id: string; name: string; value: MoneyByCurrency }>;
  byService: Array<{ id: string; name: string; value: MoneyByCurrency }>;
  totals: { received: MoneyByCurrency; won: MoneyByCurrency };
}

export interface SalesReport {
  window: { from: string; months: number };
  totals: {
    leads: number;
    open: number;
    won: number;
    lost: number;
    rate: number | null;
    wonValue: MoneyByCurrency;
  };
  byMonth: Array<{ key: string; label: string; created: number; won: number; wonValue: MoneyByCurrency }>;
  byOwner: Array<{
    id: string;
    name: string;
    leads: number;
    won: number;
    lost: number;
    rate: number | null;
    value: MoneyByCurrency;
  }>;
  bySource: Array<{
    source: LeadSource;
    total: number;
    won: number;
    lost: number;
    rate: number | null;
    value: MoneyByCurrency;
  }>;
}

export interface ProjectReport {
  totals: {
    all: number;
    open: number;
    completed: number;
    slipping: number;
    onTime: number;
    late: number;
    onTimeRate: number | null;
    averageDaysLate: number;
    averageProgress: number;
    value: MoneyByCurrency;
  };
  byStatus: Array<{ status: ProjectStatus; count: number; value: MoneyByCurrency }>;
  delivery: Array<{
    id: string;
    reference: string;
    name: string;
    client: string;
    manager: string | null;
    deliveryDate: string | null;
    completedAt: string | null;
    daysLate: number;
    onTime: boolean;
  }>;
  open: Array<{
    id: string;
    reference: string;
    name: string;
    client: string;
    status: ProjectStatus;
    progress: number;
    deliveryDate: string | null;
    isSlipping: boolean;
    tasks: number;
  }>;
}

export interface OutstandingReport {
  totals: { count: number; outstanding: MoneyByCurrency; overdue: MoneyByCurrency };
  byClient: Array<{
    id: string;
    name: string;
    count: number;
    outstanding: MoneyByCurrency;
    overdue: MoneyByCurrency;
  }>;
  items: Array<{
    id: string;
    reference: string;
    title: string;
    client: string;
    project: string | null;
    currency: Currency;
    amount: number;
    received: number;
    outstanding: number;
    dueDate: string | null;
    daysLate: number;
  }>;
}

export function useRevenueReport(months: number) {
  return useQuery({
    queryKey: ['reports', 'revenue', months],
    queryFn: () => apiGet<RevenueReport>('/reports/revenue', { params: { months } }),
  });
}

export function useSalesReport(months: number) {
  return useQuery({
    queryKey: ['reports', 'sales', months],
    queryFn: () => apiGet<SalesReport>('/reports/sales', { params: { months } }),
  });
}

export function useProjectReport() {
  return useQuery({
    queryKey: ['reports', 'projects'],
    queryFn: () => apiGet<ProjectReport>('/reports/projects'),
  });
}

export function useOutstandingReport() {
  return useQuery({
    queryKey: ['reports', 'outstanding'],
    queryFn: () => apiGet<OutstandingReport>('/reports/outstanding'),
  });
}
