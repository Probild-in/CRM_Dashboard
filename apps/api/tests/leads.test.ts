import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { LeadSource, LeadStatus, Priority, UserRole } from '@probild/shared';
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

/** Signs in a sales rep and returns their token, since most cases need one. */
async function salesSession() {
  const user = await createTestUser(UserRole.SALES);
  const session = await loginAs(app, user.email);
  return { user, token: session.accessToken };
}

async function createLead(token: string, overrides: Record<string, unknown> = {}) {
  const response = await request(app)
    .post('/api/leads')
    .set(authHeader(token))
    .send({ companyName: 'ABC Technologies', source: LeadSource.REFERRAL, ...overrides });
  return response;
}

describe('POST /api/leads', () => {
  it('creates a lead and gives it a sequential reference', async () => {
    const { token } = await salesSession();

    const first = await createLead(token, { companyName: 'ABC Technologies' });
    const second = await createLead(token, { companyName: 'XYZ Industries' });

    expect(first.status).toBe(201);
    expect(first.body.data.reference).toBe('LEAD-000001');
    expect(second.body.data.reference).toBe('LEAD-000002');
  });

  it('assigns the lead to its creator when no owner is given', async () => {
    const { user, token } = await salesSession();

    const response = await createLead(token);

    expect(response.body.data.assignedTo.id).toBe(user.id);
  });

  it('writes a created entry to the activity timeline', async () => {
    const { token } = await salesSession();

    const lead = await createLead(token);
    const activities = await request(app)
      .get(`/api/leads/${lead.body.data.id}/activities`)
      .set(authHeader(token));

    expect(activities.body.data).toHaveLength(1);
    expect(activities.body.data[0].type).toBe('CREATED');
  });

  it('accepts USD as readily as INR', async () => {
    const { token } = await salesSession();

    const response = await createLead(token, { currency: 'USD', expectedValue: 25000 });

    expect(response.status).toBe(201);
    expect(response.body.data.currency).toBe('USD');
    expect(response.body.data.expectedValue).toBe(25000);
  });

  it('rejects a lead with no company name', async () => {
    const { token } = await salesSession();

    const response = await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({ companyName: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('companyName');
  });

  it('refuses lead creation to an employee', async () => {
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    const response = await createLead(session.accessToken);

    expect(response.status).toBe(403);
  });
});

describe('lead visibility', () => {
  it('shows every lead to sales, whoever owns it', async () => {
    const owner = await salesSession();
    await createLead(owner.token, { companyName: 'Owned by first rep' });

    const other = await salesSession();
    const response = await request(app).get('/api/leads').set(authHeader(other.token));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('shows a project manager only the leads assigned to them', async () => {
    const sales = await salesSession();
    const manager = await createTestUser(UserRole.PROJECT_MANAGER);
    const managerSession = await loginAs(app, manager.email);

    await createLead(sales.token, { companyName: 'Not theirs' });
    await createLead(sales.token, { companyName: 'Theirs', assignedToId: manager.id });

    const response = await request(app)
      .get('/api/leads')
      .set(authHeader(managerSession.accessToken));

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].companyName).toBe('Theirs');
  });

  it('answers 404, not 403, for a lead outside the caller’s scope', async () => {
    const sales = await salesSession();
    const lead = await createLead(sales.token);

    const manager = await createTestUser(UserRole.PROJECT_MANAGER);
    const managerSession = await loginAs(app, manager.email);

    const response = await request(app)
      .get(`/api/leads/${lead.body.data.id}`)
      .set(authHeader(managerSession.accessToken));

    expect(response.status).toBe(404);
  });
});

describe('POST /api/leads/:id/status', () => {
  it('moves a lead and records the move on its timeline', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.QUALIFIED, note: 'Budget confirmed' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(LeadStatus.QUALIFIED);

    const activities = await request(app)
      .get(`/api/leads/${lead.body.data.id}/activities`)
      .set(authHeader(token));
    const move = activities.body.data.find(
      (entry: { type: string }) => entry.type === 'STATUS_CHANGE',
    );
    expect(move.fromValue).toBe(LeadStatus.NEW);
    expect(move.toValue).toBe(LeadStatus.QUALIFIED);
  });

  it('requires a reason before a lead can be marked lost', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const withoutReason = await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.LOST });

    expect(withoutReason.status).toBe(400);

    const withReason = await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.LOST, lostReason: 'Went with a cheaper agency' });

    expect(withReason.status).toBe(200);
    expect(withReason.body.data.lostReason).toBe('Went with a cheaper agency');
  });

  it('clears the follow-up once a lead is closed', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token, { nextFollowUpAt: '2026-08-25T05:30:00.000Z' });

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.WON });

    expect(response.body.data.nextFollowUpAt).toBeNull();
  });

  it('rejects a move to the stage the lead is already at', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.NEW });

    expect(response.status).toBe(422);
  });

  it('records the move in the audit trail', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.CONTACTED });

    const entries = await prisma.auditLog.findMany({
      where: { entityId: lead.body.data.id, action: 'STATUS_CHANGED' },
    });
    expect(entries).toHaveLength(1);
  });
});

