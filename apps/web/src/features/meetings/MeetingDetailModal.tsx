import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, ExternalLink, Trash2, Video } from 'lucide-react';
import { toast } from 'sonner';
import { MeetingStatus, PERMISSIONS } from '@probild/shared';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/features/auth/AuthContext';
import { toMessage } from '@/lib/api';
import { formatDateTime, humanise } from '@/lib/utils';
import { MeetingFormModal } from './MeetingFormModal';
import { useChangeMeetingStatus, useDeleteMeeting, useMeeting } from './api';

const STATUS_TONES = {
  SCHEDULED: 'accent',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
} as const;

export function MeetingDetailModal({
  meetingId,
  onClose,
}: {
  meetingId: string;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.MEETING_WRITE);
  const canDelete = can(PERMISSIONS.MEETING_DELETE);

  const meeting = useMeeting(meetingId);
  const changeStatus = useChangeMeetingStatus();
  const deleteMeeting = useDeleteMeeting();

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [outcome, setOutcome] = useState('');

  if (meeting.isPending || !meeting.data) {
    return (
      <Modal open onClose={onClose} title="Meeting">
        {meeting.isError ? (
          <ErrorState message={toMessage(meeting.error)} />
        ) : (
          <LoadingState label="Loading meeting" />
        )}
      </Modal>
    );
  }

  if (editing) {
    return <MeetingFormModal onClose={() => setEditing(false)} meeting={meeting.data} />;
  }

  const record = meeting.data;
  const link = record.calendarEvents[0];

  const setStatus = async (status: MeetingStatus): Promise<void> => {
    if (status === MeetingStatus.COMPLETED && outcome.trim() === '') {
      toast.error('Record what came out of the meeting first.');
      return;
    }
    try {
      await changeStatus.mutateAsync({
        id: record.id,
        status,
        ...(status === MeetingStatus.COMPLETED ? { outcome } : {}),
      });
      toast.success(`Marked ${humanise(status).toLowerCase()}`);
      if (status !== MeetingStatus.COMPLETED) onClose();
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={record.title}
        description={formatDateTime(record.startsAt)}
        footer={
          <>
            {canDelete ? (
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                <Trash2 aria-hidden className="size-4" />
                Delete
              </Button>
            ) : null}
            <span className="flex-1" />
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {canWrite ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONES[record.status] ?? 'neutral'}>
              {humanise(record.status)}
            </Badge>
            {record.needsOutcome ? <Badge tone="warning">Needs an outcome</Badge> : null}
            {record.isSynced ? (
              <Badge tone="accent">
                <CalendarCheck aria-hidden className="mr-1 inline size-3" />
                In Google
              </Badge>
            ) : null}
          </div>

          {record.description ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
              {record.description}
            </p>
          ) : null}

          <dl className="grid gap-3 rounded-md border border-line bg-panel-muted px-4 py-3.5 sm:grid-cols-2">
            <Row label="Starts">{formatDateTime(record.startsAt, record.timezone)}</Row>
            <Row label="Ends">{formatDateTime(record.endsAt, record.timezone)}</Row>
            <Row label="Time zone">{record.timezone}</Row>
            <Row label="Where">{record.location ?? '—'}</Row>
            <Row label="With">
              {record.client ? (
                <Link to={`/clients/${record.client.id}`} className="hover:text-accent">
                  {record.client.companyName}
                </Link>
              ) : record.lead ? (
                <Link to={`/leads/${record.lead.id}`} className="hover:text-accent">
                  {record.lead.companyName}
                </Link>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Project">
              {record.project ? (
                <Link to={`/projects/${record.project.id}`} className="hover:text-accent">
                  {record.project.name}
                </Link>
              ) : (
                '—'
              )}
            </Row>
          </dl>

          {record.meetingUrl || link?.htmlLink ? (
            <div className="flex flex-wrap gap-2">
              {record.meetingUrl ? (
                <a
                  href={record.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-2 text-[0.8125rem] text-ink hover:bg-panel-muted"
                >
                  <Video aria-hidden className="size-4" />
                  Join the call
                </a>
              ) : null}
              {link?.htmlLink ? (
                <a
                  href={link.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-[0.8125rem] text-ink-soft hover:bg-panel-muted"
                >
                  Open in Google Calendar
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              ) : null}
            </div>
          ) : null}

          <section>
            <p className="eyebrow mb-2">Attendees</p>
            <ul className="flex flex-wrap gap-1.5">
              {record.attendees.map((attendee) => (
                <li
                  key={attendee.id}
                  className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-soft"
                >
                  {attendee.user
                    ? `${attendee.user.firstName} ${attendee.user.lastName}`
                    : (attendee.name ?? attendee.email)}
                </li>
              ))}
            </ul>
          </section>

          {record.outcome ? (
            <section>
              <p className="eyebrow mb-1.5">Outcome</p>
              <p className="text-sm whitespace-pre-wrap text-ink-soft">{record.outcome}</p>
            </section>
          ) : null}

          {canWrite && record.status === MeetingStatus.SCHEDULED ? (
            <section className="flex flex-col gap-3 border-t border-line pt-4">
              <Field
                label="What came out of it?"
                htmlFor="meetingOutcome"
                hint="Required to mark the meeting held. Added to the lead's history."
              >
                <Textarea
                  id="meetingOutcome"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  className="min-h-20"
                  placeholder="Agreed the scope; sending a quote this week."
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  loading={changeStatus.isPending}
                  onClick={() => void setStatus(MeetingStatus.COMPLETED)}
                >
                  Mark held
                </Button>
                <Button variant="secondary" onClick={() => void setStatus(MeetingStatus.NO_SHOW)}>
                  They did not show
                </Button>
                <Button variant="ghost" onClick={() => void setStatus(MeetingStatus.CANCELLED)}>
                  Cancel the meeting
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        loading={deleteMeeting.isPending}
        destructive
        title="Delete this meeting?"
        confirmLabel="Delete"
        message={`"${record.title}" will be removed from Probild${
          record.isSynced ? ' and from Google Calendar' : ''
        }.`}
        onConfirm={async () => {
          try {
            await deleteMeeting.mutateAsync(record.id);
            toast.success('Meeting deleted');
            setDeleting(false);
            onClose();
          } catch (error) {
            toast.error(toMessage(error));
          }
        }}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[0.8125rem] text-ink-faint">{label}</dt>
      <dd className="text-right text-[0.8125rem] text-ink">{children}</dd>
    </div>
  );
}
