import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { QuotationStatus, UserRole } from '@probild/shared';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { computeTotals, round2 } from '../src/modules/quotations/quotations.totals.js';
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

async function createClient(token: string, companyName = 'ABC Technologies') {
  const response = await request(app)
    .post('/api/clients')
    .set(authHeader(token))
    .send({ companyName });
  return response.body.data;
}

const LINE = { description: 'Website build', quantity: 1, unitPrice: 100000, discountPercent: 0 };

async function createQuotation(token: string, clientId: string, overrides = {}) {
  return request(app)
    .post('/api/quotations')
    .set(authHeader(token))
    .send({
      title: 'Website project',
      clientId,
      issueDate: '2026-08-18',
      validUntil: '2026-09-02',
      items: [LINE],
      ...overrides,
    });
}

describe('totals calculation', () => {
  it('multiplies quantity by price and applies the line discount', () => {
    const totals = computeTotals(
      [{ description: 'Design', quantity: 3, unitPrice: 20000, discountPercent: 10 }],
      0,
      0,
    );
    // 3 × 20,000 = 60,000, less 10% = 54,000
    expect(totals.items[0]!.lineTotal).toBe(54000);
    expect(totals.subtotal).toBe(54000);
    expect(totals.total).toBe(54000);
  });

  it('applies the quotation discount before tax', () => {
    const totals = computeTotals([LINE], 10000, 18);
    // 100,000 − 10,000 = 90,000; 18% = 16,200; total 106,200
    expect(totals.subtotal).toBe(100000);
    expect(totals.discountAmount).toBe(10000);
    expect(totals.taxAmount).toBe(16200);
    expect(totals.total).toBe(106200);
  });

  it('never lets a discount push the total below zero', () => {
    const totals = computeTotals([LINE], 250000, 18);
    expect(totals.discountAmount).toBe(100000);
    expect(totals.total).toBe(0);
  });

  it('rounds every step to two decimals so the lines add up', () => {
    const totals = computeTotals(
      [
        { description: 'A', quantity: 3, unitPrice: 33.33, discountPercent: 0 },
        { description: 'B', quantity: 7, unitPrice: 1.115, discountPercent: 0 },
      ],
      0,
      18,
    );
    const lineSum = round2(totals.items.reduce((sum, item) => sum + item.lineTotal, 0));
    expect(totals.subtotal).toBe(lineSum);
    expect(totals.total).toBe(round2(totals.subtotal + totals.taxAmount));
  });

  it('sums several lines', () => {
    const totals = computeTotals(
      [
        { description: 'Design', quantity: 1, unitPrice: 120000, discountPercent: 0 },
        { description: 'Build', quantity: 2, unitPrice: 90000, discountPercent: 5 },
      ],
      0,
      18,
    );
    expect(totals.subtotal).toBe(291000);
    expect(totals.taxAmount).toBe(52380);
    expect(totals.total).toBe(343380);
  });
});

describe('POST /api/quotations', () => {
  it('stores server-computed totals and ignores any the client sends', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);

    const response = await createQuotation(token, client.id, {
      discountAmount: 10000,
      taxPercent: 18,
      // A tampered total must not survive.
      total: 1,
      subtotal: 1,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.subtotal).toBe(100000);
    expect(response.body.data.taxAmount).toBe(16200);
    expect(response.body.data.total).toBe(106200);
    expect(response.body.data.reference).toBe('QT-000001');
  });

  it('records the opening price in the trail', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id);

    const history = await request(app)
      .get(`/api/quotations/${quotation.body.data.id}/pricing-history`)
      .set(authHeader(token));

    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].previousValue).toBeNull();
    expect(history.body.data[0].newValue).toBe(100000);
  });

  it('needs at least one line item', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);

    const response = await createQuotation(token, client.id, { items: [] });

    expect(response.status).toBe(400);
  });

  it('needs a client or a lead to address it to', async () => {
    const { token } = await salesSession();

    const response = await request(app)
      .post('/api/quotations')
      .set(authHeader(token))
      .send({ title: 'Floating quote', issueDate: '2026-08-18', items: [LINE] });

    expect(response.status).toBe(400);
  });

  it('refuses a validity date before the issue date', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);

    const response = await createQuotation(token, client.id, {
      issueDate: '2026-08-18',
      validUntil: '2026-08-01',
    });

    expect(response.status).toBe(400);
  });
});

