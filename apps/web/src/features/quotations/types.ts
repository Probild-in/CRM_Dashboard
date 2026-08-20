import type { Currency, QuotationStatus } from '@probild/shared';

export interface QuotationItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
  position: number;
  service: { id: string; name: string } | null;
}

export interface Quotation {
  id: string;
  reference: string;
  title: string;
  status: QuotationStatus;
  currency: Currency;
  issueDate: string;
  validUntil: string | null;
  subtotal: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
  paymentTerms: string | null;
  notes: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; reference: string; companyName: string } | null;
  lead: { id: string; reference: string; companyName: string } | null;
  deal: { id: string; reference: string; title: string; stage: string } | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  items: QuotationItem[];
  /** Derived by the API: past its validity date and still undecided. */
  isExpired: boolean;
}

export interface PricingHistoryEntry {
  id: string;
  previousValue: number | null;
  newValue: number;
  currency: Currency;
  reason: string | null;
  createdAt: string;
  changedBy: { id: string; firstName: string; lastName: string } | null;
}
