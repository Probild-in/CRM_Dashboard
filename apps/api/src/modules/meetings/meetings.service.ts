import {
  AuditAction,
  CLOSED_TASK_STATUSES,
  EntityType,
  LeadActivityType,
  MeetingStatus,
  ProjectStatus,
  type PaginatedResult,
  type UserRole,
} from '@probild/shared';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { NotFoundError, UnprocessableError } from '../../lib/errors.js';
import { buildPaginationMeta, resolveSort, toSkipTake } from '../../lib/pagination.js';
import { recordAudit, type AuditInput } from '../audit/audit.service.js';
import { projectVisibilityFilter } from '../projects/projects.service.js';
import { taskVisibilityFilter } from '../tasks/tasks.service.js';
import * as calendar from '../calendar/calendar.service.js';
import {
  MEETING_SORT_FIELDS,
  type CalendarQuery,
  type ChangeMeetingStatusInput,
  type CreateMeetingInput,
  type ListMeetingsQuery,
  type UpdateMeetingInput,
} from './meetings.schemas.js';

type AuditMeta = Pick<AuditInput, 'userId' | 'ipAddress' | 'userAgent'>;

export interface Actor {
  id: string;
  role: UserRole;
}

const meetingSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  meetingUrl: true,
  status: true,
  startsAt: true,
  endsAt: true,
  timezone: true,
  outcome: true,
  createdAt: true,
  updatedAt: true,
  organizer: { select: { id: true, firstName: true, lastName: true, email: true } },
  lead: { select: { id: true, reference: true, companyName: true } },
  client: { select: { id: true, reference: true, companyName: true } },
  project: { select: { id: true, reference: true, name: true } },
  attendees: {
    select: {
      id: true,
      email: true,
      name: true,
      response: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  },
  calendarEvents: {
    select: { id: true, providerEventId: true, htmlLink: true, hangoutLink: true, lastSyncedAt: true },
  },
} satisfies Prisma.MeetingSelect;

type MeetingRow = Prisma.MeetingGetPayload<{ select: typeof meetingSelect }>;

export interface MeetingView extends MeetingRow {
  /** Derived: still scheduled and already in the past. */
  needsOutcome: boolean;
  /** Whether this meeting is mirrored on somebody's Google calendar. */
  isSynced: boolean;
}

function toMeetingView(meeting: MeetingRow, now = new Date()): MeetingView {
  return {
    ...meeting,
    needsOutcome: meeting.status === MeetingStatus.SCHEDULED && meeting.endsAt < now,
    isSynced: meeting.calendarEvents.length > 0,
  };
}

/**
 * Everyone with `meeting:read` sees the team's calendar — a shared schedule is
 * the point of one. Visibility is enforced on the *records* a meeting links to,
 * which every module already scopes.
 */
async function loadMeeting(id: string): Promise<MeetingRow> {
  const meeting = await prisma.meeting.findFirst({
    where: { id, deletedAt: null },
    select: meetingSelect,
  });
  if (!meeting) {
    throw new NotFoundError('Meeting');
  }
  return meeting;
}

/** A meeting on a project belongs to that project's client; both stay in step. */
async function resolveLinks(input: {
  projectId?: string | null;
  clientId?: string | null;
  leadId?: string | null;
}): Promise<{ projectId: string | null; clientId: string | null; leadId: string | null }> {
  let clientId = input.clientId ?? null;

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, deletedAt: null },
      select: { clientId: true },
    });
    if (!project) {
      throw new UnprocessableError('That project no longer exists.');
    }
    clientId = project.clientId;
  }

  if (clientId) {
    const client = await prisma.client.count({ where: { id: clientId, deletedAt: null } });
    if (client === 0) {
      throw new UnprocessableError('That client no longer exists.');
    }
  }

  if (input.leadId) {
    const lead = await prisma.lead.count({ where: { id: input.leadId, deletedAt: null } });
    if (lead === 0) {
      throw new UnprocessableError('That lead no longer exists.');
    }
  }

  return { projectId: input.projectId ?? null, clientId, leadId: input.leadId ?? null };
}

