import { z } from 'zod';
import { Currency, DealStage } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const DEAL_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'value',
  'expectedCloseDate',
  'stage',
] as const;

export const dealIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid deal id.'),
});

export const createDealSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the deal a title.').max(191),
    clientId: z.string().uuid().nullish(),
    leadId: z.string().uuid().nullish(),
    ownerId: z.string().uuid().nullish(),
    stage: z.nativeEnum(DealStage).default(DealStage.OPEN),
    value: z.coerce.number().min(0, 'Value cannot be negative.').max(9_999_999_999).default(0),
    currency: z.nativeEnum(Currency).default(Currency.INR),
    probability: z.coerce.number().int().min(0).max(100).default(0),
    expectedCloseDate: z.coerce.date().nullish(),
    notes: z
      .string()
      .trim()
      .max(5000)
      .transform((value) => (value === '' ? null : value))
      .nullish(),
  })
  // A deal has to hang off something, or it is unreachable from any profile.
  .refine((data) => Boolean(data.clientId) || Boolean(data.leadId), {
    path: ['clientId'],
    message: 'Attach the deal to a client or a lead.',
  });

export const updateDealSchema = z
  .object({
    title: z.string().trim().min(1).max(191).optional(),
    ownerId: z.string().uuid().nullish(),
    value: z.coerce.number().min(0).max(9_999_999_999).optional(),
    currency: z.nativeEnum(Currency).optional(),
    probability: z.coerce.number().int().min(0).max(100).optional(),
    expectedCloseDate: z.coerce.date().nullish(),
    notes: z
      .string()
      .trim()
      .max(5000)
      .transform((value) => (value === '' ? null : value))
      .nullish(),
    /** Reason recorded against a value change, kept in pricing history. */
    valueChangeReason: z.string().trim().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const changeDealStageSchema = z
  .object({
    stage: z.nativeEnum(DealStage),
    lostReason: z
      .string()
      .trim()
      .max(255)
      .transform((value) => (value === '' ? null : value))
      .nullish(),
  })
  .refine((data) => data.stage !== DealStage.LOST || Boolean(data.lostReason), {
    path: ['lostReason'],
    message: 'Record why this deal was lost.',
  });

export const listDealsQuerySchema = paginationQuerySchema.extend({
  stage: z.nativeEnum(DealStage).optional(),
  clientId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  currency: z.nativeEnum(Currency).optional(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type ChangeDealStageInput = z.infer<typeof changeDealStageSchema>;
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;
