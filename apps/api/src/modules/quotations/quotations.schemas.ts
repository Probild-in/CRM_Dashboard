import { z } from 'zod';
import { Currency, QuotationStatus } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const QUOTATION_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'issueDate',
  'validUntil',
  'total',
  'status',
] as const;

export const quotationIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid quotation id.'),
});

export const quotationItemSchema = z.object({
  serviceId: z.string().uuid().nullish(),
  description: z.string().trim().min(1, 'Describe this line.').max(255),
  quantity: z.coerce.number().min(0.01, 'Quantity must be more than zero.').max(999_999),
  unitPrice: z.coerce.number().min(0, 'Price cannot be negative.').max(9_999_999_999),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
});

const baseQuotationSchema = z.object({
  title: z.string().trim().min(1, 'Give the quotation a title.').max(191),
  clientId: z.string().uuid().nullish(),
  leadId: z.string().uuid().nullish(),
  dealId: z.string().uuid().nullish(),
  currency: z.nativeEnum(Currency).default(Currency.INR),
  issueDate: z.coerce.date().default(() => new Date()),
  validUntil: z.coerce.date().nullish(),
  /** Absolute amount taken off the subtotal, before tax. */
  discountAmount: z.coerce.number().min(0).max(9_999_999_999).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  paymentTerms: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => (value === '' ? null : value))
    .nullish(),
  notes: z
    .string()
    .trim()
    .max(5000)
    .transform((value) => (value === '' ? null : value))
    .nullish(),
  items: z.array(quotationItemSchema).min(1, 'Add at least one line item.'),
});

export const createQuotationSchema = baseQuotationSchema
  // A quotation is addressed to somebody; without a lead or client it is a document with no recipient.
  .refine((data) => Boolean(data.clientId) || Boolean(data.leadId), {
    path: ['clientId'],
    message: 'Attach the quotation to a client or a lead.',
  })
  .refine((data) => !data.validUntil || data.validUntil >= data.issueDate, {
    path: ['validUntil'],
    message: 'The validity date cannot be before the issue date.',
  });

export const updateQuotationSchema = baseQuotationSchema
  .omit({ clientId: true, leadId: true })
  .partial()
  .extend({
    /** Recorded against the price change in the pricing trail. */
    changeReason: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const changeQuotationStatusSchema = z.object({
  status: z.nativeEnum(QuotationStatus),
  note: z.string().trim().max(500).optional(),
});

export const listQuotationsQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(QuotationStatus).optional(),
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  currency: z.nativeEnum(Currency).optional(),
  /** Only quotations whose validity date has passed and are still undecided. */
  expiringSoon: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type QuotationItemInput = z.infer<typeof quotationItemSchema>;
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;
export type ChangeQuotationStatusInput = z.infer<typeof changeQuotationStatusSchema>;
export type ListQuotationsQuery = z.infer<typeof listQuotationsQuerySchema>;
