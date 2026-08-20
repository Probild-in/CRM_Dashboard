import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { LeadStatus, UserRole } from '@probild/shared';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { dayRange, monthRange, recentMonths } from '../src/lib/time.js';
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

/** A UTC instant that is late evening in Kolkata but still the previous day in UTC. */
const LATE_EVENING_IST = new Date('2026-08-18T18:30:00.000Z'); // 2026-08-19 00:00 IST

describe('timezone boundaries', () => {
  it('bounds the day by the reader’s wall clock, not UTC', () => {
    const kolkata = dayRange(new Date('2026-08-18T20:00:00.000Z'), 'Asia/Kolkata');
    // 20:00 UTC is 01:30 on the 19th in Kolkata, so the day runs 18:30→18:29:59 UTC.
    expect(kolkata.start.toISOString()).toBe('2026-08-18T18:30:00.000Z');
    expect(kolkata.end.toISOString()).toBe('2026-08-19T18:29:59.999Z');

    const utc = dayRange(new Date('2026-08-18T20:00:00.000Z'), 'UTC');
    expect(utc.start.toISOString()).toBe('2026-08-18T00:00:00.000Z');
  });

  it('rolls the Kolkata day over at 18:30 UTC', () => {
    const before = dayRange(new Date('2026-08-18T18:29:00.000Z'), 'Asia/Kolkata');
    const after = dayRange(LATE_EVENING_IST, 'Asia/Kolkata');
    expect(before.start.toISOString()).toBe('2026-08-17T18:30:00.000Z');
    expect(after.start.toISOString()).toBe('2026-08-18T18:30:00.000Z');
  });

  it('bounds the month by the reader’s wall clock', () => {
    const range = monthRange(new Date('2026-08-18T12:00:00.000Z'), 'Asia/Kolkata');
    expect(range.start.toISOString()).toBe('2026-07-31T18:30:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-31T18:29:59.999Z');
  });

  it('walks back over a year boundary', () => {
    const months = recentMonths(new Date('2026-02-10T12:00:00.000Z'), 'Asia/Kolkata', 4);
    expect(months.map((month) => month.key)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(months.map((month) => month.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb']);
  });

  it('handles a zone that observes daylight saving', () => {
    const summer = dayRange(new Date('2026-07-15T12:00:00.000Z'), 'Europe/London');
    const winter = dayRange(new Date('2026-01-15T12:00:00.000Z'), 'Europe/London');
    expect(summer.start.toISOString()).toBe('2026-07-14T23:00:00.000Z');
    expect(winter.start.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('GET /api/dashboard', () => {
  it('answers with every section, even when nothing is happening', async () => {
    const { token } = await adminSession();

    const response = await request(app).get('/api/dashboard').set(authHeader(token));

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.kpis.totalLeads).toBe(0);
    expect(data.today).toEqual({ followUps: [], tasks: [], meetings: [] });
    expect(data.overdue.tasks).toEqual([]);
    expect(data.upcoming.projects).toEqual([]);
    expect(data.kpis.pipelineValue).toEqual({ INR: 0, USD: 0 });
  });

  it('counts leads and totals the pipeline per currency', async () => {
    const { token } = await adminSession();

    for (const [value, currency] of [
      [100000, 'INR'],
      [50000, 'INR'],
      [2000, 'USD'],
    ] as const) {
      await request(app)
        .post('/api/leads')
        .set(authHeader(token))
        .send({ companyName: `Lead ${value}`, expectedValue: value, currency });
    }

    const response = await request(app).get('/api/dashboard').set(authHeader(token));

    expect(response.body.data.kpis.totalLeads).toBe(3);
    expect(response.body.data.kpis.activeLeads).toBe(3);
    // Two currencies, reported side by side.
    expect(response.body.data.kpis.pipelineValue).toEqual({ INR: 150000, USD: 2000 });
  });

  it('drops a won lead out of the pipeline total', async () => {
    const { token } = await adminSession();
    const lead = await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({ companyName: 'Closing', expectedValue: 400000, currency: 'INR' });

    await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.WON });

    const response = await request(app).get('/api/dashboard').set(authHeader(token));

    expect(response.body.data.kpis.activeLeads).toBe(0);
    expect(response.body.data.kpis.wonLeads).toBe(1);
    expect(response.body.data.kpis.pipelineValue.INR).toBe(0);
  });

  it('separates what is late from what is coming', async () => {
    const { token } = await adminSession();

    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Late one', dueAt: '2020-01-01T12:00:00.000Z' });
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Far future', dueAt: '2099-01-01T12:00:00.000Z' });

    const response = await request(app).get('/api/dashboard').set(authHeader(token));

    expect(response.body.data.kpis.overdueTasks).toBe(1);
    expect(response.body.data.overdue.tasks).toHaveLength(1);
    expect(response.body.data.overdue.tasks[0].title).toBe('Late one');
    // A deadline years out is not "this week".
    expect(response.body.data.upcoming.tasks).toHaveLength(0);
  });

  it('leaves a completed task out of the overdue list', async () => {
    const { token } = await adminSession();
    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Done, but late', dueAt: '2020-01-01T12:00:00.000Z' });

    await request(app)
      .post(`/api/tasks/${task.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: 'COMPLETED' });

    const response = await request(app).get('/api/dashboard').set(authHeader(token));

    expect(response.body.data.kpis.overdueTasks).toBe(0);
    expect(response.body.data.overdue.tasks).toHaveLength(0);
  });

  it('lists an overdue follow-up against its lead', async () => {
    const { token } = await adminSession();
    await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({ companyName: 'Needs chasing', nextFollowUpAt: '2020-01-01T06:00:00.000Z' });

    const response = await request(app).get('/api/dashboard').set(authHeader(token));

    expect(response.body.data.overdue.followUps).toHaveLength(1);
    expect(response.body.data.overdue.followUps[0].companyName).toBe('Needs chasing');
  });

  it('totals outstanding payments rather than their full amounts', async () => {
    const { token } = await adminSession();
    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'Paying client' });

    await prisma.payment.create({
      data: {
        reference: 'PAY-000001',
        clientId: client.body.data.id,
        title: 'Advance',
        amount: 100000,
        paidAmount: 40000,
        currency: 'INR',
        status: 'PARTIALLY_PAID',
      },
    });

    const response = await request(app).get('/api/dashboard').set(authHeader(token));

    // 100,000 billed less 40,000 received leaves 60,000 outstanding.
    expect(response.body.data.kpis.pendingPayments.INR).toBe(60000);
  });

  it('shows an employee only their own work', async () => {
    const admin = await adminSession();
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    await request(app)
      .post('/api/tasks')
      .set(authHeader(admin.token))
      .send({ title: 'Someone else’s', dueAt: '2020-01-01T12:00:00.000Z' });
    await request(app)
      .post('/api/tasks')
      .set(authHeader(admin.token))
      .send({ title: 'Theirs', dueAt: '2020-01-01T12:00:00.000Z', assigneeId: employee.id });

    const response = await request(app)
      .get('/api/dashboard')
      .set(authHeader(session.accessToken));

    expect(response.body.data.kpis.overdueTasks).toBe(1);
    expect(response.body.data.overdue.tasks[0].title).toBe('Theirs');
  });
});

describe('GET /api/dashboard/sales', () => {
  it('reports the pipeline stage by stage', async () => {
    const { token } = await adminSession();

    const first = await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({ companyName: 'Stage test', expectedValue: 200000, currency: 'INR' });
    await request(app)
      .post(`/api/leads/${first.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.NEGOTIATION });

    await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({ companyName: 'Fresh', expectedValue: 50000, currency: 'INR' });

    const response = await request(app).get('/api/dashboard/sales').set(authHeader(token));

    const negotiation = response.body.data.pipeline.find(
      (stage: { status: string }) => stage.status === 'NEGOTIATION',
    );
    expect(negotiation.count).toBe(1);
    expect(negotiation.value.INR).toBe(200000);
  });

  it('measures conversion against decided leads, not open ones', async () => {
    const { token } = await adminSession();

    for (const [name, status] of [
      ['Won one', LeadStatus.WON],
      ['Lost one', LeadStatus.LOST],
      ['Lost two', LeadStatus.LOST],
    ] as const) {
      const lead = await request(app)
        .post('/api/leads')
        .set(authHeader(token))
        .send({ companyName: name });
      await request(app)
        .post(`/api/leads/${lead.body.data.id}/status`)
        .set(authHeader(token))
        .send({ status, ...(status === LeadStatus.LOST ? { lostReason: 'Price' } : {}) });
    }
    // Two still open — they must not count against the rate.
    await request(app).post('/api/leads').set(authHeader(token)).send({ companyName: 'Open one' });
    await request(app).post('/api/leads').set(authHeader(token)).send({ companyName: 'Open two' });

    const response = await request(app).get('/api/dashboard/sales').set(authHeader(token));

    expect(response.body.data.conversion).toMatchObject({ won: 1, lost: 2, decided: 3 });
    expect(response.body.data.conversion.rate).toBeCloseTo(33.3, 1);
  });

  it('reports no rate at all rather than zero when nothing has been decided', async () => {
    const { token } = await adminSession();
    await request(app).post('/api/leads').set(authHeader(token)).send({ companyName: 'Open' });

    const response = await request(app).get('/api/dashboard/sales').set(authHeader(token));

    expect(response.body.data.conversion.rate).toBeNull();
  });

  it('breaks leads down by where they came from', async () => {
    const { token } = await adminSession();
    for (const source of ['REFERRAL', 'REFERRAL', 'COLD_EMAIL']) {
      await request(app)
        .post('/api/leads')
        .set(authHeader(token))
        .send({ companyName: `From ${source}`, source });
    }

    const response = await request(app).get('/api/dashboard/sales').set(authHeader(token));

    expect(response.body.data.sources[0]).toMatchObject({ source: 'REFERRAL', total: 2 });
  });

  it('returns one entry per month in the requested window', async () => {
    const { token } = await adminSession();

    const response = await request(app)
      .get('/api/dashboard/sales')
      .query({ months: 6 })
      .set(authHeader(token));

    expect(response.body.data.revenueByMonth).toHaveLength(6);
    expect(response.body.data.revenueByMonth[0].won).toEqual({ INR: 0, USD: 0 });
  });
});

describe('GET /api/dashboard/delivery', () => {
  it('averages completion across open projects only', async () => {
    const { token } = await adminSession();
    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'Delivery client' });

    const first = await request(app)
      .post('/api/projects')
      .set(authHeader(token))
      .send({ clientId: client.body.data.id, name: 'Half done', status: 'ACTIVE' });
    await request(app)
      .post(`/api/projects/${first.body.data.id}/milestones`)
      .set(authHeader(token))
      .send({ name: 'Stage', completionPercent: 50 });

    const second = await request(app)
      .post('/api/projects')
      .set(authHeader(token))
      .send({ clientId: client.body.data.id, name: 'Just started', status: 'ACTIVE' });
    await request(app)
      .post(`/api/projects/${second.body.data.id}/milestones`)
      .set(authHeader(token))
      .send({ name: 'Stage', completionPercent: 10 });

    const response = await request(app).get('/api/dashboard/delivery').set(authHeader(token));

    expect(response.body.data.averageCompletion).toBe(30);
  });

  it('lists delayed projects and leaves completed ones out', async () => {
    const { token } = await adminSession();
    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'Delivery client' });

    await request(app).post('/api/projects').set(authHeader(token)).send({
      clientId: client.body.data.id,
      name: 'Late one',
      status: 'ACTIVE',
      deliveryDate: '2020-01-01',
    });

    const finished = await request(app).post('/api/projects').set(authHeader(token)).send({
      clientId: client.body.data.id,
      name: 'Late but delivered',
      status: 'ACTIVE',
      deliveryDate: '2020-01-01',
    });
    await request(app)
      .post(`/api/projects/${finished.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: 'COMPLETED' });

    const response = await request(app).get('/api/dashboard/delivery').set(authHeader(token));

    expect(response.body.data.delayed).toHaveLength(1);
    expect(response.body.data.delayed[0].name).toBe('Late one');
  });

  it('shows who the open work sits with', async () => {
    const { token } = await adminSession();
    const colleague = await createTestUser(UserRole.EMPLOYEE);

    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Assigned', assigneeId: colleague.id });
    await request(app).post('/api/tasks').set(authHeader(token)).send({ title: 'Nobody yet' });

    const response = await request(app).get('/api/dashboard/delivery').set(authHeader(token));

    const named = response.body.data.workload.find(
      (entry: { userId: string | null }) => entry.userId === colleague.id,
    );
    const unassigned = response.body.data.workload.find(
      (entry: { userId: string | null }) => entry.userId === null,
    );
    expect(named.openTasks).toBe(1);
    expect(unassigned.name).toBe('Unassigned');
  });
});
