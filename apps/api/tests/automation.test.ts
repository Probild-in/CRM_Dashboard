import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { AutomationRule, EntityType, Priority, UserRole } from '@probild/shared';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { run } from '../src/modules/automation/engine.js';
import { dedupeKeyFor, evaluate, thresholdFor, type WatchItem } from '../src/modules/automation/rules.js';
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

/** The worked example from the brief: a task due 22 August at 5:00 PM IST. */
const DUE = new Date('2026-08-22T11:30:00.000Z');

function taskItem(overrides: Partial<WatchItem> = {}): WatchItem {
  return {
    entityType: EntityType.TASK,
    entityId: '11111111-1111-4111-8111-111111111111',
    dueAt: DUE,
    recipientIds: ['22222222-2222-4222-8222-222222222222'],
    timezone: 'Asia/Kolkata',
    title: 'Create Homepage',
    context: 'Website rebuild',
    actionUrl: '/tasks',
    priority: Priority.MEDIUM,
    ...overrides,
  };
}

/** The single rule that speaks at a given moment. */
function speaking(item: WatchItem, now: Date): AutomationRule | null {
  const outcome = evaluate(item, now).find((entry) => !entry.suppressed);
  return outcome?.rule ?? null;
}

describe('the sequence from the brief', () => {
  const item = taskItem();

  it('says nothing four days out', () => {
    expect(speaking(item, new Date('2026-08-18T11:30:00.000Z'))).toBeNull();
  });

  it('says "due tomorrow" on the 21st', () => {
    // 21 Aug, 10:00 IST
    expect(speaking(item, new Date('2026-08-21T04:30:00.000Z'))).toBe(
      AutomationRule.DUE_TOMORROW,
    );
  });

  it('says "due today" on the morning of the 22nd', () => {
    // 22 Aug, 09:00 IST
    expect(speaking(item, new Date('2026-08-22T03:30:00.000Z'))).toBe(AutomationRule.DUE_TODAY);
  });

  it('says "due in two hours" at 3:00 PM', () => {
    // 22 Aug, 15:00 IST
    expect(speaking(item, new Date('2026-08-22T09:30:00.000Z'))).toBe(
      AutomationRule.DUE_IN_2_HOURS,
    );
  });

  it('says "due now" at 5:00 PM', () => {
    expect(speaking(item, DUE)).toBe(AutomationRule.DUE_NOW);
  });

  it('says "overdue" after 5:00 PM', () => {
    expect(speaking(item, new Date('2026-08-22T11:35:00.000Z'))).toBe(AutomationRule.OVERDUE);
  });
});

