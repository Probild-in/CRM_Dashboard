import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { PaymentStatus, UserRole } from '@probild/shared';
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

async function adminSession() {
  const user = await createTestUser(UserRole.SUPER_ADMIN);
  const session = await loginAs(app, user.email);
  return { user, token: session.accessToken };
}

async function makeClient(token: string, companyName = 'ABC Technologies') {
  const response = await request(app)
    .post('/api/clients')
    .set(authHeader(token))
    .send({ companyName });
  return response.body.data;
}

async function makePayment(token: string, clientId: string, overrides = {}) {
  return request(app)
    .post('/api/payments')
    .set(authHeader(token))
    .send({
      clientId,
      title: 'Advance invoice',
      amount: 100000,
      currency: 'INR',
      dueDate: '2026-09-15',
      ...overrides,
    });
}

describe('raising a payment', () => {
  it('creates it pending, with a sequential reference', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const first = await makePayment(token, client.id);
    const second = await makePayment(token, client.id, { title: 'Balance invoice' });

    expect(first.status).toBe(201);
    expect(first.body.data.reference).toBe('PAY-000001');
    expect(second.body.data.reference).toBe('PAY-000002');
    expect(first.body.data.status).toBe(PaymentStatus.PENDING);
    expect(first.body.data.outstanding).toBe(100000);
  });

  it('refuses a project that belongs to another client', async () => {
    const { token } = await adminSession();
    const first = await makeClient(token, 'ABC Technologies');
    const second = await makeClient(token, 'XYZ Industries');

    const project = await request(app)
      .post('/api/projects')
      .set(authHeader(token))
      .send({ clientId: second.id, name: 'Their project' });

    const response = await makePayment(token, first.id, { projectId: project.body.data.id });

    expect(response.status).toBe(422);
  });

  it('refuses an amount of zero', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const response = await makePayment(token, client.id, { amount: 0 });

    expect(response.status).toBe(400);
  });

  it('refuses payment creation to a project manager', async () => {
    const admin = await adminSession();
    const client = await makeClient(admin.token);

    const manager = await createTestUser(UserRole.PROJECT_MANAGER);
    const session = await loginAs(app, manager.email);

    const response = await makePayment(session.accessToken, client.id);
    expect(response.status).toBe(403);
  });
});

describe('receipts are additive', () => {
  it('takes a part payment, then the balance', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100000 });
    const id = payment.body.data.id;

    const part = await request(app)
      .post(`/api/payments/${id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 40000, method: 'BANK_TRANSFER', transactionRef: 'UTR-001' });

    expect(part.body.data.paidAmount).toBe(40000);
    expect(part.body.data.outstanding).toBe(60000);
    expect(part.body.data.status).toBe(PaymentStatus.PARTIALLY_PAID);

    const balance = await request(app)
      .post(`/api/payments/${id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 60000 });

    // The second receipt adds to the first rather than replacing it.
    expect(balance.body.data.paidAmount).toBe(100000);
    expect(balance.body.data.outstanding).toBe(0);
    expect(balance.body.data.status).toBe(PaymentStatus.PAID);
  });

  it('refuses more than is outstanding', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100000 });

    const response = await request(app)
      .post(`/api/payments/${payment.body.data.id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 150000 });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toContain('outstanding');
  });

  it('refuses a receipt against something already settled', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 50000 });
    const id = payment.body.data.id;

    await request(app)
      .post(`/api/payments/${id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 50000 });

    const again = await request(app)
      .post(`/api/payments/${id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 1000 });

    expect(again.status).toBe(409);
  });

  it('rounds to two decimals so the parts add up', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100 });
    const id = payment.body.data.id;

    for (const amount of [33.33, 33.33, 33.34]) {
      await request(app)
        .post(`/api/payments/${id}/receipts`)
        .set(authHeader(token))
        .send({ amount });
    }

    const settled = await request(app).get(`/api/payments/${id}`).set(authHeader(token));
    expect(settled.body.data.paidAmount).toBe(100);
    expect(settled.body.data.outstanding).toBe(0);
    expect(settled.body.data.status).toBe(PaymentStatus.PAID);
  });

  it('records each receipt in the audit trail', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100000 });

    await request(app)
      .post(`/api/payments/${payment.body.data.id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 40000, transactionRef: 'UTR-001' });

    const entries = await prisma.auditLog.findMany({
      where: { entityId: payment.body.data.id },
      orderBy: { createdAt: 'desc' },
    });

    const receipt = entries.find((entry) => entry.summary?.includes('received'));
    expect(receipt).toBeDefined();
    expect(JSON.stringify(receipt!.newValue)).toContain('UTR-001');
  });
});

