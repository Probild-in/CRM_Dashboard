import { z } from 'zod';
import { DocumentKind, EntityType } from '@probild/shared';
import { paginationQuerySchema } from '../../lib/pagination.js';

export const documentIdParamsSchema = z.object({
  id: z.string().uuid('Not a valid document id.'),
});

/** Metadata that travels alongside a multipart upload. */
export const uploadMetaSchema = z.object({
  name: z.string().trim().max(255).optional(),
  kind: z.nativeEnum(DocumentKind).default(DocumentKind.OTHER),
  description: z.string().trim().max(500).optional(),
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  entityType: z.nativeEnum(EntityType).optional(),
  entityId: z.string().uuid().optional(),
});

export const listDocumentsQuerySchema = paginationQuerySchema.extend({
  kind: z.nativeEnum(DocumentKind).optional(),
  clientId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  entityType: z.nativeEnum(EntityType).optional(),
  entityId: z.string().uuid().optional(),
});

/** Generate a paper from a record Probild already holds. */
export const generateSchema = z.object({
  source: z.enum(['QUOTATION', 'PAYMENT']),
  sourceId: z.string().uuid('Not a valid record id.'),
});

const emailField = z.string().trim().toLowerCase().email('That is not a valid email address.');

export const sendDocumentSchema = z.object({
  to: emailField,
  toName: z.string().trim().max(150).optional(),
  cc: z.array(emailField).max(5, 'Copy at most five people.').default([]),
  subject: z.string().trim().min(1, 'Give the email a subject.').max(255),
  message: z.string().trim().min(1, 'Write a covering note.').max(5000),
});

/**
 * Sending several papers at once.
 *
 * One email carries them all — a client receiving an agreement and its invoice
 * should get one message, not two.
 */
export const sendDocumentsSchema = z.object({
  documentIds: z
    .array(z.string().uuid())
    .min(1, 'Choose at least one document.')
    .max(10, 'Send at most ten documents in one email.'),
  to: emailField,
  toName: z.string().trim().max(150).optional(),
  cc: z.array(emailField).max(5, 'Copy at most five people.').default([]),
  subject: z.string().trim().min(1, 'Give the email a subject.').max(255),
  message: z.string().trim().min(1, 'Write a covering note.').max(5000),
});

export type SendDocumentsInput = z.infer<typeof sendDocumentsSchema>;
export type UploadMeta = z.infer<typeof uploadMetaSchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
export type GenerateInput = z.infer<typeof generateSchema>;
export type SendDocumentInput = z.infer<typeof sendDocumentSchema>;
