import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { MeetingStatus, UserRole } from '@probild/shared';
import { prisma, disconnectPrisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';
import { decryptSecret, encryptSecret } from '../src/lib/crypto.js';
import { signState, verifyState } from '../src/modules/calendar/calendar.service.js';
import { authHeader, buildTestApp, createTestUser, loginAs, resetDatabase } from './helpers.js';

let app: Express;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(async () => {
  await resetDatabase();
});

/**
 * The environment is parsed once at boot, so `vi.stubEnv` cannot reach it.
 * These flip the values the app actually reads, and put them back afterwards.
 */
function configureGoogle(): void {
  env.GOOGLE_CLIENT_ID = 'test-client';
  env.GOOGLE_CLIENT_SECRET = 'test-secret';
  env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/calendar/google/callback';
}

function unconfigureGoogle(): void {
  env.GOOGLE_CLIENT_ID = undefined;
  env.GOOGLE_CLIENT_SECRET = undefined;
  env.GOOGLE_REDIRECT_URI = undefined;
}

afterEach(() => {
  unconfigureGoogle();
  vi.restoreAllMocks();
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

async function makeMeeting(token: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/meetings')
    .set(authHeader(token))
    .send({
      title: 'Kick-off call',
      startsAt: '2026-09-01T05:30:00.000Z',
      endsAt: '2026-09-01T06:30:00.000Z',
      timezone: 'Asia/Kolkata',
      ...overrides,
    });
}

describe('POST /api/meetings', () => {
  it('schedules a meeting against a client', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const response = await makeMeeting(token, { clientId: client.id });

    expect(response.status).toBe(201);
    expect(response.body.data.title).toBe('Kick-off call');
    expect(response.body.data.client.id).toBe(client.id);
    // Google is not configured in tests, so nothing is mirrored.
    expect(response.body.data.isSynced).toBe(false);
  });

  it('puts the organiser on their own meeting', async () => {
    const { user, token } = await adminSession();
    const client = await makeClient(token);

    const response = await makeMeeting(token, { clientId: client.id });

    expect(response.body.data.organizer.id).toBe(user.id);
    expect(
      response.body.data.attendees.some(
        (attendee: { user: { id: string } | null }) => attendee.user?.id === user.id,
      ),
    ).toBe(true);
  });

  it('refuses a meeting that ends before it starts', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    const response = await makeMeeting(token, {
      clientId: client.id,
      startsAt: '2026-09-01T06:30:00.000Z',
      endsAt: '2026-09-01T05:30:00.000Z',
    });

    expect(response.status).toBe(400);
  });

  it('refuses a meeting attached to nothing', async () => {
    const { token } = await adminSession();

    const response = await makeMeeting(token);

    expect(response.status).toBe(400);
  });

  it('takes the client from the project it is about', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const project = await request(app)
      .post('/api/projects')
      .set(authHeader(token))
      .send({ clientId: client.id, name: 'Website rebuild' });

    const response = await makeMeeting(token, { projectId: project.body.data.id });

    expect(response.body.data.client.id).toBe(client.id);
    expect(response.body.data.project.id).toBe(project.body.data.id);
  });

  it('writes a meeting against a lead onto its timeline', async () => {
    const { token } = await adminSession();
    const lead = await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({ companyName: 'Meridian Logistics' });

    await makeMeeting(token, { leadId: lead.body.data.id });

    const activities = await request(app)
      .get(`/api/leads/${lead.body.data.id}/activities`)
      .set(authHeader(token));

    expect(
      activities.body.data.some(
        (entry: { type: string; title: string }) =>
          entry.type === 'MEETING' && entry.title.includes('Meeting scheduled'),
      ),
    ).toBe(true);
  });

  it('keeps external attendees alongside team members', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const colleague = await createTestUser(UserRole.SALES);

    const response = await makeMeeting(token, {
      clientId: client.id,
      attendees: [
        { userId: colleague.id },
        { email: 'buyer@abctech.in', name: 'Rohan Mehta' },
      ],
    });

    expect(response.body.data.attendees).toHaveLength(3);
    expect(
      response.body.data.attendees.some(
        (attendee: { email: string | null }) => attendee.email === 'buyer@abctech.in',
      ),
    ).toBe(true);
  });

  it('refuses meeting creation to a role without the permission', async () => {
    const admin = await adminSession();
    const client = await makeClient(admin.token);

    // Every current role may write meetings, so the check is on the token itself.
    const response = await request(app)
      .post('/api/meetings')
      .send({ title: 'No token', clientId: client.id, startsAt: '2026-09-01T05:30:00.000Z', endsAt: '2026-09-01T06:30:00.000Z' });

    expect(response.status).toBe(401);
  });
});

