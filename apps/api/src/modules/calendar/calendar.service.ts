import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditAction, EntityType } from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { recordAudit, type AuditInput } from '../audit/audit.service.js';
import * as google from './google.client.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

/** Refresh a little early, so a token never expires mid-request. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/* ------------------------------------------------------------------ */
/* OAuth state                                                         */
/* ------------------------------------------------------------------ */

/**
 * The `state` parameter, signed rather than stored.
 *
 * It carries the user id and a nonce through the round trip to Google and back;
 * the HMAC is what stops someone else's callback from attaching a calendar to
 * this account. It is short-lived, so no server-side session is needed.
 *
 * Keyed with ENCRYPTION_KEY, which already guards this integration's tokens.
 * It was the JWT access secret until Supabase Auth removed that; the signature
 * is a CSRF guard and never was a session concern.
 */
export function signState(userId: string): string {
  const payload = `${userId}.${Date.now()}.${randomBytes(8).toString('hex')}`;
  const signature = createHmac('sha256', env.ENCRYPTION_KEY).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

const STATE_TTL_MS = 10 * 60_000;

export function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 4) return null;

    const [userId, issuedAt, nonce, signature] = parts as [string, string, string, string];
    const expected = createHmac('sha256', env.ENCRYPTION_KEY)
      .update(`${userId}.${issuedAt}.${nonce}`)
      .digest('hex');

    const given = Buffer.from(signature, 'hex');
    const want = Buffer.from(expected, 'hex');
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    if (Date.now() - Number(issuedAt) > STATE_TTL_MS) return null;

    return userId;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

const connectionSelect = {
  id: true,
  provider: true,
  providerEmail: true,
  calendarId: true,
  isActive: true,
  syncMeetings: true,
  syncTasks: true,
  lastSyncedAt: true,
  tokenExpiresAt: true,
  createdAt: true,
} satisfies Prisma.CalendarConnectionSelect;

export type ConnectionView = Prisma.CalendarConnectionGetPayload<{
  select: typeof connectionSelect;
}>;

export async function getConnection(userId: string): Promise<ConnectionView | null> {
  return prisma.calendarConnection.findFirst({
    where: { userId, isActive: true },
    select: connectionSelect,
  });
}

export function connectUrl(userId: string): string {
  return google.buildAuthUrl(signState(userId));
}

/**
 * Completes the OAuth round trip.
 *
 * Tokens are encrypted before they touch the database and never leave the
 * server — the frontend only ever learns that a connection exists.
 */
export async function completeConnection(
  userId: string,
  code: string,
  audit: AuditMeta,
): Promise<ConnectionView> {
  const tokens = await google.exchangeCode(code);
  const account = await google.fetchAccountEmail(tokens.accessToken);

  if (!tokens.refreshToken) {
    // Without one, the connection dies silently in an hour.
    throw new ConflictError(
      'Google did not return a refresh token. Remove Probild from your Google account permissions and connect again.',
    );
  }

  const existing = await prisma.calendarConnection.findFirst({
    where: { userId, provider: 'GOOGLE', providerAccountId: account.sub },
    select: { id: true },
  });

  const data = {
    providerEmail: account.email,
    accessToken: encryptSecret(tokens.accessToken),
    refreshToken: encryptSecret(tokens.refreshToken),
    scope: tokens.scope,
    tokenExpiresAt: tokens.expiresAt,
    calendarId: 'primary',
    isActive: true,
    // A reconnect starts a fresh sync.
    syncToken: null,
  };

  const connection = existing
    ? await prisma.calendarConnection.update({
        where: { id: existing.id },
        data,
        select: connectionSelect,
      })
    : await prisma.calendarConnection.create({
        data: { ...data, userId, provider: 'GOOGLE', providerAccountId: account.sub },
        select: connectionSelect,
      });

  await recordAudit({
    ...audit,
    userId,
    action: AuditAction.CREATED,
    entityType: EntityType.USER,
    entityId: userId,
    summary: `Connected Google Calendar (${account.email ?? account.sub})`,
  });

  return connection;
}

