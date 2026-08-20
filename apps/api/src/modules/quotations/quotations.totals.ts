import type { QuotationItemInput } from './quotations.schemas.js';

/**
 * Money maths for a quotation.
 *
 * This lives on the server and nowhere else: the client sends quantities and
 * prices, never totals. Every step rounds to two decimal places so the printed
 * figures always add up — floating point drift on a ₹12,00,000 quotation is a
 * conversation nobody wants to have with a client.
 */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface ComputedItem extends QuotationItemInput {
  lineTotal: number;
  position: number;
}

export interface QuotationTotals {
  items: ComputedItem[];
  subtotal: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
}

export function computeTotals(
  items: QuotationItemInput[],
  discountAmount: number,
  taxPercent: number,
): QuotationTotals {
  const computed = items.map((item, index) => ({
    ...item,
    position: index,
    lineTotal: round2(item.quantity * item.unitPrice * (1 - item.discountPercent / 100)),
  }));

  const subtotal = round2(computed.reduce((sum, item) => sum + item.lineTotal, 0));

  // A discount can zero an invoice but never invert it.
  const appliedDiscount = round2(Math.min(Math.max(discountAmount, 0), subtotal));
  const taxableBase = round2(subtotal - appliedDiscount);
  const taxAmount = round2((taxableBase * taxPercent) / 100);

  return {
    items: computed,
    subtotal,
    discountAmount: appliedDiscount,
    taxPercent,
    taxAmount,
    total: round2(taxableBase + taxAmount),
  };
}
