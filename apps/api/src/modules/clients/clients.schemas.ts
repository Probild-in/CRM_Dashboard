import { z } from 'zod';
import { ClientStatus, Currency } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const CLIENT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'companyName',
  'onboardedAt',
  'status',
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullish();

const optionalUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => value === '' || /^https?:\/\/\S+$/i.test(value), {
      message: 'Enter a full URL starting with http:// or https://',
    })
    .transform((value) => (value === '' ? null : value))
    .nullish();

const optionalEmail = z
  .string()
  .trim()
  .max(191)
  .refine((value) => value === '' || z.string().email().safeParse(value).success, {
    message: 'That is not a valid email address.',
  })
  .transform((value) => (value === '' ? null : value.toLowerCase()))
  .nullish();

export const clientIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid client id.'),
});

export const createClientSchema = z.object({
  companyName: z.string().trim().min(1, 'Enter the company name.').max(191),
  email: optionalEmail,
  phone: optionalText(32),
  whatsapp: optionalText(32),
  website: optionalUrl(255),
  linkedin: optionalUrl(255),
  industry: optionalText(120),
  country: optionalText(80),
  city: optionalText(80),
  addressLine: optionalText(255),
  postalCode: optionalText(20),
  taxId: optionalText(64),
  status: z.nativeEnum(ClientStatus).default(ClientStatus.ACTIVE),
  defaultCurrency: z.nativeEnum(Currency).default(Currency.INR),
  accountManagerId: z.string().uuid().nullish(),
  onboardedAt: z.coerce.date().nullish(),
  notes: optionalText(5000),
});

export const updateClientSchema = createClientSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const listClientsQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(ClientStatus).optional(),
  accountManagerId: z.string().uuid().optional(),
  defaultCurrency: z.nativeEnum(Currency).optional(),
});

export const contactIdParamsSchema = clientIdParamsSchema.extend({
  contactId: z.string().uuid('Not a valid contact id.'),
});

export const createContactSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name.').max(80),
  lastName: optionalText(80),
  email: optionalEmail,
  phone: optionalText(32),
  whatsapp: optionalText(32),
  designation: optionalText(120),
  isPrimary: z.boolean().default(false),
  notes: optionalText(2000),
});

export const updateContactSchema = createContactSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * Turning a won lead into a client.
 *
 * The company details default to whatever the lead already holds, so the
 * common case is one confirmation rather than a second round of data entry.
 */
export const convertLeadSchema = z.object({
  companyName: z.string().trim().max(191).optional(),
  accountManagerId: z.string().uuid().nullish(),
  /** Also open a deal for the value the lead was won at. */
  createDeal: z.boolean().default(true),
  dealTitle: z.string().trim().max(191).optional(),
  dealValue: z.coerce.number().min(0).max(9_999_999_999).nullish(),
  onboardedAt: z.coerce.date().nullish(),
  notes: optionalText(5000),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
