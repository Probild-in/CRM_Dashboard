import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { ApiErrorCode } from '@probild/shared';

/**
 * Google OAuth 2.0 and Calendar v3, spoken directly over HTTPS.
 *
 * No SDK: the two flows this needs are a token exchange and a handful of REST
 * calls, and keeping them here means the whole integration can be exercised in
 * tests by swapping one `fetch`.
 */

const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Read and write the user's own events, plus their address for display. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
];

export function isGoogleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

/** Thrown when the integration is used before anyone has set up the credentials. */
export class GoogleNotConfiguredError extends AppError {
  constructor() {
    super(
      'Google Calendar is not set up yet. Add the Google client credentials to the API environment.',
      503,
      ApiErrorCode.UNPROCESSABLE,
    );
  }
}

function requireConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  if (!isGoogleConfigured()) {
    throw new GoogleNotConfiguredError();
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    redirectUri: env.GOOGLE_REDIRECT_URI!,
  };
}

/**
 * The consent URL.
 *
 * `access_type=offline` with `prompt=consent` is what makes Google return a
 * refresh token — without both, a reconnect yields an access token that expires
 * in an hour and the integration quietly dies.
 */
export function buildAuthUrl(state: string): string {
  const config = requireConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string | null;
}

async function readJson(response: Response, context: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Google occasionally answers with plain text on an infrastructure error.
    payload = { raw: text };
  }

  if (!response.ok) {
    const detail =
      (payload.error_description as string) ??
      ((payload.error as { message?: string } | string | undefined) as { message?: string })
        ?.message ??
      (typeof payload.error === 'string' ? payload.error : undefined) ??
      `HTTP ${response.status}`;
    throw new AppError(
      `Google ${context} failed: ${detail}`,
      response.status === 401 || response.status === 403 ? 422 : 502,
      ApiErrorCode.UNPROCESSABLE,
    );
  }

  return payload;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const config = requireConfig();
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const payload = await readJson(response, 'token exchange');
  return {
    accessToken: payload.access_token as string,
    refreshToken: (payload.refresh_token as string | undefined) ?? null,
    expiresAt: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000),
    scope: (payload.scope as string | undefined) ?? null,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const config = requireConfig();
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  const payload = await readJson(response, 'token refresh');
  return {
    accessToken: payload.access_token as string,
    // A refresh response usually omits the refresh token; the old one stands.
    refreshToken: (payload.refresh_token as string | undefined) ?? null,
    expiresAt: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000),
    scope: (payload.scope as string | undefined) ?? null,
  };
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(OAUTH_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

export async function fetchAccountEmail(accessToken: string): Promise<{ sub: string; email: string | null }> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await readJson(response, 'profile lookup');
  return {
    sub: payload.sub as string,
    email: (payload.email as string | undefined) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Calendar v3                                                         */
/* ------------------------------------------------------------------ */

export interface GoogleEventInput {
  summary: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  attendees?: Array<{ email: string; displayName?: string | null }>;
  /** Ask Google to attach a Meet link to the event. */
  createMeetLink?: boolean;
}

export interface GoogleEvent {
  id: string;
  htmlLink: string | null;
  hangoutLink: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  status: string | null;
  updated: string | null;
}

function toEventBody(input: GoogleEventInput): Record<string, unknown> {
  return {
    summary: input.summary,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    start: { dateTime: input.startsAt.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.endsAt.toISOString(), timeZone: input.timeZone },
    ...(input.attendees && input.attendees.length > 0
      ? {
          attendees: input.attendees.map((attendee) => ({
            email: attendee.email,
            displayName: attendee.displayName ?? undefined,
          })),
        }
      : {}),
    ...(input.createMeetLink
      ? {
          conferenceData: {
            createRequest: {
              // Google requires a caller-supplied idempotency key here.
              requestId: `probild-${input.startsAt.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }
      : {}),
  };
}

function toGoogleEvent(payload: Record<string, unknown>): GoogleEvent {
  const start = payload.start as { dateTime?: string; date?: string } | undefined;
  const end = payload.end as { dateTime?: string; date?: string } | undefined;
  return {
    id: payload.id as string,
    htmlLink: (payload.htmlLink as string | undefined) ?? null,
    hangoutLink: (payload.hangoutLink as string | undefined) ?? null,
    summary: (payload.summary as string | undefined) ?? null,
    description: (payload.description as string | undefined) ?? null,
    location: (payload.location as string | undefined) ?? null,
    start: start?.dateTime ?? start?.date ?? null,
    end: end?.dateTime ?? end?.date ?? null,
    status: (payload.status as string | undefined) ?? null,
    updated: (payload.updated as string | undefined) ?? null,
  };
}

export async function createEvent(
  accessToken: string,
  calendarId: string,
  input: GoogleEventInput,
): Promise<GoogleEvent> {
  const query = new URLSearchParams({
    ...(input.createMeetLink ? { conferenceDataVersion: '1' } : {}),
    sendUpdates: 'none',
  });

  const response = await fetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toEventBody(input)),
    },
  );

  return toGoogleEvent(await readJson(response, 'event create'));
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: GoogleEventInput,
): Promise<GoogleEvent> {
  const response = await fetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toEventBody(input)),
    },
  );

  return toGoogleEvent(await readJson(response, 'event update'));
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const response = await fetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  );

  // Google answers 410 when the event is already gone, which is the state we wanted.
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    await readJson(response, 'event delete');
  }
}

export interface EventPage {
  events: GoogleEvent[];
  nextSyncToken: string | null;
}

/**
 * Incremental read.
 *
 * With a sync token Google returns only what changed since last time; without
 * one it returns the window and issues a fresh token. A 410 means the token
 * has aged out and the caller must start again from scratch.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  options: { syncToken?: string | null; timeMin?: Date; timeMax?: Date },
): Promise<EventPage> {
  const query = new URLSearchParams({ singleEvents: 'true', maxResults: '250' });

  if (options.syncToken) {
    query.set('syncToken', options.syncToken);
  } else {
    if (options.timeMin) query.set('timeMin', options.timeMin.toISOString());
    if (options.timeMax) query.set('timeMax', options.timeMax.toISOString());
    query.set('orderBy', 'startTime');
  }

  const response = await fetch(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (response.status === 410) {
    throw new AppError(
      'The calendar sync token has expired. Reconnecting will start a fresh sync.',
      409,
      ApiErrorCode.CONFLICT,
    );
  }

  const payload = await readJson(response, 'event list');
  return {
    events: ((payload.items as Array<Record<string, unknown>> | undefined) ?? []).map(toGoogleEvent),
    nextSyncToken: (payload.nextSyncToken as string | undefined) ?? null,
  };
}