describe('lateness is derived, never a status', () => {
  it('reports a pending payment past its date as overdue', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { dueDate: '2020-01-01' });

    const response = await request(app)
      .get(`/api/payments/${payment.body.data.id}`)
      .set(authHeader(token));

    // The settlement state is still PENDING; lateness sits beside it.
    expect(response.body.data.status).toBe(PaymentStatus.PENDING);
    expect(response.body.data.isOverdue).toBe(true);
  });

  it('keeps a part-paid late payment partially paid', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100000, dueDate: '2020-01-01' });

    const response = await request(app)
      .post(`/api/payments/${payment.body.data.id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 40000 });

    expect(response.body.data.status).toBe(PaymentStatus.PARTIALLY_PAID);
    expect(response.body.data.isOverdue).toBe(true);
  });

  it('stops calling a settled payment overdue', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 50000, dueDate: '2020-01-01' });

    const response = await request(app)
      .post(`/api/payments/${payment.body.data.id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 50000 });

    expect(response.body.data.isOverdue).toBe(false);
  });

  it('filters by overdue', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    await makePayment(token, client.id, { title: 'Late', dueDate: '2020-01-01' });
    await makePayment(token, client.id, { title: 'Fine', dueDate: '2099-01-01' });

    const response = await request(app)
      .get('/api/payments')
      .query({ overdue: 'true' })
      .set(authHeader(token));

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Late');
  });
});

