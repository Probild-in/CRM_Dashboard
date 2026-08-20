import {
  AuditAction,
  ClientStatus,
  DealStage,
  EntityType,
  LeadActivityType,
  LeadStatus,
  PaymentStatus,
  QuotationStatus,
  type PaginatedResult,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { REFERENCE_PREFIX, nextReference } from '../../lib/reference.js';
import { diffFields, recordAudit, type AuditInput } from '../audit/audit.service.js';
import {
  CLIENT_SORT_FIELDS,
  type ConvertLeadInput,
  type CreateClientInput,
  type CreateContactInput,
  type ListClientsQuery,
  type UpdateClientInput,
  type UpdateContactInput,
} from './clients.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

const clientSelect = {
  id: true,
  reference: true,
  companyName: true,
  email: true,
  phone: true,
  whatsapp: true,
  website: true,
  linkedin: true,
  industry: true,
  country: true,
  city: true,
  addressLine: true,
  postalCode: true,
  taxId: true,
  status: true,
  defaultCurrency: true,
  onboardedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  accountManager: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.ClientSelect;

export type ClientView = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;

export async function listClients(query: ListClientsQuery): Promise<PaginatedResult<ClientView>> {
  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.accountManagerId ? { accountManagerId: query.accountManagerId } : {}),
    ...(query.defaultCurrency ? { defaultCurrency: query.defaultCurrency } : {}),
    ...(query.search ? { OR: clientSearchClauses(query.search) } : {}),
  };

  const sortBy = resolveSort(query.sortBy, CLIENT_SORT_FIELDS, 'createdAt');
  const { skip, take } = toSkipTake(query);

  const [items, total] = await prisma.$transaction([
    prisma.client.findMany({
      where,
      select: clientSelect,
      orderBy: { [sortBy]: query.sortOrder },
      skip,
      take,
    }),
    prisma.client.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta(total, query) };
}

export function clientSearchClauses(term: string): Prisma.ClientWhereInput[] {
  return [
    { companyName: { contains: term, mode: 'insensitive' } },
    { email: { contains: term, mode: 'insensitive' } },
    { phone: { contains: term, mode: 'insensitive' } },
    { reference: { contains: term, mode: 'insensitive' } },
    { city: { contains: term, mode: 'insensitive' } },
    { industry: { contains: term, mode: 'insensitive' } },
  ];
}

export async function getClient(id: string): Promise<ClientView> {
  const client = await prisma.client.findFirst({
    where: { id, deletedAt: null },
    select: clientSelect,
  });
  if (!client) {
    throw new NotFoundError('Client');
  }
  return client;
}

/**
 * The 360° view: everything Probild holds about a client, in one response.
 *
 * Sections for modules that have not shipped yet return empty lists rather
 * than being absent, so the screen has one shape from the first phase on.
 */
export async function getClientOverview(id: string) {
  const client = await getClient(id);

  const [
    contacts,
    deals,
    quotations,
    projects,
    tasks,
    meetings,
    payments,
    documents,
    originLeads,
    activity,
  ] = await prisma.$transaction([
    prisma.contact.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
    }),
    prisma.deal.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.quotation.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        total: true,
        currency: true,
        issueDate: true,
        validUntil: true,
      },
    }),
    prisma.project.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.task.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { assignee: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.meeting.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { startsAt: 'desc' },
      take: 20,
    }),
    prisma.payment.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.document.findMany({
      where: { clientId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.lead.findMany({
      where: { convertedClientId: id },
      select: { id: true, reference: true, companyName: true, convertedAt: true, source: true },
    }),
    prisma.auditLog.findMany({
      where: { entityType: EntityType.CLIENT, entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    }),
  ]);

  return {
    client,
    contacts,
    deals: deals.map((deal) => ({ ...deal, value: Number(deal.value) })),
    quotations: quotations.map((quotation) => ({
      ...quotation,
      total: Number(quotation.total),
    })),
    projects: projects.map((project) => ({ ...project, value: Number(project.value) })),
    tasks,
    meetings,
    payments: payments.map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
      paidAmount: Number(payment.paidAmount),
    })),
    documents,
    originLeads,
    activity,
    stats: buildClientStats(deals, quotations, projects, payments),
  };
}

