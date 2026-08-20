import type { Currency, PaymentMethod, PaymentStatus } from '@probild/shared';

export type MoneyByCurrency = Record<Currency, number>;

export interface Payment {
  id: string;
  reference: string;
  title: string;
  status: PaymentStatus;
  amount: number;
  paidAmount: number;
  outstanding: number;
  currency: Currency;
  method: PaymentMethod | null;
  dueDate: string | null;
  paidAt: string | null;
  transactionRef: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; reference: string; companyName: string };
  project: { id: string; reference: string; name: string } | null;
  deal: { id: string; reference: string; title: string } | null;
  recordedBy: { id: string; firstName: string; lastName: string } | null;
  /** Derived by the API: past its due date and not settled. */
  isOverdue: boolean;
}

export interface PaymentSummary {
  billed: MoneyByCurrency;
  received: MoneyByCurrency;
  outstanding: MoneyByCurrency;
  overdue: MoneyByCurrency;
  counts: { total: number; outstanding: number; overdue: number; paid: number };
  aging: Array<{ bucket: string; count: number; value: MoneyByCurrency }>;
}