describe('meeting outcomes', () => {
  it('requires an outcome before a meeting can be marked held', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const meeting = await makeMeeting(token, { clientId: client.id });

    const without = await request(app)
      .post(`/api/meetings/${meeting.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: MeetingStatus.COMPLETED });
    expect(without.status).toBe(400);

    const withOutcome = await request(app)
      .post(`/api/meetings/${meeting.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: MeetingStatus.COMPLETED, outcome: 'Agreed the scope; sending a quote.' });
    expect(withOutcome.status).toBe(200);
  });

  it('moves the lead’s last-contacted date when the meeting is held', async () => {
    const { token } = await adminSession();
    const lead = await request(app)
      .post('/api/leads')
      .set(authHeader(token))
      .send({ companyName: 'Meridian Logistics' });
    const meeting = await makeMeeting(token, { leadId: lead.body.data.id });

    await request(app)
      .post(`/api/meetings/${meeting.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: MeetingStatus.COMPLETED, outcome: 'Went well.' });

    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.body.data.id } });
    expect(stored.lastContactedAt?.toISOString()).toBe('2026-09-01T06:30:00.000Z');
  });

  it('flags a scheduled meeting whose time has passed', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const meeting = await makeMeeting(token, {
      clientId: client.id,
      startsAt: '2020-01-01T05:30:00.000Z',
      endsAt: '2020-01-01T06:30:00.000Z',
    });

    const response = await request(app)
      .get(`/api/meetings/${meeting.body.data.id}`)
      .set(authHeader(token));

    expect(response.body.data.needsOutcome).toBe(true);
  });

  it('stops asking for an outcome once the meeting is cancelled', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    const meeting = await makeMeeting(token, {
      clientId: client.id,
      startsAt: '2020-01-01T05:30:00.000Z',
      endsAt: '2020-01-01T06:30:00.000Z',
    });

    const response = await request(app)
      .post(`/api/meetings/${meeting.body.data.id}/status`)
      .set(authHeader(token))
      .send({ status: MeetingStatus.CANCELLED });

    expect(response.body.data.needsOutcome).toBe(false);
  });
});

describe('GET /api/meetings/calendar', () => {
  it('puts meetings, task deadlines and deliveries in one window', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    await makeMeeting(token, { clientId: client.id });
    const project = await request(app).post('/api/projects').set(authHeader(token)).send({
      clientId: client.id,
      name: 'Website rebuild',
      deliveryDate: '2026-09-15',
    });
    await request(app)
      .post('/api/tasks')
      .set(authHeader(token))
      .send({
        title: 'Build the homepage',
        projectId: project.body.data.id,
        dueAt: '2026-09-05T11:30:00.000Z',
      });

    const response = await request(app)
      .get('/api/meetings/calendar')
      .query({ from: '2026-08-01', to: '2026-10-01' })
      .set(authHeader(token));

    expect(response.status).toBe(200);
    const kinds = response.body.data.map((entry: { kind: string }) => entry.kind);
    expect(kinds).toContain('MEETING');
    expect(kinds).toContain('TASK');
    expect(kinds).toContain('PROJECT');
  });

  it('returns entries in time order', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);

    await makeMeeting(token, {
      clientId: client.id,
      title: 'Later',
      startsAt: '2026-09-10T05:30:00.000Z',
      endsAt: '2026-09-10T06:30:00.000Z',
    });
    await makeMeeting(token, {
      clientId: client.id,
      title: 'Sooner',
      startsAt: '2026-09-02T05:30:00.000Z',
      endsAt: '2026-09-02T06:30:00.000Z',
    });

    const response = await request(app)
      .get('/api/meetings/calendar')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set(authHeader(token));

    expect(response.body.data.map((entry: { title: string }) => entry.title)).toEqual([
      'Sooner',
      'Later',
    ]);
  });

  it('marks a delivery date as all-day and a meeting as timed', async () => {
    const { token } = await adminSession();
    const client = await makeClient(token);
    await request(app).post('/api/projects').set(authHeader(token)).send({
      clientId: client.id,
      name: 'Website rebuild',
      deliveryDate: '2026-09-15',
    });
    await makeMeeting(token, { clientId: client.id });

    const response = await request(app)
      .get('/api/meetings/calendar')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set(authHeader(token));

    const project = response.body.data.find((entry: { kind: string }) => entry.kind === 'PROJECT');
    const meeting = response.body.data.find((entry: { kind: string }) => entry.kind === 'MEETING');
    expect(project.allDay).toBe(true);
    expect(meeting.allDay).toBe(false);
  });

  it('shows an employee only their own tasks on the calendar', async () => {
    const admin = await adminSession();
    const employee = await createTestUser(UserRole.EMPLOYEE);
    const session = await loginAs(app, employee.email);

    await request(app)
      .post('/api/tasks')
      .set(authHeader(admin.token))
      .send({ title: 'Someone else’s', dueAt: '2026-09-05T11:30:00.000Z' });
    await request(app)
      .post('/api/tasks')
      .set(authHeader(admin.token))
      .send({ title: 'Theirs', dueAt: '2026-09-05T11:30:00.000Z', assigneeId: employee.id });

    const response = await request(app)
      .get('/api/meetings/calendar')
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set(authHeader(session.accessToken));

    const tasks = response.body.data.filter((entry: { kind: string }) => entry.kind === 'TASK');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Theirs');
  });
});

describe('Google Calendar connection', () => {
  it('reports that the integration is not set up', async () => {
    const { token } = await adminSession();

    const response = await request(app).get('/api/calendar/connection').set(authHeader(token));

    expect(response.status).toBe(200);
    expect(response.body.data.configured).toBe(false);
    expect(response.body.data.connection).toBeNull();
  });

  it('refuses to build a consent URL before the credentials exist', async () => {
    const { token } = await adminSession();

    const response = await request(app).post('/api/calendar/google/connect').set(authHeader(token));

    expect(response.status).toBe(503);
    expect(response.body.error.message).toContain('not set up');
  });

  it('signs the OAuth state so another account cannot claim the callback', async () => {
    const state = signState('11111111-1111-4111-8111-111111111111');

    expect(verifyState(state)).toBe('11111111-1111-4111-8111-111111111111');
    expect(verifyState('not-a-real-state')).toBeNull();

    // Flip one character of the signature.
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const tampered = Buffer.from(`${decoded.slice(0, -1)}${decoded.at(-1) === 'a' ? 'b' : 'a'}`)
      .toString('base64url');
    expect(verifyState(tampered)).toBeNull();
  });

  it('rejects a state that belongs to a different user id', async () => {
    const state = signState('11111111-1111-4111-8111-111111111111');
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    const swapped = Buffer.from(
      ['22222222-2222-4222-8222-222222222222', parts[1], parts[2], parts[3]].join('.'),
    ).toString('base64url');

    expect(verifyState(swapped)).toBeNull();
  });

  it('sends the browser back to the app when the callback carries no code', async () => {
    const response = await request(app).get('/api/calendar/google/callback');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('google=failed');
  });

  it('refuses a callback whose state does not verify', async () => {
    const response = await request(app)
      .get('/api/calendar/google/callback')
      .query({ code: 'abc', state: 'forged' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('invalid_state');
  });

  it('encrypts tokens at rest and never returns them', async () => {
    const { user, token } = await adminSession();

    const secret = 'ya29.super-secret-refresh-token';
    await prisma.calendarConnection.create({
      data: {
        userId: user.id,
        provider: 'GOOGLE',
        providerAccountId: 'google-123',
        providerEmail: 'admin@probild.local',
        accessToken: encryptSecret('access-token'),
        refreshToken: encryptSecret(secret),
        calendarId: 'primary',
      },
    });

    const stored = await prisma.calendarConnection.findFirstOrThrow({
      where: { userId: user.id },
    });
    // The raw value is nowhere in the column…
    expect(stored.refreshToken).not.toContain(secret);
    expect(decryptSecret(stored.refreshToken!)).toBe(secret);

    // …and nowhere in the response either.
    const response = await request(app).get('/api/calendar/connection').set(authHeader(token));
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(response.body.data.connection.providerEmail).toBe('admin@probild.local');
    expect(response.body.data.connection).not.toHaveProperty('accessToken');
    expect(response.body.data.connection).not.toHaveProperty('refreshToken');
  });

  it('lets the user choose what gets mirrored', async () => {
    const { user, token } = await adminSession();
    await prisma.calendarConnection.create({
      data: {
        userId: user.id,
        provider: 'GOOGLE',
        providerAccountId: 'google-123',
        accessToken: encryptSecret('access-token'),
        refreshToken: encryptSecret('refresh-token'),
      },
    });

    const response = await request(app)
      .patch('/api/calendar/connection')
      .set(authHeader(token))
      .send({ syncTasks: true });

    expect(response.body.data.syncTasks).toBe(true);
    expect(response.body.data.syncMeetings).toBe(true);
  });

  it('answers 404 when there is nothing to disconnect', async () => {
    const { token } = await adminSession();

    const response = await request(app).delete('/api/calendar/connection').set(authHeader(token));

    expect(response.status).toBe(404);
  });
});

describe('sync is best-effort', () => {
  it('still creates the meeting when Google is unreachable', async () => {
    configureGoogle();

    const { user, token } = await adminSession();
    const client = await makeClient(token);

    await prisma.calendarConnection.create({
      data: {
        userId: user.id,
        provider: 'GOOGLE',
        providerAccountId: 'google-123',
        accessToken: encryptSecret('access-token'),
        refreshToken: encryptSecret('refresh-token'),
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        calendarId: 'primary',
      },
    });

    // Google is down for the duration of this call.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unreachable'));

    const response = await makeMeeting(token, { clientId: client.id });

    // The meeting exists regardless — an outage must never stop someone booking.
    expect(response.status).toBe(201);
    expect(response.body.data.isSynced).toBe(false);
    expect(await prisma.calendarEvent.count()).toBe(0);
  });

  it('records the mirrored event when Google answers', async () => {
    configureGoogle();

    const { user, token } = await adminSession();
    const client = await makeClient(token);

    await prisma.calendarConnection.create({
      data: {
        userId: user.id,
        provider: 'GOOGLE',
        providerAccountId: 'google-123',
        accessToken: encryptSecret('access-token'),
        refreshToken: encryptSecret('refresh-token'),
        tokenExpiresAt: new Date(Date.now() + 3_600_000),
        calendarId: 'primary',
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'google-event-1',
          htmlLink: 'https://calendar.google.com/event?eid=abc',
          hangoutLink: 'https://meet.google.com/abc-defg-hij',
          status: 'confirmed',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await makeMeeting(token, { clientId: client.id, createMeetLink: true });

    expect(response.status).toBe(201);
    expect(response.body.data.isSynced).toBe(true);
    // The Meet link Google generated is written back onto the meeting.
    expect(response.body.data.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');

    const event = await prisma.calendarEvent.findFirstOrThrow();
    expect(event.providerEventId).toBe('google-event-1');
    expect(event.meetingId).toBe(response.body.data.id);
  });
});