/** Headline numbers for the client profile, per currency where money is involved. */
function buildClientStats(
  deals: Array<{ stage: DealStage; value: Prisma.Decimal; currency: string }>,
  quotations: Array<{ status: QuotationStatus; total: Prisma.Decimal; currency: string }>,
  projects: Array<{ status: string }>,
  payments: Array<{
    status: PaymentStatus;
    amount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    currency: string;
  }>,
) {
  const byCurrency = (
    rows: Array<{ currency: string }>,
    amount: (row: never) => number,
  ): Record<string, number> =>
    rows.reduce<Record<string, number>>((totals, row) => {
      const value = amount(row as never);
      return value === 0 ? totals : { ...totals, [row.currency]: (totals[row.currency] ?? 0) + value };
    }, {});

  const wonDeals = deals.filter((deal) => deal.stage === DealStage.WON);
  const openDeals = deals.filter(
    (deal) => deal.stage === DealStage.OPEN || deal.stage === DealStage.NEGOTIATION,
  );

  return {
    dealCount: deals.length,
    openDealCount: openDeals.length,
    wonValue: byCurrency(wonDeals, (deal: { value: Prisma.Decimal }) => Number(deal.value)),
    openValue: byCurrency(openDeals, (deal: { value: Prisma.Decimal }) => Number(deal.value)),
    quotationCount: quotations.length,
    acceptedQuotationValue: byCurrency(
      quotations.filter((quotation) => quotation.status === QuotationStatus.ACCEPTED),
      (quotation: { total: Prisma.Decimal }) => Number(quotation.total),
    ),
    projectCount: projects.length,
    activeProjectCount: projects.filter((project) => project.status === 'ACTIVE').length,
    // Outstanding = billed minus received, ignoring anything cancelled.
    billed: byCurrency(
      payments.filter((payment) => payment.status !== PaymentStatus.CANCELLED),
      (payment: { amount: Prisma.Decimal }) => Number(payment.amount),
    ),
    received: byCurrency(
      payments.filter((payment) => payment.status !== PaymentStatus.CANCELLED),
      (payment: { paidAmount: Prisma.Decimal }) => Number(payment.paidAmount),
    ),
    outstanding: byCurrency(
      payments.filter((payment) => payment.status !== PaymentStatus.CANCELLED),
      (payment: { amount: Prisma.Decimal; paidAmount: Prisma.Decimal }) =>
        Number(payment.amount) - Number(payment.paidAmount),
    ),
  };
}

export async function createClient(
  input: CreateClientInput,
  audit: AuditMeta,
): Promise<ClientView> {
  const client = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, REFERENCE_PREFIX.CLIENT);
    return tx.client.create({
      data: { ...input, reference, onboardedAt: input.onboardedAt ?? new Date() },
      select: clientSelect,
    });
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.CLIENT,
    entityId: client.id,
    summary: `Created client ${client.reference} — ${client.companyName}`,
    newValue: { companyName: client.companyName, status: client.status },
  });

  return client;
}

export async function updateClient(
  id: string,
  input: UpdateClientInput,
  audit: AuditMeta,
): Promise<ClientView> {
  const current = await getClient(id);
  const updated = await prisma.client.update({
    where: { id },
    data: input as Prisma.ClientUpdateInput,
    select: clientSelect,
  });

  const changes = diffFields(current as unknown as Record<string, unknown>, input as never);
  if (changes) {
    await recordAudit({
      ...audit,
      action: input.status && input.status !== current.status ? AuditAction.STATUS_CHANGED : AuditAction.UPDATED,
      entityType: EntityType.CLIENT,
      entityId: id,
      summary: `Updated client ${current.reference}`,
      previousValue: changes.previous as never,
      newValue: changes.next as never,
    });
  }

  return updated;
}

/** Soft delete, refused while the client still has delivery or money attached. */
export async function deleteClient(id: string, audit: AuditMeta): Promise<void> {
  const current = await getClient(id);

  const [projects, payments] = await prisma.$transaction([
    prisma.project.count({ where: { clientId: id, deletedAt: null } }),
    prisma.payment.count({ where: { clientId: id, deletedAt: null } }),
  ]);

  if (projects > 0 || payments > 0) {
    throw new ConflictError(
      'This client has projects or payments attached. Mark them inactive instead of deleting.',
    );
  }

  await prisma.client.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.CLIENT,
    entityId: id,
    summary: `Deleted client ${current.reference} — ${current.companyName}`,
  });
}

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

export async function listContacts(clientId: string) {
  await getClient(clientId);
  return prisma.contact.findMany({
    where: { clientId, deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }],
  });
}

export async function createContact(
  clientId: string,
  input: CreateContactInput,
  audit: AuditMeta,
) {
  await getClient(clientId);

  const contact = await prisma.$transaction(async (tx) => {
    // Only one contact can be primary, so promoting one demotes the rest.
    if (input.isPrimary) {
      await tx.contact.updateMany({ where: { clientId }, data: { isPrimary: false } });
    }
    return tx.contact.create({ data: { ...input, clientId } });
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.CONTACT,
    entityId: contact.id,
    summary: `Added contact ${contact.firstName} ${contact.lastName ?? ''}`.trim(),
  });

  return contact;
}