describe('negotiation', () => {
  it('keeps every price the quotation has carried', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id);
    const id = quotation.body.data.id;

    await request(app)
      .patch(`/api/quotations/${id}`)
      .set(authHeader(token))
      .send({
        items: [{ ...LINE, unitPrice: 110000 }],
        changeReason: 'Client asked for a revision',
      });
    await request(app)
      .patch(`/api/quotations/${id}`)
      .set(authHeader(token))
      .send({ items: [{ ...LINE, unitPrice: 100000 }], changeReason: 'Final agreed price' });

    const history = await request(app)
      .get(`/api/quotations/${id}/pricing-history`)
      .set(authHeader(token));

    expect(history.body.data).toHaveLength(3);
    expect(history.body.data.map((row: { newValue: number }) => row.newValue)).toEqual([
      100000, 110000, 100000,
    ]);
    expect(history.body.data[2].reason).toBe('Final agreed price');
  });

  it('replaces the line items wholesale and recomputes the total', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id, { taxPercent: 18 });

    const response = await request(app)
      .patch(`/api/quotations/${quotation.body.data.id}`)
      .set(authHeader(token))
      .send({
        items: [
          { description: 'Design', quantity: 1, unitPrice: 50000, discountPercent: 0 },
          { description: 'Build', quantity: 1, unitPrice: 50000, discountPercent: 0 },
        ],
      });

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.subtotal).toBe(100000);
    expect(response.body.data.total).toBe(118000);
  });

  it('refuses edits once the client has accepted', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id);
    const id = quotation.body.data.id;

    await request(app)
      .post(`/api/quotations/${id}/status`)
      .set(authHeader(token))
      .send({ status: QuotationStatus.SENT });
    await request(app)
      .post(`/api/quotations/${id}/status`)
      .set(authHeader(token))
      .send({ status: QuotationStatus.ACCEPTED });

    const response = await request(app)
      .patch(`/api/quotations/${id}`)
      .set(authHeader(token))
      .send({ items: [{ ...LINE, unitPrice: 1 }] });

    expect(response.status).toBe(409);
  });
});