describe('changing what is owed', () => {
  it('keeps a trail when the amount moves', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100000 });

    await request(app)
      .patch(`/api/payments/${payment.body.data.id}`)
      .set(authHeader(token))
      .send({ amount: 120000, amountChangeReason: 'Extra scope agreed' });

    const history = await prisma.pricingHistory.findMany({
      where: { entityId: payment.body.data.id },
    });
    expect(history).toHaveLength(1);
    expect(Number(history[0]!.previousValue)).toBe(100000);
    expect(history[0]!.reason).toBe('Extra scope agreed');
  });

  it('refuses to set the amount below what has already arrived', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100000 });
    const id = payment.body.data.id;

    await request(app)
      .post(`/api/payments/${id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 60000 });

    const response = await request(app)
      .patch(`/api/payments/${id}`)
      .set(authHeader(token))
      .send({ amount: 50000 });

    expect(response.status).toBe(422);
  });

  it('unsettles a paid invoice when the amount goes up', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 50000 });
    const id = payment.body.data.id;

    await request(app)
      .post(`/api/payments/${id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 50000 });

    const raised = await request(app)
      .patch(`/api/payments/${id}`)
      .set(authHeader(token))
      .send({ amount: 80000, amountChangeReason: 'Additional work' });

    expect(raised.body.data.status).toBe(PaymentStatus.PARTIALLY_PAID);
    expect(raised.body.data.outstanding).toBe(30000);
  });

  it('refuses to cancel a payment money has arrived against', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100000 });
    const id = payment.body.data.id;

    await request(app)
      .post(`/api/payments/${id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 10000 });

    const response = await request(app)
      .post(`/api/payments/${id}/cancel`)
      .set(authHeader(token))
      .send({ reason: 'Raised twice by mistake' });

    expect(response.status).toBe(409);
  });

  it('cancels one that has had nothing paid against it', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id);

    const response = await request(app)
      .post(`/api/payments/${payment.body.data.id}/cancel`)
      .set(authHeader(token))
      .send({ reason: 'Raised twice by mistake' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(PaymentStatus.CANCELLED);
  });
});

describe('the money picture', () => {
  it('totals per currency and never mixes them', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    await makePayment(token, client.id, { amount: 100000, currency: 'INR' });
    await makePayment(token, client.id, { amount: 50000, currency: 'INR' });
    const usd = await makePayment(token, client.id, { amount: 2000, currency: 'USD' });

    await request(app)
      .post(`/api/payments/${usd.body.data.id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 500 });

    const response = await request(app).get('/api/payments/summary').set(authHeader(token));

    expect(response.body.data.billed).toEqual({ INR: 150000, USD: 2000 });
    expect(response.body.data.received).toEqual({ INR: 0, USD: 500 });
    expect(response.body.data.outstanding).toEqual({ INR: 150000, USD: 1500 });
  });

  it('leaves cancelled payments out of the totals', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const keep = await makePayment(token, client.id, { amount: 100000 });
    const drop = await makePayment(token, client.id, { amount: 999999 });

    await request(app)
      .post(`/api/payments/${drop.body.data.id}/cancel`)
      .set(authHeader(token))
      .send({ reason: 'Duplicate' });

    const response = await request(app).get('/api/payments/summary').set(authHeader(token));

    expect(response.body.data.billed.INR).toBe(100000);
    expect(keep.body.data.amount).toBe(100000);
  });

  it('ages the outstanding money by how late it is', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const daysAgo = (days: number): string =>
      new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    await makePayment(token, client.id, { title: 'Fresh', amount: 1000, dueDate: daysAgo(-10) });
    await makePayment(token, client.id, { title: 'A bit late', amount: 2000, dueDate: daysAgo(10) });
    await makePayment(token, client.id, { title: 'Very late', amount: 3000, dueDate: daysAgo(120) });

    const response = await request(app).get('/api/payments/summary').set(authHeader(token));
    const buckets = Object.fromEntries(
      response.body.data.aging.map((entry: { bucket: string; value: { INR: number } }) => [
        entry.bucket,
        entry.value.INR,
      ]),
    );

    expect(buckets['Not yet due']).toBe(1000);
    expect(buckets['1–30 days']).toBe(2000);
    expect(buckets['Over 90 days']).toBe(3000);
  });

  it('answers what a project has been billed and what is unbilled', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const project = await request(app)
      .post('/api/projects')
      .set(authHeader(token))
      .send({ clientId: client.id, name: 'Website rebuild', value: 500000, currency: 'INR' });
    const projectId = project.body.data.id;

    const payment = await makePayment(token, client.id, { amount: 200000, projectId });
    await request(app)
      .post(`/api/payments/${payment.body.data.id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 120000 });

    const response = await request(app)
      .get(`/api/payments/projects/${projectId}/position`)
      .set(authHeader(token));

    expect(response.body.data).toMatchObject({
      value: 500000,
      billed: 200000,
      received: 120000,
      outstanding: 80000,
      // The part of the project's value that has not been invoiced yet.
      unbilled: 300000,
    });
  });
});

describe('reports', () => {
  it('reports revenue by month, client and service', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const payment = await makePayment(token, client.id, { amount: 100000 });

    await request(app)
      .post(`/api/payments/${payment.body.data.id}/receipts`)
      .set(authHeader(token))
      .send({ amount: 100000 });

    const response = await request(app)
      .get('/api/reports/revenue')
      .query({ months: 6 })
      .set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.data.byMonth).toHaveLength(6);
    expect(response.body.data.totals.received.INR).toBe(100000);
    expect(response.body.data.byClient[0]).toMatchObject({ name: 'ABC Technologies' });
  });

  it('measures sales conversion against decided leads', async () => {
    const { token } = await adminSession();

    for (const [name, status] of [
      ['Won one', 'WON'],
      ['Lost one', 'LOST'],
    ] as const) {
      const lead = await request(app)
        .post('/api/leads')
        .set(authHeader(token))
        .send({ companyName: name });
      await request(app)
        .post(`/api/leads/${lead.body.data.id}/status`)
        .set(authHeader(token))
        .send({ status, ...(status === 'LOST' ? { lostReason: 'Price' } : {}) });
    }
    await request(app).post('/api/leads').set(authHeader(token)).send({ companyName: 'Still open' });

    const response = await request(app).get('/api/reports/sales').set(authHeader(token));

    expect(response.body.data.totals).toMatchObject({ leads: 3, open: 1, won: 1, lost: 1 });
    expect(response.body.data.totals.rate).toBe(50);
    expect(response.body.data.byOwner[0].leads).toBe(3);
  });

  it('measures delivery against the date that was promised', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    // Delivered long before its date.
    const onTime = await request(app).post('/api/projects').set(authHeader(token)).send({
      clientId: client.id,
      name: 'Delivered early',
      deliveryDate: '2099-01-01',
    });
    await request(app)
      .post(`/api/projects/${onTime.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: 'COMPLETED' });

    // Delivered years after its date.
    const late = await request(app).post('/api/projects').set(authHeader(token)).send({
      clientId: client.id,
      name: 'Delivered late',
      deliveryDate: '2020-01-01',
    });
    await request(app)
      .post(`/api/projects/${late.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: 'COMPLETED' });

    const response = await request(app).get('/api/reports/projects').set(authHeader(token));

    expect(response.body.data.totals.completed).toBe(2);
    expect(response.body.data.totals.onTime).toBe(1);
    expect(response.body.data.totals.late).toBe(1);
    expect(response.body.data.totals.onTimeRate).toBe(50);
    expect(response.body.data.totals.averageDaysLate).toBeGreaterThan(0);
  });

  it('reports no on-time rate at all when nothing has been delivered', async () => {
    const { token } = await adminSession();

    const response = await request(app).get('/api/reports/projects').set(authHeader(token));

    expect(response.body.data.totals.onTimeRate).toBeNull();
  });

  it('groups outstanding money by client, worst first', async () => {
    const { token } = await adminSession();
    const small = await makeClient(token, 'Small debtor');
    const large = await makeClient(token, 'Large debtor');

    await makePayment(token, small.id, { amount: 10000 });
    await makePayment(token, large.id, { amount: 90000, dueDate: '2020-01-01' });

    const response = await request(app).get('/api/reports/outstanding').set(authHeader(token));

    expect(response.body.data.byClient[0].name).toBe('Large debtor');
    expect(response.body.data.totals.outstanding.INR).toBe(100000);
    expect(response.body.data.totals.overdue.INR).toBe(90000);
    expect(response.body.data.items[0].daysLate).toBeGreaterThan(0);
  });

  it('refuses reports to an employee', async () => {
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const response = await request(app)
      .get('/api/reports/revenue')
      .set(authHeader(session.accessToken));

    expect(response.status).toBe(403);
  });
});

describe('search casing', () => {
  it('matches a payment search term regardless of case', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    await makePayment(token, client.id, { title: 'Retainer Invoice' });

    // MySQL's utf8mb4_unicode_ci matched this for free; Postgres does not.
    const response = await request(app)
      .get('/api/payments?search=retainer')
      .set(authHeader(token))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('Retainer Invoice');
  });
});