export async function updateContact(
  clientId: string,
  contactId: string,
  input: UpdateContactInput,
  audit: AuditMeta,
) {
  const current = await prisma.contact.findFirst({
    where: { id: contactId, clientId, deletedAt: null },
  });
  if (!current) {
    throw new NotFoundError('Contact');
  }

  const contact = await prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.contact.updateMany({
        where: { clientId, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }
    return tx.contact.update({ where: { id: contactId }, data: input });
  });

  await recordAudit({
    ...audit,
    action: AuditAction.UPDATED,
    entityType: EntityType.CONTACT,
    entityId: contactId,
    summary: `Updated contact ${contact.firstName}`,
  });

  return contact;
}

export async function deleteContact(
  clientId: string,
  contactId: string,
  audit: AuditMeta,
): Promise<void> {
  const current = await prisma.contact.findFirst({
    where: { id: contactId, clientId, deletedAt: null },
  });
  if (!current) {
    throw new NotFoundError('Contact');
  }

  await prisma.contact.update({ where: { id: contactId }, data: { deletedAt: new Date() } });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.CONTACT,
    entityId: contactId,
    summary: `Removed contact ${current.firstName}`,
  });
}

/* ------------------------------------------------------------------ */
/* Conversion                                                          */
/* ------------------------------------------------------------------ */

/**
 * Turns a won lead into a client.
 *
 * The lead is kept and linked rather than replaced — its pipeline history is
 * the record of how the client was won, and deleting it would erase that.
 * Everything happens in one transaction so a half-converted lead is impossible.
 */
export async function convertLead(
  leadId: string,
  input: ConvertLeadInput,
  actorId: string,
  audit: AuditMeta,
): Promise<{ client: ClientView; dealId: string | null }> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    include: { assignedTo: { select: { id: true } } },
  });

  if (!lead) {
    throw new NotFoundError('Lead');
  }
  if (lead.convertedClientId) {
    throw new ConflictError('This lead has already been converted to a client.');
  }
  if (lead.status !== LeadStatus.WON) {
    throw new UnprocessableError('Mark the lead as won before converting it to a client.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, REFERENCE_PREFIX.CLIENT);

    const client = await tx.client.create({
      data: {
        reference,
        companyName: input.companyName ?? lead.companyName,
        email: lead.email,
        phone: lead.phone,
        whatsapp: lead.whatsapp,
        website: lead.website,
        linkedin: lead.linkedin,
        industry: lead.industry,
        country: lead.country,
        city: lead.city,
        defaultCurrency: lead.currency,
        status: ClientStatus.ACTIVE,
        accountManagerId: input.accountManagerId ?? lead.assignedToId,
        onboardedAt: input.onboardedAt ?? new Date(),
        notes: input.notes ?? lead.notes,
      },
      select: clientSelect,
    });

    // The named contact on the lead becomes the client's primary contact.
    if (lead.contactPerson) {
      const [firstName, ...rest] = lead.contactPerson.trim().split(/\s+/);
      await tx.contact.create({
        data: {
          clientId: client.id,
          firstName: firstName ?? lead.contactPerson,
          lastName: rest.length > 0 ? rest.join(' ') : null,
          email: lead.email,
          phone: lead.phone,
          whatsapp: lead.whatsapp,
          isPrimary: true,
        },
      });
    }

    let dealId: string | null = null;
    if (input.createDeal) {
      const dealReference = await nextReference(tx, REFERENCE_PREFIX.DEAL);
      const deal = await tx.deal.create({
        data: {
          reference: dealReference,
          title: input.dealTitle ?? `${client.companyName} — ${lead.reference}`,
          leadId: lead.id,
          clientId: client.id,
          ownerId: lead.assignedToId,
          stage: DealStage.WON,
          value: input.dealValue ?? lead.expectedValue ?? 0,
          currency: lead.currency,
          probability: 100,
          closedAt: new Date(),
        },
        select: { id: true },
      });
      dealId = deal.id;
    }

    await tx.lead.update({
      where: { id: lead.id },
      data: { convertedClientId: client.id, convertedAt: new Date(), nextFollowUpAt: null },
    });

    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        userId: actorId,
        type: LeadActivityType.CONVERTED,
        title: `Converted to client ${client.reference}`,
        toValue: client.reference,
      },
    });

    return { client, dealId };
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CONVERTED,
    entityType: EntityType.LEAD,
    entityId: lead.id,
    summary: `${lead.reference} converted to client ${result.client.reference}`,
    newValue: { clientId: result.client.id, dealId: result.dealId },
  });

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.CLIENT,
    entityId: result.client.id,
    summary: `Created from lead ${lead.reference}`,
    newValue: { companyName: result.client.companyName, fromLead: lead.reference },
  });

  return result;
}