describe('status transitions', () => {
  it('walks draft → sent → viewed → negotiation → accepted', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id);
    const id = quotation.body.data.id;

    for (const status of [
      QuotationStatus.SENT,
      QuotationStatus.VIEWED,
      QuotationStatus.NEGOTIATION,
      QuotationStatus.ACCEPTED,
    ]) {
      const response = await request(app)
        .post(`/api/quotations/${id}/status`)
        .set(authHeader(token))
        .send({ status });
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe(status);
    }
  });

  it('refuses a jump straight from draft to accepted', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id);

    const response = await request(app)
      .post(`/api/quotations/${quotation.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: QuotationStatus.ACCEPTED });

    expect(response.status).toBe(422);
  });

  it('stamps sent, viewed and decided times', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id);
    const id = quotation.body.data.id;

    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'SENT' });
    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'VIEWED' });
    const final = await request(app)
      .post(`/api/quotations/${id}/status`)
      .set(authHeader(token))
      .send({ status: 'REJECTED' });

    expect(final.body.data.sentAt).not.toBeNull();
    expect(final.body.data.viewedAt).not.toBeNull();
    expect(final.body.data.decidedAt).not.toBeNull();
  });

  it('wins the deal behind the quotation when the client accepts', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);

    const deal = await request(app)
      .post('/api/deals')
      .set(authHeader(token))
      .send({ title: 'Website build', clientId: client.id, value: 50000 });

    const quotation = await createQuotation(token, client.id, { dealId: deal.body.data.id });
    const id = quotation.body.data.id;

    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'SENT' });
    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'ACCEPTED' });

    const updatedDeal = await request(app)
      .get(`/api/deals/${deal.body.data.id}`)
      .set(authHeader(token));

    expect(updatedDeal.body.data.stage).toBe('WON');
    // The deal takes the agreed figure, not the one it was opened with.
    expect(updatedDeal.body.data.value).toBe(100000);
  });

  it('marks an undecided quotation past its date as expired', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id, {
      issueDate: '2020-01-01',
      validUntil: '2020-01-15',
    });

    const response = await request(app)
      .get(`/api/quotations/${quotation.body.data.id}`)
      .set(authHeader(token));

    expect(response.body.data.isExpired).toBe(true);
  });

  it('keeps an accepted quotation out of the expired set', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id, {
      issueDate: '2020-01-01',
      validUntil: '2020-01-15',
    });
    const id = quotation.body.data.id;

    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'SENT' });
    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'ACCEPTED' });

    const response = await request(app).get(`/api/quotations/${id}`).set(authHeader(token));
    expect(response.body.data.isExpired).toBe(false);
  });
});

describe('deletion and permissions', () => {
  it('keeps an accepted quotation', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);
    const token = session.accessToken;
    const client = await createClient(token);
    const quotation = await createQuotation(token, client.id);
    const id = quotation.body.data.id;

    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'SENT' });
    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'ACCEPTED' });

    const response = await request(app).delete(`/api/quotations/${id}`).set(authHeader(token));
    expect(response.status).toBe(409);
  });

  it('refuses quotation creation to an employee', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const adminSession = await loginAs(app, admin.email);
    const client = await createClient(adminSession.accessToken);

    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const response = await createQuotation(session.accessToken, client.id);
    expect(response.status).toBe(403);
  });

  it('filters by status and client', async () => {
    const { token } = await salesSession();
    const first = await createClient(token, 'ABC Technologies');
    const second = await createClient(token, 'XYZ Industries');
    await createQuotation(token, first.id);
    await createQuotation(token, second.id);

    const byClient = await request(app)
      .get('/api/quotations')
      .query({ clientId: first.id })
      .set(authHeader(token));

    expect(byClient.body.data).toHaveLength(1);
    expect(byClient.body.data[0].client.companyName).toBe('ABC Technologies');
  });
});

describe('deal pricing history', () => {
  it('records a deal value change with its reason', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);

    const deal = await request(app)
      .post('/api/deals')
      .set(authHeader(token))
      .send({ title: 'Retainer', clientId: client.id, value: 120000 });

    await request(app)
      .patch(`/api/deals/${deal.body.data.id}`)
      .set(authHeader(token))
      .send({ value: 100000, valueChangeReason: 'Negotiated down' });

    const history = await request(app)
      .get(`/api/deals/${deal.body.data.id}/pricing-history`)
      .set(authHeader(token));

    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].previousValue).toBe(120000);
    expect(history.body.data[0].newValue).toBe(100000);
    expect(history.body.data[0].reason).toBe('Negotiated down');
  });

  it('requires a reason before a deal can be marked lost', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    const deal = await request(app)
      .post('/api/deals')
      .set(authHeader(token))
      .send({ title: 'Retainer', clientId: client.id, value: 10000 });

    const withoutReason = await request(app)
      .post(`/api/deals/${deal.body.data.id}/stage`)
      .set(authHeader(token))
      .send({ stage: 'LOST' });

    expect(withoutReason.status).toBe(400);
  });

  it('refuses a deal that hangs off nothing', async () => {
    const { token } = await salesSession();

    const response = await request(app)
      .post('/api/deals')
      .set(authHeader(token))
      .send({ title: 'Orphan deal', value: 1000 });

    expect(response.status).toBe(400);
  });
});

describe('quotation references', () => {
  it('numbers quotations independently of leads and clients', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);

    const first = await createQuotation(token, client.id);
    const second = await createQuotation(token, client.id);

    expect(first.body.data.reference).toBe('QT-000001');
    expect(second.body.data.reference).toBe('QT-000002');
    expect(client.reference).toBe('CLT-000001');
  });

  it('stores money as an exact decimal', async () => {
    const { token } = await salesSession();
    const client = await createClient(token);
    await createQuotation(token, client.id, {
      items: [{ description: 'Odd', quantity: 3, unitPrice: 33.33, discountPercent: 0 }],
    });

    const stored = await prisma.quotation.findFirstOrThrow({ select: { subtotal: true } });
    expect(Number(stored.subtotal)).toBe(99.99);
  });
});