export async function updateConnection(
  userId: string,
  input: { syncMeetings?: boolean; syncTasks?: boolean },
): Promise<ConnectionView> {
  const connection = await getConnection(userId);
  if (!connection) {
    throw new NotFoundError('Calendar connection');
  }
  return prisma.calendarConnection.update({
    where: { id: connection.id },
    data: input,
    select: connectionSelect,
  });
}

export async function disconnect(userId: string, audit: AuditMeta): Promise<void> {
  const connection = await prisma.calendarConnection.findFirst({
    where: { userId, isActive: true },
    select: { id: true, refreshToken: true, providerEmail: true },
  });
  if (!connection) {
    throw new NotFoundError('Calendar connection');
  }

  if (connection.refreshToken) {
    await google.revokeToken(decryptSecret(connection.refreshToken));
  }

  // The row is kept so past events still resolve to the account that made them.
  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: { isActive: false, accessToken: '', refreshToken: null, syncToken: null },
  });

  await recordAudit({
    ...audit,
    userId,
    action: AuditAction.DELETED,
    entityType: EntityType.USER,
    entityId: userId,
    summary: `Disconnected Google Calendar (${connection.providerEmail ?? 'unknown account'})`,
  });
}

/**
 * A usable access token for the connection, refreshing it first if it is close
 * to expiry. The refreshed token is written back encrypted.
 */
export async function accessTokenFor(connectionId: string): Promise<{
  accessToken: string;
  calendarId: string;
}> {
  const connection = await prisma.calendarConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: {
      id: true,
      accessToken: true,
      refreshToken: true,
      tokenExpiresAt: true,
      calendarId: true,
      isActive: true,
    },
  });

  if (!connection.isActive || !connection.refreshToken) {
    throw new ConflictError('This Google Calendar connection is no longer active.');
  }

  const expiresSoon =
    !connection.tokenExpiresAt ||
    connection.tokenExpiresAt.getTime() - Date.now() < TOKEN_REFRESH_MARGIN_MS;

  if (!expiresSoon && connection.accessToken) {
    return {
      accessToken: decryptSecret(connection.accessToken),
      calendarId: connection.calendarId ?? 'primary',
    };
  }

  const refreshed = await google.refreshAccessToken(decryptSecret(connection.refreshToken));

  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: encryptSecret(refreshed.accessToken),
      tokenExpiresAt: refreshed.expiresAt,
      ...(refreshed.refreshToken ? { refreshToken: encryptSecret(refreshed.refreshToken) } : {}),
    },
  });

  return {
    accessToken: refreshed.accessToken,
    calendarId: connection.calendarId ?? 'primary',
  };
}

/* ------------------------------------------------------------------ */
/* Pushing local records to Google                                     */
/* ------------------------------------------------------------------ */

export interface PushableEvent {
  summary: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  attendees?: Array<{ email: string; displayName?: string | null }>;
  createMeetLink?: boolean;
}

/**
 * Mirrors a local record onto the organiser's Google calendar.
 *
 * Sync is best-effort by design: a Google outage must never stop someone
 * booking a meeting in Probild. Failures are logged and the local record
 * stands on its own.
 */
export async function pushEvent(
  userId: string,
  link: { meetingId?: string; taskId?: string },
  event: PushableEvent,
): Promise<{ providerEventId: string; htmlLink: string | null; hangoutLink: string | null } | null> {
  if (!google.isGoogleConfigured()) return null;

  const connection = await prisma.calendarConnection.findFirst({
    where: {
      userId,
      isActive: true,
      ...(link.taskId ? { syncTasks: true } : { syncMeetings: true }),
    },
    select: { id: true },
  });
  if (!connection) return null;

  try {
    const { accessToken, calendarId } = await accessTokenFor(connection.id);

    const existing = await prisma.calendarEvent.findFirst({
      where: {
        connectionId: connection.id,
        ...(link.meetingId ? { meetingId: link.meetingId } : { taskId: link.taskId }),
      },
      select: { id: true, providerEventId: true },
    });

    const remote = existing
      ? await google.updateEvent(accessToken, calendarId, existing.providerEventId, event)
      : await google.createEvent(accessToken, calendarId, event);

    if (existing) {
      await prisma.calendarEvent.update({
        where: { id: existing.id },
        data: {
          htmlLink: remote.htmlLink,
          hangoutLink: remote.hangoutLink,
          lastSyncedAt: new Date(),
        },
      });
    } else {
      await prisma.calendarEvent.create({
        data: {
          connectionId: connection.id,
          meetingId: link.meetingId ?? null,
          taskId: link.taskId ?? null,
          providerEventId: remote.id,
          htmlLink: remote.htmlLink,
          hangoutLink: remote.hangoutLink,
          syncDirection: 'LOCAL_TO_REMOTE',
          lastSyncedAt: new Date(),
        },
      });
    }

    return {
      providerEventId: remote.id,
      htmlLink: remote.htmlLink,
      hangoutLink: remote.hangoutLink,
    };
  } catch (error) {
    logger.error({ err: error, userId, link }, 'Could not push the event to Google Calendar');
    return null;
  }
}

