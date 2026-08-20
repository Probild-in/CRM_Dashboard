import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type { DatesSetArg, EventClickArg, EventInput } from '@fullcalendar/core';
import { Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/States';
import { useAuth } from '@/features/auth/AuthContext';
import { MeetingFormModal } from '@/features/meetings/MeetingFormModal';
import { MeetingDetailModal } from '@/features/meetings/MeetingDetailModal';
import {
  useCalendarConnection,
  useCalendarEntries,
  useSyncCalendar,
} from '@/features/meetings/api';
import type { CalendarEntry } from '@/features/meetings/types';
import { toMessage } from '@/lib/api';
import { toDateTimeInput } from '@/lib/utils';
import './calendar.css';

/** What each kind of entry looks like on the grid. */
const KIND_CLASS: Record<CalendarEntry['kind'], string> = {
  MEETING: 'probild-event probild-event--meeting',
  TASK: 'probild-event probild-event--task',
  PROJECT: 'probild-event probild-event--project',
};

export default function CalendarPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.MEETING_WRITE);

  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [slotStart, setSlotStart] = useState<string | undefined>();
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null);

  const entries = useCalendarEntries(range);
  const connection = useCalendarConnection();
  const syncCalendar = useSyncCalendar();

  const events = useMemo<EventInput[]>(
    () =>
      (entries.data ?? []).map((entry) => ({
        id: `${entry.kind}-${entry.id}`,
        title: entry.title,
        start: entry.start,
        end: entry.end ?? undefined,
        allDay: entry.allDay,
        classNames: [KIND_CLASS[entry.kind], entry.isOverdue ? 'probild-event--late' : ''],
        extendedProps: { entry },
      })),
    [entries.data],
  );

  const onDatesSet = (arg: DatesSetArg): void => {
    setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() });
  };

  const onEventClick = (arg: EventClickArg): void => {
    const entry = arg.event.extendedProps.entry as CalendarEntry;
    if (entry.kind === 'MEETING') {
      setOpenMeetingId(entry.id);
      return;
    }
    navigate(entry.url);
  };

  const isConnected = Boolean(connection.data?.connection?.isActive);

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Calendar"
        description="Meetings, task deadlines and project deliveries, on one grid."
        action={
          <div className="flex flex-wrap gap-2">
            {isConnected ? (
              <Button
                variant="secondary"
                loading={syncCalendar.isPending}
                onClick={async () => {
                  try {
                    const result = await syncCalendar.mutateAsync();
                    toast.success(
                      result.updated + result.cancelled === 0
                        ? 'Already up to date with Google'
                        : `Pulled ${result.updated} change${result.updated === 1 ? '' : 's'} from Google`,
                    );
                  } catch (error) {
                    toast.error(toMessage(error));
                  }
                }}
              >
                <RefreshCw aria-hidden className="size-4" />
                Sync with Google
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                variant="primary"
                onClick={() => {
                  setSlotStart(undefined);
                  setFormOpen(true);
                }}
              >
                <Plus aria-hidden className="size-4" />
                Schedule a meeting
              </Button>
            ) : null}
          </div>
        }
      />

      {/* The key: three kinds of entry share this grid, so each is named. */}
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Key className="probild-key--meeting" label="Meetings" />
        <Key className="probild-key--task" label="Task deadlines" />
        <Key className="probild-key--project" label="Project deliveries" />
        <span className="ml-auto font-mono text-[0.6875rem] text-ink-faint">
          {entries.data ? `${entries.data.length} in view` : ''}
        </span>
      </div>

      {entries.isError ? (
        <Panel>
          <ErrorState message={toMessage(entries.error)} onRetry={() => void entries.refetch()} />
        </Panel>
      ) : (
        <Panel className="probild-calendar px-3 py-3 lg:px-4 lg:py-4">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,listWeek',
            }}
            buttonText={{ today: 'Today', month: 'Month', week: 'Week', list: 'Agenda' }}
            height="auto"
            firstDay={1}
            nowIndicator
            dayMaxEvents={4}
            events={events}
            datesSet={onDatesSet}
            eventClick={onEventClick}
            selectable={canWrite}
            select={(arg) => {
              if (!canWrite) return;
              setSlotStart(toDateTimeInput(arg.start.toISOString()));
              setFormOpen(true);
            }}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', meridiem: 'short' }}
            noEventsText="Nothing scheduled in this window."
          />
        </Panel>
      )}

      {formOpen ? (
        <MeetingFormModal onClose={() => setFormOpen(false)} initialStart={slotStart} />
      ) : null}

      {openMeetingId ? (
        <MeetingDetailModal
          key={openMeetingId}
          meetingId={openMeetingId}
          onClose={() => setOpenMeetingId(null)}
        />
      ) : null}
    </>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`probild-key ${className}`} />
      <span className="text-[0.8125rem] text-ink-soft">{label}</span>
    </span>
  );
}