describe('rule evaluation', () => {
  it('bounds "tomorrow" and "today" by the recipient’s wall clock', () => {
    const item = taskItem();

    // The Kolkata day containing the deadline starts at 18:30 UTC the day before.
    expect(thresholdFor(AutomationRule.DUE_TODAY, item).toISOString()).toBe(
      '2026-08-21T18:30:00.000Z',
    );
    expect(thresholdFor(AutomationRule.DUE_TOMORROW, item).toISOString()).toBe(
      '2026-08-20T18:30:00.000Z',
    );
  });

  it('moves those thresholds with the reader’s zone', () => {
    const utc = taskItem({ timezone: 'UTC' });
    expect(thresholdFor(AutomationRule.DUE_TODAY, utc).toISOString()).toBe(
      '2026-08-22T00:00:00.000Z',
    );
  });

  it('lets exactly one rule speak, whatever else is ripe', () => {
    // A task created an hour before its deadline: four rules are ripe at once.
    const outcomes = evaluate(taskItem(), new Date('2026-08-22T10:30:00.000Z'));

    expect(outcomes.length).toBeGreaterThan(1);
    expect(outcomes.filter((outcome) => !outcome.suppressed)).toHaveLength(1);
    expect(outcomes[0]!.rule).toBe(AutomationRule.DUE_IN_2_HOURS);
    expect(outcomes.slice(1).every((outcome) => outcome.suppressed)).toBe(true);
  });

  it('applies only the rules that make sense for the record', () => {
    // A meeting is never "overdue" — it happened or it did not.
    const meeting = taskItem({ entityType: EntityType.MEETING });
    const rules = evaluate(meeting, new Date('2026-08-25T00:00:00.000Z')).map((o) => o.rule);
    expect(rules).not.toContain(AutomationRule.OVERDUE);

    // A quotation expires rather than going overdue.
    const quotation = taskItem({ entityType: EntityType.QUOTATION });
    const quotationRules = evaluate(quotation, new Date('2026-08-25T00:00:00.000Z')).map(
      (o) => o.rule,
    );
    expect(quotationRules).toContain(AutomationRule.EXPIRED);
    expect(quotationRules).not.toContain(AutomationRule.OVERDUE);
  });

  it('keys a reminder to the deadline it announced', () => {
    const item = taskItem();
    const moved = taskItem({ dueAt: new Date('2026-08-25T11:30:00.000Z') });

    expect(dedupeKeyFor(item, AutomationRule.DUE_TOMORROW)).toBe(
      dedupeKeyFor(taskItem(), AutomationRule.DUE_TOMORROW),
    );
    // A moved deadline is a different reminder, and legitimately fires again.
    expect(dedupeKeyFor(moved, AutomationRule.DUE_TOMORROW)).not.toBe(
      dedupeKeyFor(item, AutomationRule.DUE_TOMORROW),
    );
  });
});

/* ------------------------------------------------------------------ */

async function adminSession() {
  const user = await createTestUser(UserRole.SUPER_ADMIN);
  const session = await loginAs(app, user.email);
  return { user, token: session.accessToken };
}

