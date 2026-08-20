import { z } from 'zod';
import { Currency, PaymentMethod, PaymentStatus } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const PAYMENT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'dueDate',
  'paidAt',
  'amount',
  'status',
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish();

export const paymentIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid payment id.'),
});

export const createPaymentSchema = z.object({
  clientId: z.string().uuid('Choose the client this is for.'),
  projectId: z.string().uuid().nullish(),
  dealId: z.string().uuid().nullish(),
  title: z.string().trim().min(1, 'Give the payment a title.').max(191),
  amount: z.coerce.number().min(0.01, 'Enter an amount.').max(9_999_999_999),
  currency: z.nativeEnum(Currency).default(Currency.INR),
  dueDate: z.coerce.date().nullish(),
  method: z.nativeEnum(PaymentMethod).nullish(),
  transactionRef: optionalText(191),
  notes: optionalText(5000),
});

export const updatePaymentSchema = z
  .object({
    title: z.string().trim().min(1).max(191).optional(),
    amount: z.coerce.number().min(0.01).max(9_999_999_999).optional(),
    currency: z.nativeEnum(Currency).optional(),
    dueDate: z.coerce.date().nullish(),
    projectId: z.string().uuid().nullish(),
    method: z.nativeEnum(PaymentMethod).nullish(),
    transactionRef: optionalText(191),
    notes: optionalText(5000),
    /** Recorded against an amount change, which is money moving. */
    amountChangeReason: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Money arriving.
 *
 * A receipt is additive — it never overwrites what was received before, so a
 * part payment followed by the balance leaves both on the record.
 */
export const recordReceiptSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Enter the amount received.').max(9_999_999_999),
  paidAt: z.coerce.date().default(() => new Date()),
  method: z.nativeEnum(PaymentMethod).nullish(),
  transactionRef: optionalText(191),
  note: optionalText(500),
});

export const cancelPaymentSchema = z.object({
  reason: z.string().trim().min(1, 'Say why this is being cancelled.').max(500),
});

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(PaymentStatus).optional(),
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  currency: z.nativeEnum(Currency).optional(),
  /** Past its due date and not settled. */
  overdue: booleanFlag,
  /** Anything still owed. */
  outstandingOnly: booleanFlag,
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
export type RecordReceiptInput = z.infer<typeof recordReceiptSchema>;
export type CancelPaymentInput = z.infer<typeof cancelPaymentSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
