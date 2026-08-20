import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useUsers } from '@/features/users/api';
import { useClients } from '@/features/clients/api';
import { useLeads } from '@/features/leads/api';
import { useProjects } from '@/features/projects/api';
import { toMessage } from '@/lib/api';
import { fromDateInput, toDateTimeInput } from '@/lib/utils';
import { useCalendarConnection, useCreateMeeting, useUpdateMeeting } from './api';
import type { Meeting } from './types';

/** Default a new meeting to the next hour, running 30 minutes. */
function defaultSlot(): { start: string; end: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { start: toDateTimeInput(start.toISOString()), end: toDateTimeInput(end.toISOString()) };
}

export function MeetingFormModal({
  onClose,
  meeting,
  fixedClientId,
  fixedLeadId,
  fixedProjectId,
  initialStart,
}: {
  onClose: () => void;
  meeting?: Meeting | null;
  fixedClientId?: string;
  fixedLeadId?: string;
  fixedProjectId?: string;
  /** Pre-filled when the user picked a slot on the calendar. */
  initialStart?: string;
}) {
  const isEdit = Boolean(meeting);
  const createMeeting = useCreateMeeting();
  const updateMeeting = useUpdateMeeting();
  const connection = useCalendarConnection();

  const team = useUsers({ page: 1, pageSize: 100 });
  const clients = useClients({ page: 1, pageSize: 100 });
  const leads = useLeads({ page: 1, pageSize: 100, openOnly: true });
  const projects = useProjects({ page: 1, pageSize: 100, activeOnly: true });

  const slot = defaultSlot();
  const [title, setTitle] = useState(meeting?.title ?? '');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [location, setLocation] = useState(meeting?.location ?? '');
  const [attachTo, setAttachTo] = useState<'client' | 'lead' | 'project'>(
    meeting?.project ? 'project' : meeting?.lead ? 'lead' : fixedLeadId ? 'lead' : fixedProjectId ? 'project' : 'client',
  );
  const [clientId, setClientId] = useState(meeting?.client?.id ?? fixedClientId ?? '');
  const [leadId, setLeadId] = useState(meeting?.lead?.id ?? fixedLeadId ?? '');
  const [projectId, setProjectId] = useState(meeting?.project?.id ?? fixedProjectId ?? '');
  const [startsAt, setStartsAt] = useState(
    meeting ? toDateTimeInput(meeting.startsAt) : (initialStart ?? slot.start),
  );
  const [endsAt, setEndsAt] = useState(meeting ? toDateTimeInput(meeting.endsAt) : slot.end);
  const [attendeeIds, setAttendeeIds] = useState<string[]>(
    meeting?.attendees.map((attendee) => attendee.user?.id).filter((id): id is string => Boolean(id)) ??
      [],
  );
  const [guestEmail, setGuestEmail] = useState('');
  const [createMeetLink, setCreateMeetLink] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pending = createMeeting.isPending || updateMeeting.isPending;
  const canMeetLink = Boolean(connection.data?.connection?.isActive);

  const onSubmit = async (): Promise<void> => {
    const next: Record<string, string> = {};
    if (title.trim() === '') next.title = 'Give the meeting a title.';
    if (!startsAt) next.startsAt = 'Choose when it starts.';
    if (!endsAt) next.endsAt = 'Choose when it ends.';
    if (startsAt && endsAt && endsAt <= startsAt) next.endsAt = 'It has to end after it starts.';
    if (!isEdit) {
      if (attachTo === 'client' && !clientId) next.link = 'Choose the client this is with.';
      if (attachTo === 'lead' && !leadId) next.link = 'Choose the lead this is with.';
      if (attachTo === 'project' && !projectId) next.link = 'Choose the project this is about.';
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const attendees = [
      ...attendeeIds.map((userId) => ({ userId })),
      ...(guestEmail.trim() ? [{ email: guestEmail.trim() }] : []),
    ];

    try {
      if (isEdit && meeting) {
        await updateMeeting.mutateAsync({
          id: meeting.id,
          title,
          description,
          location,
          startsAt: fromDateInput(startsAt)!,
          endsAt: fromDateInput(endsAt)!,
          attendees,
        });
        toast.success('Meeting updated');
      } else {
        await createMeeting.mutateAsync({
          title,
          description,
          location,
          clientId: attachTo === 'client' ? clientId : null,
          leadId: attachTo === 'lead' ? leadId : null,
          projectId: attachTo === 'project' ? projectId : null,
          startsAt: fromDateInput(startsAt)!,
          endsAt: fromDateInput(endsAt)!,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          attendees,
          createMeetLink: canMeetLink && createMeetLink,
        });
        toast.success('Meeting scheduled');
      }
      onClose();
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  const toggleAttendee = (id: string): void => {
    setAttendeeIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit meeting' : 'Schedule a meeting'}
      description={
        isEdit
          ? 'Changes are pushed to Google if your calendar is connected.'
          : 'It lands on your dashboard and, if your calendar is connected, in Google too.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={pending}>
            {isEdit ? 'Save meeting' : 'Schedule it'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="meetingTitle" error={errors.title} required>
          <Input
            id="meetingTitle"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Kick-off call"
          />
        </Field>

        {!isEdit ? (
          <Field label="This meeting is with" htmlFor="meetingAttach" error={errors.link} required>
            <div className="flex flex-col gap-2">
              <div className="flex gap-1.5">
                {(['client', 'lead', 'project'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAttachTo(option)}
                    className={
                      attachTo === option
                        ? 'rounded-md border border-accent bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent capitalize'
                        : 'rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft capitalize hover:border-line-strong'
                    }
                  >
                    {option}
                  </button>
                ))}
              </div>

              {attachTo === 'client' ? (
                <Select
                  id="meetingAttach"
                  value={clientId}
                  disabled={Boolean(fixedClientId)}
                  onChange={(event) => setClientId(event.target.value)}
                >
                  <option value="">Choose a client</option>
                  {clients.data?.items.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.companyName}
                    </option>
                  ))}
                </Select>
              ) : attachTo === 'lead' ? (
                <Select
                  id="meetingAttach"
                  value={leadId}
                  disabled={Boolean(fixedLeadId)}
                  onChange={(event) => setLeadId(event.target.value)}
                >
                  <option value="">Choose a lead</option>
                  {leads.data?.items.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.companyName}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select
                  id="meetingAttach"
                  value={projectId}
                  disabled={Boolean(fixedProjectId)}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">Choose a project</option>
                  {projects.data?.items.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor="meetingStart" error={errors.startsAt} required>
            <Input
              id="meetingStart"
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </Field>
          <Field label="Ends" htmlFor="meetingEnd" error={errors.endsAt} required>
            <Input
              id="meetingEnd"
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Where" htmlFor="meetingLocation" hint="An address, or leave it for a call.">
          <Input
            id="meetingLocation"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Google Meet, or the client's office"
          />
        </Field>

        <fieldset>
          <legend className="mb-2 text-[0.8125rem] font-medium text-ink-soft">
            Who else is coming
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {team.data?.items.map((member) => {
              const selected = attendeeIds.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleAttendee(member.id)}
                  className={
                    selected
                      ? 'rounded-md border border-accent bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent'
                      : 'rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-soft hover:border-line-strong'
                  }
                >
                  {member.fullName}
                </button>
              );
            })}
          </div>
          <Input
            className="mt-2"
            value={guestEmail}
            onChange={(event) => setGuestEmail(event.target.value)}
            placeholder="Or an email address for someone outside Probild"
            aria-label="Guest email"
          />
        </fieldset>

        {!isEdit ? (
          <label
            className={`flex items-start gap-2.5 rounded-md border border-line px-3.5 py-3 ${
              canMeetLink ? '' : 'opacity-60'
            }`}
          >
            <input
              type="checkbox"
              checked={createMeetLink && canMeetLink}
              disabled={!canMeetLink}
              onChange={(event) => setCreateMeetLink(event.target.checked)}
              className="mt-0.5 size-4 accent-[var(--app-accent)]"
            />
            <span>
              <span className="block text-[0.8125rem] font-medium text-ink">
                Add a Google Meet link
              </span>
              <span className="block text-xs text-ink-faint">
                {canMeetLink
                  ? 'Google generates the link and writes it back onto the meeting.'
                  : 'Connect your Google calendar in Settings to use this.'}
              </span>
            </span>
          </label>
        ) : null}

        <Field label="Notes" htmlFor="meetingDescription">
          <Textarea
            id="meetingDescription"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Agenda, or what needs deciding"
          />
        </Field>
      </div>
    </Modal>
  );
}