describe('running the engine', () => {
  it('notifies the assignee once, however many times it runs', async () => {
    const { user, token } = await adminSession();

    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Create Homepage', dueAt: DUE.toISOString(), assigneeId: user.id });

    const first = await run(new Date('2026-08-22T11:35:00.000Z'));
    expect(first.notified).toBe(1);

    // Three more scans at the same instant: the ledger already holds the key.
    const second = await run(new Date('2026-08-22T11:36:00.000Z'));
    const third = await run(new Date('2026-08-22T11:40:00.000Z'));
    expect(second.notified).toBe(0);
    expect(third.notified).toBe(0);
    expect(second.alreadyDone).toBeGreaterThan(0);

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it('survives two workers scanning at the same instant', async () => {
    const { user, token } = await adminSession();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Race me', dueAt: DUE.toISOString(), assigneeId: user.id });

    // The unique index on the dedupe key is what decides, not a read-then-write.
    const now = new Date('2026-08-22T11:35:00.000Z');
    const results = await Promise.all([run(now), run(now), run(now)]);

    const notified = results.reduce((sum, result) => sum + result.notified, 0);
    expect(notified).toBe(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('records the moot rules so they never surface later as news', async () => {
    const { user, token } = await adminSession();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Late arrival', dueAt: DUE.toISOString(), assigneeId: user.id });

    // First scan an hour before the deadline: only the two-hour warning speaks.
    await run(new Date('2026-08-22T10:30:00.000Z'));
    expect(await prisma.notification.count()).toBe(1);

    const suppressed = await prisma.automationExecution.findMany({
      where: { notificationCount: 0 },
      select: { rule: true },
    });
    expect(suppressed.map((entry) => entry.rule)).toEqual(
      expect.arrayContaining([AutomationRule.DUE_TODAY, AutomationRule.DUE_TOMORROW]),
    );

    // A later scan must not resurrect them.
    const next = await run(new Date('2026-08-22T10:45:00.000Z'));
    expect(next.notified).toBe(0);
  });

  it('announces a moved deadline again', async () => {
    const { user, token } = await adminSession();
    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Slipping', dueAt: DUE.toISOString(), assigneeId: user.id });

    await run(new Date('2026-08-22T11:35:00.000Z'));
    expect(await prisma.notification.count()).toBe(1);

    await request(app)
      .patch(`/api/tasks/${task.body.data.id}`)
      .set(authHeader(token))
      .send({ dueAt: '2026-08-29T11:30:00.000Z' });

    await run(new Date('2026-08-29T11:35:00.000Z'));
    expect(await prisma.notification.count()).toBe(2);
  });

  it('stops reminding once the work is done', async () => {
    const { user, token } = await adminSession();
    const task = await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Finished early', dueAt: DUE.toISOString(), assigneeId: user.id });

    await request(app)
      .post(`/api/tasks/${task.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: 'COMPLETED' });

    const summary = await run(new Date('2026-08-22T11:35:00.000Z'));

    expect(summary.watched).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('ignores deadlines older than the scan window', async () => {
    const { user, token } = await adminSession();

    // Years overdue. Reminding anyone now would be noise, and a first
    // deployment must not blast the team about everything ever missed.
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Ancient history', dueAt: '2020-01-01T00:00:00.000Z', assigneeId: user.id });

    const summary = await run();

    expect(summary.watched).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('says nothing about a task nobody owns', async () => {
    const { token } = await adminSession();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Unassigned', dueAt: DUE.toISOString() });

    const summary = await run(new Date('2026-08-22T11:35:00.000Z'));
    expect(summary.watched).toBe(0);
  });

  it('sends the follow-up reminder to the lead’s owner and to nobody else', async () => {
    const { user, token } = await adminSession();
    const colleague = await createTestUser(UserRole.SALES);

    await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({
        companyName: 'ABC Technologies',
        assignedToId: colleague.id,
        nextFollowUpAt: DUE.toISOString(),
      });

    await run(new Date('2026-08-22T11:35:00.000Z'));

    expect(await prisma.notification.count({ where: { userId: colleague.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });

  it('tells everyone expected at a meeting', async () => {
    const { user, token } = await adminSession();
    const colleague = await createTestUser(UserRole.SALES);
    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'ABC Technologies' });

    await request(app)
      .post('/api/meetings')
      .set(authHeader(token))
      .send({
        title: 'Kick-off call',
        clientId: client.body.data.id,
        startsAt: DUE.toISOString(),
        endsAt: new Date(DUE.getTime() + 3_600_000).toISOString(),
        attendees: [{ userId: colleague.id }],
      });

    // Two hours before it starts.
    await run(new Date('2026-08-22T09:35:00.000Z'));

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: colleague.id } })).toBe(1);
  });

  it('expires a quotation whose validity has passed', async () => {
    const { token } = await adminSession();
    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'ABC Technologies' });

    const quotation = await request(app)
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        title: 'Website build',
        clientId: client.body.data.id,
        issueDate: '2020-01-01',
        validUntil: '2020-01-15',
        items: [{ description: 'Build', quantity: 1, unitPrice: 100000, discountPercent: 0 }],
      });

    const summary = await run();

    expect(summary.quotationsExpired).toBe(1);
    const stored = await prisma.quotation.findUniqueOrThrow({
      where: { id: quotation.body.data.id },
    });
    expect(stored.status).toBe('EXPIRED');
  });

  it('leaves an accepted quotation alone however old it is', async () => {
    const { token } = await adminSession();
    const client = await request(app)
      .post('/api/clients')
      .set(authHeader(token))
      .send({ companyName: 'ABC Technologies' });

    const quotation = await request(app)
      .post('/api/quotations')
      .set(authHeader(token))
      .send({
        title: 'Website build',
        clientId: client.body.data.id,
        issueDate: '2020-01-01',
        validUntil: '2020-01-15',
        items: [{ description: 'Build', quantity: 1, unitPrice: 100000, discountPercent: 0 }],
      });
    const id = quotation.body.data.id;
    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'SENT' });
    await request(app).post(`/api/quotations/${id}/status`).set(authHeader(token)).send({ status: 'ACCEPTED' });

    await run();

    const stored = await prisma.quotation.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe('ACCEPTED');
  });

  it('marks a late thing urgent whatever the record says', async () => {
    const { user, token } = await adminSession();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({
        title: 'Low priority, very late',
        dueAt: DUE.toISOString(),
        assigneeId: user.id,
        priority: Priority.LOW,
      });

    await run(new Date('2026-08-22T11:35:00.000Z'));

    const notification = await prisma.notification.findFirstOrThrow();
    expect(notification.priority).toBe(Priority.URGENT);
    expect(notification.message).toContain('passed its deadline');
  });
});

describe('notification centre', () => {
  it('counts and clears what is unread', async () => {
    const { user, token } = await adminSession();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Reminder me', dueAt: DUE.toISOString(), assigneeId: user.id });
    await run(new Date('2026-08-22T11:35:00.000Z'));

    const before = await request(app)
      .get('/api/notifications/unread-count')
      .set(authHeader(token));
    expect(before.body.data.count).toBe(1);

    const list = await request(app).get('/api/notifications').set(authHeader(token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].actionUrl).toBe('/tasks');

    await request(app)
      .post(`/api/notifications/${list.body.data[0].id}/read`)
      .set(authHeader(token));

    const after = await request(app).get('/api/notifications/unread-count').set(authHeader(token));
    expect(after.body.data.count).toBe(0);
  });

  it('shows a person only their own notifications', async () => {
    const admin = await adminSession();
    const colleague = await createTestUser(UserRole.SALES);
    const session = await loginAs(app, colleague.email);

    await request(app)
      .post('/api/tasks')
      .set(authHeader(admin.token))
      .send({ title: 'Mine alone', dueAt: DUE.toISOString(), assigneeId: admin.user.id });
    await run(new Date('2026-08-22T11:35:00.000Z'));

    const theirs = await request(app)
      .get('/api/notifications')
      .set(authHeader(session.accessToken));

    expect(theirs.body.data).toHaveLength(0);
  });

  it('marks everything read at once', async () => {
    const { user, token } = await adminSession();
    for (const [title, due] of [
      ['One', '2026-08-22T11:30:00.000Z'],
      ['Two', '2026-08-23T11:30:00.000Z'],
    ] as const) {
      await request(app)
        .post('/api/tasks')
        .set(authHeader(token))
        .send({ title, dueAt: due, assigneeId: user.id });
    }
    await run(new Date('2026-08-23T11:35:00.000Z'));

    const marked = await request(app).post('/api/notifications/read-all').set(authHeader(token));
    expect(marked.body.data.marked).toBeGreaterThan(0);

    const after = await request(app).get('/api/notifications/unread-count').set(authHeader(token));
    expect(after.body.data.count).toBe(0);
  });
});

describe('the engine is inspectable', () => {
  it('lets a super admin run a scan on demand', async () => {
    const { user, token } = await adminSession();
    // An hour ago, so it falls inside the scan window against the real clock.
    const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Run me', dueAt: anHourAgo, assigneeId: user.id });

    const response = await request(app).post('/api/automation/run').set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.data.notified).toBe(1);
  });

  it('refuses a manual run to anyone else', async () => {
    const sales = await createTestUser(UserRole.SALES);
    const session = await loginAs(app, sales.email);

    const response = await request(app)
      .post('/api/automation/run')
      .set(authHeader(session.accessToken));

    expect(response.status).toBe(403);
  });

  it('exposes the ledger so a missing reminder can be explained', async () => {
    const { user, token } = await adminSession();
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({ title: 'Traceable', dueAt: DUE.toISOString(), assigneeId: user.id });
    await run(new Date('2026-08-22T11:35:00.000Z'));

    const response = await request(app)
      .get('/api/automation/executions')
      .query({ entityType: EntityType.TASK })
      .set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data[0]).toHaveProperty('dedupeKey');
  });
});
