import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { LeadStatus, UserRole } from '@probild/shared';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { authHeader, buildTestApp, createTestUser, loginAs, resetDatabase } from './helpers.js';

let app: Express;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectPrisma();
});

async function salesSession() {
  const user = await createTestUser(UserRole.SALES);
  const session = await loginAs(app, user.email);
  return { user, token: session.accessToken };
}

/** Creates a lead and takes it all the way to won, ready to convert. */
async function wonLead(token: string, overrides: Record<string, unknown> = {}) {
  const lead = await request(app)
    .post('/api/leads')
    .set(authHeader(token))
    .send({
      companyName: 'ABC Technologies',
      contactPerson: 'Rohan Mehta',
      email: 'rohan@abctech.in',
      phone: '+91 98765 43210',
      city: 'Mumbai',
      country: 'India',
      industry: 'Logistics',
      expectedValue: 1200000,
      currency: 'INR',
      nextFollowUpAt: '2026-09-01T05:30:00.000Z',
      ...overrides,
    });

  await request(app)
    .post(`/api/leads/${lead.body.data.id}/status`)
    .set(authHeader(token))
    .send({ status: LeadStatus.WON });

  return lead.body.data;
}

describe('POST /api/leads/:id/convert', () => {
  it('creates a client that carries the lead’s details across', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set(authHeader(token))
      .send({ createDeal: true });

    expect(response.status).toBe(201);
    const client = response.body.data.client;
    expect(client.reference).toBe('CLT-000001');
    expect(client.companyName).toBe('ABC Technologies');
    expect(client.email).toBe('rohan@abctech.in');
    expect(client.city).toBe('Mumbai');
    expect(client.defaultCurrency).toBe('INR');
  });

  it('keeps the lead and links it to the client', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set(authHeader(token))
      .send({});

    const storedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(storedLead.deletedAt).toBeNull();
    expect(storedLead.convertedClientId).toBe(response.body.data.client.id);
    expect(storedLead.convertedAt).not.toBeNull();
  });

  it('turns the named contact into the client’s primary contact', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set(authHeader(token))
      .send({});

    const contacts = await request(app)
      .get(`/api/clients/${response.body.data.client.id}/contacts`)
      .set(authHeader(token));

    expect(contacts.body.data).toHaveLength(1);
    expect(contacts.body.data[0].firstName).toBe('Rohan');
    expect(contacts.body.data[0].lastName).toBe('Mehta');
    expect(contacts.body.data[0].isPrimary).toBe(true);
  });

  it('opens a won deal for the value the lead was won at', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set(authHeader(token))
      .send({ createDeal: true });

    const deal = await request(app)
      .get(`/api/deals/${response.body.data.dealId}`)
      .set(authHeader(token));

    expect(deal.body.data.stage).toBe('WON');
    expect(deal.body.data.value).toBe(1200000);
    expect(deal.body.data.lead.id).toBe(lead.id);
  });

  it('can convert without opening a deal', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set(authHeader(token))
      .send({ createDeal: false });

    expect(response.body.data.dealId).toBeNull();
  });

  it('refuses to convert a lead that has not been won', async () => {
    const { token } = await salesSession();
    const lead = await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({ companyName: 'Still open' });

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/convert`)
      .set(authHeader(token))
      .send({});

    expect(response.status).toBe(422);
  });

  it('refuses to convert the same lead twice', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);

    await request(app).post(`/api/leads/${lead.id}/convert`).set(authHeader(token)).send({});
    const second = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set(authHeader(token))
      .send({});

    expect(second.status).toBe(409);
    expect(await prisma.client.count()).toBe(1);
  });

  it('locks the converted lead against further edits', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);
    await request(app).post(`/api/leads/${lead.id}/convert`).set(authHeader(token)).send({});

    const edit = await request(app)
      .patch(`/api/leads/${lead.id}`)
      .set(authHeader(token))
      .send({ companyName: 'Renamed' });

    expect(edit.status).toBe(409);
  });

  it('writes the conversion to the lead’s timeline and the audit trail', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);
    await request(app).post(`/api/leads/${lead.id}/convert`).set(authHeader(token)).send({});

    const activities = await request(app)
      .get(`/api/leads/${lead.id}/activities`)
      .set(authHeader(token));
    expect(
      activities.body.data.some((entry: { type: string }) => entry.type === 'CONVERTED'),
    ).toBe(true);

    const audits = await prisma.auditLog.findMany({ where: { action: 'CONVERTED' } });
    expect(audits).toHaveLength(1);
  });

  it('refuses conversion to an employee', async () => {
    const sales = await salesSession();
    const lead = await wonLead(sales.token);

    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const response = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set(authHeader(session.accessToken))
      .send({});

    expect(response.status).toBe(403);
  });
});

describe('client 360', () => {
  it('gathers every section in one response', async () => {
    const { token } = await salesSession();
    const lead = await wonLead(token);
    const converted = await request(app)
      .post(`/api/leads/${lead.id}/convert`)
      .set(authHeader(token))
      .send({ createDeal: true });
    const clientId = converted.body.data.client.id;

    await request(app)
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        title: 'Website build',
        clientId,
        issueDate: '2026-08-18',
        items: [{ description: 'Build', quantity: 1, unitPrice: 500000, discountPercent: 0 }],
      });

    const response = await request(app)
      .get(`/api/clients/${clientId}/overview`)
      .set(authHeader(token));

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.client.reference).toBe('CLT-000001');
    expect(data.contacts).toHaveLength(1);
    expect(data.deals).toHaveLength(1);
    expect(data.quotations).toHaveLength(1);
    // Sections for modules that have not shipped are present and empty.
    expect(data.projects).toEqual([]);
    expect(data.payments).toEqual([]);
    expect(data.originLeads[0].reference).toBe(lead.reference);
  });

  it('totals won value per currency without mixing them', async () => {
    const { token } = await salesSession();
    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'Mixed currency client' });
    const clientId = client.body.data.id;

    for (const [value, currency] of [
      [100000, 'INR'],
      [50000, 'INR'],
      [2000, 'USD'],
    ] as const) {
      const deal = await request(app)
        .post('/api/deals')
        .set(authHeader(token))
        .send({ title: `Deal ${value}`, clientId, value, currency });
      await request(app)
        .post(`/api/deals/${deal.body.data.id}/stage`)
        .set(authHeader(token))
        .send({ stage: 'WON' });
    }

    const response = await request(app)
      .get(`/api/clients/${clientId}/overview`)
      .set(authHeader(token));

    expect(response.body.data.stats.wonValue).toEqual({ INR: 150000, USD: 2000 });
  });
});

describe('clients and contacts', () => {
  it('keeps only one primary contact', async () => {
    const { token } = await salesSession();
    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'ABC Technologies' });
    const clientId = client.body.data.id;

    await request(app)
      .post(`/api/clients/${clientId}/contacts`)
      .set(authHeader(token))
      .send({ firstName: 'First', isPrimary: true });
    await request(app)
      .post(`/api/clients/${clientId}/contacts`)
      .set(authHeader(token))
      .send({ firstName: 'Second', isPrimary: true });

    const contacts = await request(app)
      .get(`/api/clients/${clientId}/contacts`)
      .set(authHeader(token));

    const primaries = contacts.body.data.filter((contact: { isPrimary: boolean }) => contact.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].firstName).toBe('Second');
  });

  it('refuses to delete a client that still has payments', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);
    const token = session.accessToken;

    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'Paying client' });

    await prisma.payment.create({
      data: {
        reference: 'PAY-000001',
        clientId: client.body.data.id,
        title: 'Advance',
        amount: 50000,
        currency: 'INR',
      },
    });

    const response = await request(app)
      .delete(`/api/clients/${client.body.data.id}`)
      .set(authHeader(token));

    expect(response.status).toBe(409);
  });

  it('soft-deletes a client with nothing attached', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);
    const token = session.accessToken;

    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'Quiet client' });

    const response = await request(app)
      .delete(`/api/clients/${client.body.data.id}`)
      .set(authHeader(token));

    expect(response.status).toBe(204);
    const stored = await prisma.client.findUniqueOrThrow({ where: { id: client.body.data.id } });
    expect(stored.deletedAt).not.toBeNull();
  });

  it('lets a project manager read clients but not change them', async () => {
    const manager = await createTestUser(UserRole.PROJECT_MANAGER);
    const session = await loginAs(app, manager.email);

    const read = await request(app).get('/api/clients').set(authHeader(session.accessToken));
    const write = await request(app)
      .post('/api/clients')
      .set(authHeader(session.accessToken))
      .send({ companyName: 'Should fail' });

    expect(read.status).toBe(200);
    expect(write.status).toBe(403);
  });
});

describe('search casing', () => {
  it('matches a search term regardless of case', async () => {
    const { token } = await salesSession();

    await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'Acme Industries' })
      .expect(201);

    // MySQL's utf8mb4_unicode_ci matched this for free; Postgres does not.
    const response = await request(app)
      .get('/api/clients?search=acme')
      .set(authHeader(token))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].companyName).toBe('Acme Industries');
  });
});
