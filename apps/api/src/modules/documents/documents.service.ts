import {
  AuditAction,
  DocumentKind,
  EntityType,
  type PaginatedResult,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, toSkipTake } from '../../lib/pagination.js';
import { recordAudit, type AuditInput } from '../audit/audit.service.js';
import * as storage from './storage.js';
import * as mailer from './mailer.js';
import { renderInvoice, renderQuotation, type CompanyProfile } from './pdf.js';
import type {
  GenerateInput,
  ListDocumentsQuery,
  SendDocumentInput,
  SendDocumentsInput,
  UploadMeta,
} from './documents.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

const documentSelect = {
  id: true,
  name: true,
  kind: true,
  description: true,
  mimeType: true,
  sizeBytes: true,
  isGenerated: true,
  entityType: true,
  entityId: true,
  createdAt: true,
  client: { select: { id: true, reference: true, companyName: true } },
  project: { select: { id: true, name: true } },
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
  sends: {
    orderBy: { sentAt: 'desc' },
    select: {
      id: true,
      recipientEmail: true,
      recipientName: true,
      subject: true,
      status: true,
      error: true,
      sentAt: true,
      sentBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.DocumentSelect;

export type DocumentView = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;

/**
 * The storage key is deliberately absent from `documentSelect` — it is an
 * internal path and nothing outside this module has any business seeing it.
 * Reads that need the bytes look it up separately.
 */
async function loadStorageKey(id: string): Promise<string> {
  const row = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    select: { storageKey: true },
  });
  if (!row) {
    throw new NotFoundError('Document');
  }
  return row.storageKey;
}

async function loadDocument(id: string): Promise<DocumentView> {
  const document = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    select: documentSelect,
  });
  if (!document) {
    throw new NotFoundError('Document');
  }
  return document;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listDocuments(
  query: ListDocumentsQuery,
): Promise<PaginatedResult<DocumentView>> {
  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };

  const { skip, take } = toSkipTake(query);

  const [items, total] = await prisma.$transaction([
    prisma.document.findMany({
      where,
      select: documentSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.document.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta(total, query) };
}

export async function getDocument(id: string): Promise<DocumentView> {
  return loadDocument(id);
}

export async function openForDownload(
  id: string,
): Promise<{ document: DocumentView; stream: NodeJS.ReadableStream; filename: string }> {
  const document = await loadDocument(id);
  const storageKey = await loadStorageKey(id);

  if (!(await storage.exists(storageKey))) {
    throw new NotFoundError('The stored file');
  }

  return {
    document,
    stream: await storage.readStream(storageKey),
    filename: storage.safeFilename(document.name),
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

/** The context a document hangs off, resolved and checked. */
async function resolveOwnership(meta: {
  clientId?: string;
  projectId?: string;
  entityType?: EntityType;
  entityId?: string;
}): Promise<{
  clientId: string | null;
  projectId: string | null;
  entityType: EntityType;
  entityId: string;
}> {
  let clientId = meta.clientId ?? null;

  if (meta.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: meta.projectId, deletedAt: null },
      select: { clientId: true },
    });
    if (!project) {
      throw new UnprocessableError('That project no longer exists.');
    }
    clientId = project.clientId;
  }

  if (clientId) {
    const client = await prisma.client.count({ where: { id: clientId, deletedAt: null } });
    if (client === 0) {
      throw new UnprocessableError('That client no longer exists.');
    }
  }

  // A document always points at something, so it can be found again.
  const entityType =
    meta.entityType ??
    (meta.projectId ? EntityType.PROJECT : clientId ? EntityType.CLIENT : EntityType.DOCUMENT);
  const entityId = meta.entityId ?? meta.projectId ?? clientId;

  if (!entityId) {
    throw new UnprocessableError('Attach the document to a client or a project.');
  }

  return { clientId, projectId: meta.projectId ?? null, entityType, entityId };
}

export async function uploadDocument(
  file: { originalname: string; mimetype: string; buffer: Buffer },
  meta: UploadMeta,
  actorId: string,
  audit: AuditMeta,
): Promise<DocumentView> {
  const ownership = await resolveOwnership(meta);
  const stored = await storage.store(file.buffer, file.mimetype);

  const document = await prisma.document.create({
    data: {
      name: (meta.name ?? file.originalname).slice(0, 255),
      kind: meta.kind,
      description: meta.description ?? null,
      storageKey: stored.storageKey,
      mimeType: file.mimetype,
      sizeBytes: stored.sizeBytes,
      isGenerated: false,
      uploadedById: actorId,
      ...ownership,
    },
    select: documentSelect,
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.DOCUMENT,
    entityId: document.id,
    summary: `Uploaded "${document.name}"`,
    newValue: { kind: document.kind, sizeBytes: document.sizeBytes },
  });

  return document;
}

/** Company details for the letterhead, from system settings. */
async function companyProfile(): Promise<CompanyProfile> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'company.profile' } });
  const value = (setting?.value ?? {}) as Record<string, unknown>;
  return {
    name: (value.name as string) ?? 'Probild',
    email: (value.email as string) ?? null,
    phone: (value.phone as string) ?? null,
    address: (value.address as string) ?? null,
    taxId: (value.taxId as string) ?? null,
  };
}