describe('PATCH /api/leads/:id', () => {
  it('keeps a trail whenever the expected value changes', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token, { expectedValue: 120000, currency: 'INR' });

    await request(app)
      .patch(`/api/leads/${lead.body.data.id}`)
      .set(authHeader(token))
      .send({ expectedValue: 110000 });
    await request(app)
      .patch(`/api/leads/${lead.body.data.id}`)
      .set(authHeader(token))
      .send({ expectedValue: 100000 });

    const history = await prisma.pricingHistory.findMany({
      where: { entityId: lead.body.data.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(history).toHaveLength(2);
    expect(Number(history[0]!.previousValue)).toBe(120000);
    expect(Number(history[0]!.newValue)).toBe(110000);
    expect(Number(history[1]!.newValue)).toBe(100000);
  });

  it('sends status changes through the status action instead', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .patch(`/api/leads/${lead.body.data.id}`)
      .set(authHeader(token))
      .send({ status: LeadStatus.WON });

    expect(response.status).toBe(422);
  });

  it('records a scheduled follow-up on the timeline', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    await request(app)
      .patch(`/api/leads/${lead.body.data.id}`)
      .set(authHeader(token))
      .send({ nextFollowUpAt: '2026-08-25T05:30:00.000Z' });

    const activities = await request(app)
      .get(`/api/leads/${lead.body.data.id}/activities`)
      .set(authHeader(token));

    expect(
      activities.body.data.some((entry: { type: string }) => entry.type === 'FOLLOW_UP_SET'),
    ).toBe(true);
  });
});

describe('POST /api/leads/:id/activities', () => {
  it('logs a call and moves the last-contacted date', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/activities`)
      .set(authHeader(token))
      .send({ type: 'CALL', title: 'Intro call', body: 'Walked through the brief' });

    expect(response.status).toBe(201);
    expect(response.body.data.lastContactedAt).not.toBeNull();
  });

  it('sets the next follow-up in the same step', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/activities`)
      .set(authHeader(token))
      .send({
        type: 'CALL',
        title: 'Intro call',
        nextFollowUpAt: '2026-09-01T05:30:00.000Z',
      });

    expect(response.body.data.nextFollowUpAt).toBe('2026-09-01T05:30:00.000Z');
  });

  it('leaves the last-contacted date alone for a note', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/activities`)
      .set(authHeader(token))
      .send({ type: 'NOTE', title: 'Internal note' });

    expect(response.body.data.lastContactedAt).toBeNull();
  });

  it('refuses an activity type the system writes for itself', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/activities`)
      .set(authHeader(token))
      .send({ type: 'STATUS_CHANGE', title: 'Faked move' });

    expect(response.status).toBe(400);
  });
});

describe('filters and derived state', () => {
  it('marks an open lead with a past follow-up as overdue', async () => {
    const { token } = await salesSession();
    await createLead(token, { nextFollowUpAt: '2020-01-01T00:00:00.000Z' });

    const response = await request(app)
      .get('/api/leads')
      .query({ followUpOverdue: 'true' })
      .set(authHeader(token));

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].isFollowUpOverdue).toBe(true);
  });

  it('stops calling a follow-up overdue once the lead is closed', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token, { nextFollowUpAt: '2020-01-01T00:00:00.000Z' });

    await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.LOST, lostReason: 'No budget' });

    const response = await request(app).get('/api/leads').set(authHeader(token));
    expect(response.body.data[0].isFollowUpOverdue).toBe(false);
  });

  it('filters by status, priority and search term', async () => {
    const { token } = await salesSession();
    await createLead(token, { companyName: 'Acme Steel', priority: Priority.URGENT });
    await createLead(token, { companyName: 'Beta Foods', priority: Priority.LOW });

    const byPriority = await request(app)
      .get('/api/leads')
      .query({ priority: Priority.URGENT })
      .set(authHeader(token));
    expect(byPriority.body.data).toHaveLength(1);

    const bySearch = await request(app)
      .get('/api/leads')
      .query({ search: 'Beta' })
      .set(authHeader(token));
    expect(bySearch.body.data).toHaveLength(1);
    expect(bySearch.body.data[0].companyName).toBe('Beta Foods');
  });

  it('paginates', async () => {
    const { token } = await salesSession();
    for (let index = 0; index < 5; index += 1) {
      await createLead(token, { companyName: `Company ${index}` });
    }

    const response = await request(app)
      .get('/api/leads')
      .query({ pageSize: 2, page: 2 })
      .set(authHeader(token));

    expect(response.body.data).toHaveLength(2);
    expect(response.body.meta.total).toBe(5);
    expect(response.body.meta.totalPages).toBe(3);
    expect(response.body.meta.hasNextPage).toBe(true);
  });
});