/** Removes the mirrored event, if there is one. Failures never block the caller. */
export async function removeEvent(link: { meetingId?: string; taskId?: string }): Promise<void> {
  if (!google.isGoogleConfigured()) return;

  const events = await prisma.calendarEvent.findMany({
    where: link.meetingId ? { meetingId: link.meetingId } : { taskId: link.taskId },
    select: { id: true, connectionId: true, providerEventId: true },
  });

  for (const event of events) {
    try {
      const { accessToken, calendarId } = await accessTokenFor(event.connectionId);
      await google.deleteEvent(accessToken, calendarId, event.providerEventId);
      await prisma.calendarEvent.delete({ where: { id: event.id } });
    } catch (error) {
      logger.error({ err: error, link }, 'Could not remove the event from Google Calendar');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Pulling from Google                                                 */
/* ------------------------------------------------------------------ */

export interface SyncResult {
  pulled: number;
  updated: number;
  cancelled: number;
  lastSyncedAt: string;
}

/**
 * Reads back what changed in Google.
 *
 * Probild does not create meetings from arbitrary Google events — that would
 * fill the CRM with lunch. It updates the events it already owns, so a time
 * changed in Google is reflected here.
 */
export async function pullChanges(userId: string): Promise<SyncResult> {
  const connection = await prisma.calendarConnection.findFirst({
    where: { userId, isActive: true },
    select: { id: true, syncToken: true },
  });
  if (!connection) {
    throw new NotFoundError('Calendar connection');
  }

  const { accessToken, calendarId } = await accessTokenFor(connection.id);
  const now = new Date();

  const page = await google.listEvents(accessToken, calendarId, {
    syncToken: connection.syncToken,
    timeMin: new Date(now.getTime() - 30 * 86_400_000),
    timeMax: new Date(now.getTime() + 180 * 86_400_000),
  });

  let updated = 0;
  let cancelled = 0;

  for (const remote of page.events) {
    const mirrored = await prisma.calendarEvent.findFirst({
      where: { connectionId: connection.id, providerEventId: remote.id },
      select: { id: true, meetingId: true },
    });
    if (!mirrored?.meetingId) continue;

    if (remote.status === 'cancelled') {
      await prisma.meeting.update({
        where: { id: mirrored.meetingId },
        data: { status: 'CANCELLED' },
      });
      cancelled += 1;
      continue;
    }

    if (remote.start && remote.end) {
      await prisma.meeting.update({
        where: { id: mirrored.meetingId },
        data: {
          startsAt: new Date(remote.start),
          endsAt: new Date(remote.end),
          ...(remote.summary ? { title: remote.summary } : {}),
          ...(remote.location !== null ? { location: remote.location } : {}),
          ...(remote.hangoutLink ? { meetingUrl: remote.hangoutLink } : {}),
        },
      });
      updated += 1;
    }

    await prisma.calendarEvent.update({
      where: { id: mirrored.id },
      data: { syncDirection: 'REMOTE_TO_LOCAL', lastSyncedAt: now },
    });
  }

  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: { syncToken: page.nextSyncToken, lastSyncedAt: now },
  });

  return {
    pulled: page.events.length,
    updated,
    cancelled,
    lastSyncedAt: now.toISOString(),
  };
}
