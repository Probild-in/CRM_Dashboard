import type { MeetingStatus } from '@probild/shared';

export interface MeetingAttendee {
  id: string;
  email: string | null;
  name: string | null;
  response: string;
  user: { id: string; firstName: string; lastName: string; email: string } | null;
}

export interface Meeting {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
  status: MeetingStatus;
  startsAt: string;
  endsAt: string;
  timezone: string;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
  organizer: { id: string; firstName: string; lastName: string; email: string } | null;
  lead: { id: string; reference: string; companyName: string } | null;
  client: { id: string; reference: string; companyName: string } | null;
  project: { id: string; reference: string; name: string } | null;
  attendees: MeetingAttendee[];
  calendarEvents: Array<{
    id: string;
    providerEventId: string;
    htmlLink: string | null;
    hangoutLink: string | null;
    lastSyncedAt: string | null;
  }>;
  /** Derived: still scheduled and already in the past. */
  needsOutcome: boolean;
  isSynced: boolean;
}

export interface CalendarEntry {
  id: string;
  kind: 'MEETING' | 'TASK' | 'PROJECT';
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  url: string;
  status: string;
  isOverdue: boolean;
  context: string | null;
}

export interface CalendarConnection {
  id: string;
  provider: string;
  providerEmail: string | null;
  calendarId: string | null;
  isActive: boolean;
  syncMeetings: boolean;
  syncTasks: boolean;
  lastSyncedAt: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
}

export interface ConnectionState {
  /** False until someone adds the Google credentials to the API environment. */
  configured: boolean;
  connection: CalendarConnection | null;
}