describe('GET /api/leads/pipeline', () => {
  it('groups leads by stage and totals value per currency', async () => {
    const { token } = await salesSession();
    await createLead(token, { companyName: 'INR one', expectedValue: 100000, currency: 'INR' });
    await createLead(token, { companyName: 'INR two', expectedValue: 50000, currency: 'INR' });
    await createLead(token, { companyName: 'USD one', expectedValue: 2000, currency: 'USD' });

    const response = await request(app).get('/api/leads/pipeline').set(authHeader(token));

    expect(response.status).toBe(200);
    const newStage = response.body.data.stages.find(
      (stage: { status: string }) => stage.status === LeadStatus.NEW,
    );
    expect(newStage.count).toBe(3);
    // The two currencies are reported side by side, never summed together.
    expect(newStage.value.INR).toBe(150000);
    expect(newStage.value.USD).toBe(2000);
  });

  it('reports won and lost separately from the board columns', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token, { expectedValue: 90000 });

    await request(app)
      .post(`/api/leads/${lead.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: LeadStatus.WON });

    const response = await request(app).get('/api/leads/pipeline').set(authHeader(token));

    expect(response.body.data.closed.won.count).toBe(1);
    expect(response.body.data.closed.won.value.INR).toBe(90000);
    expect(
      response.body.data.stages.every((stage: { count: number }) => stage.count === 0),
    ).toBe(true);
  });
});

describe('assignment and deletion', () => {
  it('reassigns a lead and records who now owns it', async () => {
    const { token } = await salesSession();
    const colleague = await createTestUser(UserRole.EMPLOYEE);
    const lead = await createLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/assign`)
      .set(authHeader(token))
      .send({ assignedToId: colleague.id });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedTo.id).toBe(colleague.id);
  });

  it('refuses assignment to someone who no longer exists', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .post(`/api/leads/${lead.body.data.id}/assign`)
      .set(authHeader(token))
      .send({ assignedToId: '11111111-1111-4111-8111-111111111111' });

    expect(response.status).toBe(422);
  });

  it('soft-deletes so the history survives', async () => {
    const admin = await createTestUser(UserRole.SUPER_ADMIN);
    const session = await loginAs(app, admin.email);
    const lead = await createLead(session.accessToken);

    const response = await request(app)
      .delete(`/api/leads/${lead.body.data.id}`)
      .set(authHeader(session.accessToken));

    expect(response.status).toBe(204);

    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.body.data.id } });
    expect(stored.deletedAt).not.toBeNull();

    const list = await request(app).get('/api/leads').set(authHeader(session.accessToken));
    expect(list.body.data).toHaveLength(0);
  });

  it('refuses deletion to sales, who may not delete leads', async () => {
    const { token } = await salesSession();
    const lead = await createLead(token);

    const response = await request(app)
      .delete(`/api/leads/${lead.body.data.id}`)
      .set(authHeader(token));

    expect(response.status).toBe(403);
  });
});

describe('GET /api/search', () => {
  it('finds a lead by company name and by reference', async () => {
    const { token } = await salesSession();
    await createLead(token, { companyName: 'Meridian Logistics' });

    const byName = await request(app)
      .get('/api/search')
      .query({ q: 'Meridian' })
      .set(authHeader(token));
    const byReference = await request(app)
      .get('/api/search')
      .query({ q: 'LEAD-000001' })
      .set(authHeader(token));

    expect(byName.body.data.some((hit: { title: string }) => hit.title === 'Meridian Logistics')).toBe(
      true,
    );
    expect(byReference.body.data[0].reference).toBe('LEAD-000001');
  });

  it('does not surface leads the caller cannot read', async () => {
    const sales = await salesSession();
    await createLead(sales.token, { companyName: 'Meridian Logistics' });

    const manager = await createTestUser(UserRole.PROJECT_MANAGER);
    const managerSession = await loginAs(app, manager.email);

    const response = await request(app)
      .get('/api/search')
      .query({ q: 'Meridian' })
      .set(authHeader(managerSession.accessToken));

    expect(response.body.data.some((hit: { entityType: string }) => hit.entityType === 'LEAD')).toBe(
      false,
    );
  });

  it('needs at least two characters', async () => {
    const { token } = await salesSession();

    const response = await request(app).get('/api/search').query({ q: 'a' }).set(authHeader(token));

    expect(response.status).toBe(400);
  });
});

describe('search casing', () => {
  it('matches a lead search term regardless of case', async () => {
    const { token } = await salesSession();
    await createLead(token, { companyName: 'Zenith Manufacturing' });

    // MySQL's utf8mb4_unicode_ci matched this for free; Postgres does not.
    const response = await request(app)
      .get('/api/leads?search=zenith')
      .set(authHeader(token))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].companyName).toBe('Zenith Manufacturing');
  });
});