/**
 * Produces a paper from a record Probild already holds.
 *
 * Re-generating replaces the stored file rather than piling up copies — the
 * document is the current state of the quotation, and its send history stays
 * attached across regenerations.
 */
export async function generateDocument(
  input: GenerateInput,
  actorId: string,
  audit: AuditMeta,
): Promise<DocumentView> {
  const company = await companyProfile();

  const built =
    input.source === 'QUOTATION'
      ? await buildQuotationPdf(input.sourceId, company)
      : await buildInvoicePdf(input.sourceId, company);

  const stored = await storage.store(built.buffer, 'application/pdf');

  const existing = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      isGenerated: true,
      entityType: built.entityType,
      entityId: input.sourceId,
    },
    select: { id: true, storageKey: true },
  });

  const data = {
    name: built.name,
    kind: built.kind,
    description: built.description,
    storageKey: stored.storageKey,
    mimeType: 'application/pdf',
    sizeBytes: stored.sizeBytes,
    isGenerated: true,
    uploadedById: actorId,
    clientId: built.clientId,
    projectId: built.projectId,
    entityType: built.entityType,
    entityId: input.sourceId,
  };

  const document = existing
    ? await prisma.document.update({ where: { id: existing.id }, data, select: documentSelect })
    : await prisma.document.create({ data, select: documentSelect });

  if (existing) {
    await storage.remove(existing.storageKey);
  }

  await recordAudit({
    ...audit,
    action: existing ? AuditAction.UPDATED : AuditAction.CREATED,
    entityType: EntityType.DOCUMENT,
    entityId: document.id,
    summary: `${existing ? 'Regenerated' : 'Generated'} "${document.name}"`,
  });

  return document;
}

interface BuiltDocument {
  buffer: Buffer;
  name: string;
  kind: DocumentKind;
  description: string | null;
  clientId: string | null;
  projectId: string | null;
  entityType: EntityType;
}

async function buildQuotationPdf(id: string, company: CompanyProfile): Promise<BuiltDocument> {
  const quotation = await prisma.quotation.findFirst({
    where: { id, deletedAt: null },
    include: {
      items: { orderBy: { position: 'asc' } },
      client: true,
      lead: true,
    },
  });
  if (!quotation) {
    throw new NotFoundError('Quotation');
  }

  const recipient = quotation.client ?? quotation.lead;
  if (!recipient) {
    throw new UnprocessableError('This quotation is not addressed to anybody.');
  }

  const buffer = await renderQuotation({
    company,
    reference: quotation.reference,
    title: quotation.title,
    issueDate: quotation.issueDate,
    validUntil: quotation.validUntil,
    currency: quotation.currency,
    recipient: {
      name: recipient.companyName,
      email: recipient.email,
      address: 'addressLine' in recipient ? recipient.addressLine : null,
    },
    items: quotation.items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      discountPercent: Number(item.discountPercent),
      lineTotal: Number(item.lineTotal),
    })),
    subtotal: Number(quotation.subtotal),
    discountAmount: Number(quotation.discountAmount),
    taxPercent: Number(quotation.taxPercent),
    taxAmount: Number(quotation.taxAmount),
    total: Number(quotation.total),
    paymentTerms: quotation.paymentTerms,
    notes: quotation.notes,
  });

  return {
    buffer,
    name: `${quotation.reference} — ${quotation.title}.pdf`,
    kind: DocumentKind.QUOTATION,
    description: `Quotation for ${recipient.companyName}`,
    clientId: quotation.clientId,
    projectId: null,
    entityType: EntityType.QUOTATION,
  };
}