/** What Google needs to draw the event. */
function toPushable(meeting: MeetingRow, createMeetLink = false): calendar.PushableEvent {
  const context =
    meeting.client?.companyName ?? meeting.lead?.companyName ?? meeting.project?.name ?? null;

  return {
    summary: meeting.title,
    description: [meeting.description, context ? `Probild — ${context}` : null]
      .filter(Boolean)
      .join('\n\n'),
    location: meeting.location,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    timeZone: meeting.timezone,
    attendees: meeting.attendees
      .map((attendee) => ({
        email: attendee.user?.email ?? attendee.email,
        displayName:
          attendee.name ??
          (attendee.user ? `${attendee.user.firstName} ${attendee.user.lastName}` : null),
      }))
      .filter((attendee): attendee is { email: string; displayName: string | null } =>
        Boolean(attendee.email),
      ),
    createMeetLink,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listMeetings(
  query: ListMeetingsQuery,
): Promise<PaginatedResult<MeetingView>> {
  const now = new Date();

  const where: Prisma.MeetingWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.leadId ? { leadId: query.leadId } : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.organizerId ? { organizerId: query.organizerId } : {}),
    ...(query.upcoming
      ? { startsAt: { gte: now }, status: MeetingStatus.SCHEDULED }
      : {}),
    ...(query.from || query.to
      ? {
          startsAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
            { client: { companyName: { contains: query.search, mode: 'insensitive' } } },
            { lead: { companyName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const sortBy = resolveSort(query.sortBy, MEETING_SORT_FIELDS, 'startsAt');
  const { skip, take } = toSkipTake(query);

  const [rows, total] = await prisma.$transaction([
    prisma.meeting.findMany({
      where,
      select: meetingSelect,
      orderBy: { [sortBy]: query.sortOrder },
      skip,
      take,
    }),
    prisma.meeting.count({ where }),
  ]);

  return {
    items: rows.map((row) => toMeetingView(row, now)),
    meta: buildPaginationMeta(total, query),
  };
}

export async function getMeeting(id: string): Promise<MeetingView> {
  return toMeetingView(await loadMeeting(id));
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
  /** Derived: this entry is already late. */
  isOverdue: boolean;
  context: string | null;
}

/**
 * Everything with a date, in one window.
 *
 * Meetings, task deadlines and project delivery dates share the calendar,
 * because "what is happening this week" is one question, not three.
 */
export async function getCalendar(query: CalendarQuery, actor: Actor): Promise<CalendarEntry[]> {
  const now = new Date();
  const entries: CalendarEntry[] = [];

  const meetings = await prisma.meeting.findMany({
    where: { deletedAt: null, startsAt: { gte: query.from, lte: query.to } },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      status: true,
      client: { select: { companyName: true } },
      lead: { select: { companyName: true } },
    },
  });

  entries.push(
    ...meetings.map((meeting) => ({
      id: meeting.id,
      kind: 'MEETING' as const,
      title: meeting.title,
      start: meeting.startsAt.toISOString(),
      end: meeting.endsAt.toISOString(),
      allDay: false,
      url: `/calendar?meeting=${meeting.id}`,
      status: meeting.status,
      isOverdue: meeting.status === MeetingStatus.SCHEDULED && meeting.endsAt < now,
      context: meeting.client?.companyName ?? meeting.lead?.companyName ?? null,
    })),
  );

  if (query.includeTasks) {
    const tasks = await prisma.task.findMany({
      where: {
        deletedAt: null,
        ...taskVisibilityFilter(actor),
        dueAt: { gte: query.from, lte: query.to },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        status: true,
        reference: true,
        project: { select: { name: true } },
      },
    });

    entries.push(
      ...tasks
        .filter((task) => task.dueAt !== null)
        .map((task) => ({
          id: task.id,
          kind: 'TASK' as const,
          title: task.title,
          start: task.dueAt!.toISOString(),
          end: null,
          allDay: false,
          url: `/tasks?task=${task.id}`,
          status: task.status,
          isOverdue: !CLOSED_TASK_STATUSES.includes(task.status) && task.dueAt! < now,
          context: task.project?.name ?? task.reference,
        })),
    );
  }

  if (query.includeProjects) {
    const projects = await prisma.project.findMany({
      where: {
        deletedAt: null,
        ...projectVisibilityFilter(actor),
        deliveryDate: { gte: query.from, lte: query.to },
      },
      select: {
        id: true,
        name: true,
        deliveryDate: true,
        status: true,
        client: { select: { companyName: true } },
      },
    });

    entries.push(
      ...projects
        .filter((project) => project.deliveryDate !== null)
        .map((project) => ({
          id: project.id,
          kind: 'PROJECT' as const,
          title: `${project.name} — delivery`,
          start: project.deliveryDate!.toISOString(),
          end: null,
          // A delivery date is a day, not a moment.
          allDay: true,
          url: `/projects/${project.id}`,
          status: project.status,
          isOverdue:
            project.status !== ProjectStatus.COMPLETED &&
            project.status !== ProjectStatus.CANCELLED &&
            project.deliveryDate! < now,
          context: project.client.companyName,
        })),
    );
  }

  return entries.sort((a, b) => a.start.localeCompare(b.start));
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createMeeting(
  input: CreateMeetingInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<MeetingView> {
  const links = await resolveLinks(input);
  const { attendees, createMeetLink, ...rest } = input;

  const created = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.create({
      data: {
        ...rest,
        ...links,
        organizerId: actor.id,
        attendees: {
          create: [
            // The organiser is always an attendee of their own meeting.
            { userId: actor.id, response: 'ACCEPTED' },
            ...attendees
              .filter((attendee) => attendee.userId !== actor.id)
              .map((attendee) => ({
                userId: attendee.userId ?? null,
                email: attendee.email ?? null,
                name: attendee.name ?? null,
              })),
          ],
        },
      },
      select: meetingSelect,
    });

    // Booking a meeting with a lead is contact, and it is the next step.
    if (links.leadId) {
      await tx.leadActivity.create({
        data: {
          leadId: links.leadId,
          userId: actor.id,
          type: LeadActivityType.MEETING,
          title: `Meeting scheduled: ${meeting.title}`,
          occurredAt: new Date(),
        },
      });
    }

    return meeting;
  });

  const pushed = await calendar.pushEvent(
    actor.id,
    { meetingId: created.id },
    toPushable(created, createMeetLink),
  );

  const meeting =
    pushed?.hangoutLink && !created.meetingUrl
      ? await prisma.meeting.update({
          where: { id: created.id },
          data: { meetingUrl: pushed.hangoutLink },
          select: meetingSelect,
        })
      : await loadMeeting(created.id);

  await recordAudit({
    ...audit,
    action: AuditAction.CREATED,
    entityType: EntityType.MEETING,
    entityId: meeting.id,
    summary: `Scheduled "${meeting.title}"`,
    newValue: { startsAt: meeting.startsAt, syncedToGoogle: Boolean(pushed) },
  });

  return toMeetingView(meeting);
}

export async function updateMeeting(
  id: string,
  input: UpdateMeetingInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<MeetingView> {
  const current = await loadMeeting(id);
  const { attendees, createMeetLink, clientId, projectId, ...rest } = input;

  const links =
    clientId !== undefined || projectId !== undefined
      ? await resolveLinks({ clientId, projectId, leadId: current.lead?.id ?? null })
      : null;

  const updated = await prisma.$transaction(async (tx) => {
    if (attendees) {
      // Replace the guest list wholesale; the organiser always survives.
      await tx.meetingAttendee.deleteMany({
        where: { meetingId: id, userId: { not: current.organizer?.id ?? undefined } },
      });
      await tx.meetingAttendee.createMany({
        data: attendees
          .filter((attendee) => attendee.userId !== current.organizer?.id)
          .map((attendee) => ({
            meetingId: id,
            userId: attendee.userId ?? null,
            email: attendee.email ?? null,
            name: attendee.name ?? null,
          })),
        skipDuplicates: true,
      });
    }

    const data: Prisma.MeetingUncheckedUpdateInput = {
      ...(rest as Prisma.MeetingUncheckedUpdateInput),
      ...(links ? { clientId: links.clientId, projectId: links.projectId } : {}),
    };

    return tx.meeting.update({ where: { id }, data, select: meetingSelect });
  });

  // The organiser owns the mirrored event, so their calendar is the one updated.
  if (updated.organizer) {
    await calendar.pushEvent(
      updated.organizer.id,
      { meetingId: id },
      toPushable(updated, createMeetLink ?? false),
    );
  }

  await recordAudit({
    ...audit,
    action: AuditAction.UPDATED,
    entityType: EntityType.MEETING,
    entityId: id,
    summary: `Updated "${current.title}"`,
    newValue: rest as never,
  });

  return toMeetingView(await loadMeeting(id));
}

export async function changeStatus(
  id: string,
  input: ChangeMeetingStatusInput,
  actor: Actor,
  audit: AuditMeta,
): Promise<MeetingView> {
  const current = await loadMeeting(id);
  if (current.status === input.status) {
    throw new UnprocessableError(`This meeting is already ${input.status.toLowerCase()}.`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const meeting = await tx.meeting.update({
      where: { id },
      data: { status: input.status, outcome: input.outcome ?? current.outcome },
      select: meetingSelect,
    });

    // A completed meeting is the most recent contact with that lead.
    if (input.status === MeetingStatus.COMPLETED && current.lead) {
      await tx.lead.update({
        where: { id: current.lead.id },
        data: { lastContactedAt: meeting.endsAt },
      });
      await tx.leadActivity.create({
        data: {
          leadId: current.lead.id,
          userId: actor.id,
          type: LeadActivityType.MEETING,
          title: `Meeting held: ${meeting.title}`,
          body: input.outcome ?? null,
          occurredAt: meeting.endsAt,
        },
      });
    }

    return meeting;
  });

  if (input.status === MeetingStatus.CANCELLED) {
    await calendar.removeEvent({ meetingId: id });
  }

  await recordAudit({
    ...audit,
    action: AuditAction.STATUS_CHANGED,
    entityType: EntityType.MEETING,
    entityId: id,
    summary: `"${current.title}": ${current.status} → ${input.status}`,
    previousValue: { status: current.status },
    newValue: { status: input.status, outcome: input.outcome ?? null },
  });

  return toMeetingView(updated);
}

export async function deleteMeeting(id: string, audit: AuditMeta): Promise<void> {
  const current = await loadMeeting(id);

  await calendar.removeEvent({ meetingId: id });
  await prisma.meeting.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    ...audit,
    action: AuditAction.DELETED,
    entityType: EntityType.MEETING,
    entityId: id,
    summary: `Deleted meeting "${current.title}"`,
  });
}

/**
 * Mirrors a task deadline onto the assignee's calendar.
 *
 * Opt-in per connection: most people do not want every task in their calendar,
 * and the ones who do said so on the settings screen.
 */
export async function syncTaskDeadline(taskId: string): Promise<boolean> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: {
      id: true,
      reference: true,
      title: true,
      description: true,
      dueAt: true,
      status: true,
      assigneeId: true,
      project: { select: { name: true } },
      assignee: { select: { timezone: true } },
    },
  });

  if (!task?.assigneeId || !task.dueAt) {
    return false;
  }

  if (CLOSED_TASK_STATUSES.includes(task.status)) {
    await calendar.removeEvent({ taskId });
    return false;
  }

  const pushed = await calendar.pushEvent(
    task.assigneeId,
    { taskId },
    {
      summary: `${task.title} (due)`,
      description: [task.description, `Probild task ${task.reference}`, task.project?.name]
        .filter(Boolean)
        .join('\n\n'),
      // A deadline is a moment, so the event is a 30-minute marker before it.
      startsAt: new Date(task.dueAt.getTime() - 30 * 60_000),
      endsAt: task.dueAt,
      timeZone: task.assignee?.timezone ?? 'Asia/Kolkata',
    },
  );

  return Boolean(pushed);
}