async function buildInvoicePdf(id: string, company: CompanyProfile): Promise<BuiltDocument> {
  const payment = await prisma.payment.findFirst({
    where: { id, deletedAt: null },
    include: { client: true, project: true },
  });
  if (!payment) {
    throw new NotFoundError('Payment');
  }

  const amount = Number(payment.amount);
  const paidAmount = Number(payment.paidAmount);

  const buffer = await renderInvoice({
    company,
    reference: payment.reference,
    title: payment.title,
    issuedOn: payment.createdAt,
    dueDate: payment.dueDate,
    currency: payment.currency,
    recipient: {
      name: payment.client.companyName,
      email: payment.client.email,
      address: payment.client.addressLine,
    },
    projectName: payment.project?.name ?? null,
    amount,
    paidAmount,
    outstanding: Math.round((amount - paidAmount) * 100) / 100,
    notes: payment.notes,
  });

  return {
    buffer,
    name: `${payment.reference} — ${payment.title}.pdf`,
    kind: DocumentKind.INVOICE,
    description: `Invoice for ${payment.client.companyName}`,
    clientId: payment.clientId,
    projectId: payment.projectId,
    entityType: EntityType.PAYMENT,
  };
}

/** Email providers reject large messages; refuse before the send, not after. */
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface SendOutcome {
  sent: boolean;
  error?: string;
  documents: DocumentView[];
}

/**
 * Sends one or more documents to a client, as a single email.
 *
 * The attempt is recorded against every document whether or not it succeeds: a
 * bounced address is something the account manager needs to see on the client
 * profile, not something that vanishes into a log.
 */
export async function sendDocuments(
  documentIds: string[],
  input: Omit<SendDocumentsInput, 'documentIds'>,
  actorId: string,
  audit: AuditMeta,
): Promise<SendOutcome> {
  if (!mailer.isMailConfigured()) {
    throw new mailer.MailNotConfiguredError();
  }

  const documents = await Promise.all(documentIds.map((id) => loadDocument(id)));

  const attachments: mailer.MailAttachment[] = [];
  let totalBytes = 0;

  for (const document of documents) {
    const storageKey = await loadStorageKey(document.id);
    if (!(await storage.exists(storageKey))) {
      throw new NotFoundError(`The stored file for "${document.name}"`);
    }

    const content = await storage.readBuffer(storageKey);
    totalBytes += content.byteLength;

    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new UnprocessableError(
        'Those documents come to more than 20MB together, which most inboxes will reject. Send them in smaller batches.',
      );
    }

    attachments.push({
      filename: storage.safeFilename(document.name),
      content,
      contentType: document.mimeType,
    });
  }

  const result = await mailer.send({
    to: input.to,
    toName: input.toName ?? null,
    cc: input.cc,
    subject: input.subject,
    body: input.message,
    attachments,
  });

  await prisma.documentSend.createMany({
    data: documents.map((document) => ({
      documentId: document.id,
      sentById: actorId,
      recipientEmail: input.to,
      recipientName: input.toName ?? null,
      ccEmails: input.cc.length > 0 ? input.cc.join(', ') : null,
      subject: input.subject,
      message: input.message,
      status: result.sent ? ('SENT' as const) : ('FAILED' as const),
      error: result.error ?? null,
    })),
  });

  const summary =
    documents.length === 1
      ? `"${documents[0]!.name}"`
      : `${documents.length} documents`;

  for (const document of documents) {
    await recordAudit({
      ...audit,
      action: AuditAction.UPDATED,
      entityType: EntityType.DOCUMENT,
      entityId: document.id,
      summary: result.sent
        ? `Sent ${summary} to ${input.to}`
        : `Failed to send ${summary} to ${input.to}`,
      newValue: { to: input.to, cc: input.cc, subject: input.subject, sent: result.sent },
    });
  }

  return {
    sent: result.sent,
    error: result.error,
    documents: await Promise.all(documents.map((document) => loadDocument(document.id))),
  };
}

/** Sending exactly one, kept for the per-document action. */
export async function sendDocument(
  id: string,
  input: SendDocumentInput,
  actorId: string,
  audit: AuditMeta,
): Promise<{ document: DocumentView; sent: boolean; error?: string }> {
  const outcome = await sendDocuments([id], input, actorId, audit);
  return { document: outcome.documents[0]!, sent: outcome.sent, error: outcome.error };
}

export async function deleteDocument(id: string, audit: AuditMeta): Promise<void> {
  const document = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, storageKey: true },
  });
  if (!document) {
    throw new NotFoundError('Document');
  }

  await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
  await storage.remove(document.storageKey);

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.DOCUMENT,
    entityId: id,
    summary: `Deleted "${document.name}"`,
  });
}
