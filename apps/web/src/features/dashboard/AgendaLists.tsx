import { Link } from 'react-router-dom';
import { AlarmClock, CalendarClock, Target, Video, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { PRIORITY_TONES, TASK_STATUS_TONES } from '@/components/ui/tones';
import { cn, formatDate, formatMoney, humanise, relativeTime } from '@/lib/utils';
import type { FollowUpCard, MeetingCard, PaymentCard, ProjectCard, TaskCard } from './types';

/** One line in an agenda column: a link, a label, and when it is due. */
function AgendaItem({
  to,
  icon,
  title,
  context,
  when,
  late = false,
  trailing,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  context?: string;
  when: string;
  late?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <li>
      <Link
        to={to}
        className={cn(
          'flex items-start gap-2.5 px-5 py-2.5 transition-colors hover:bg-panel-muted',
          late && 'edge-marker text-danger',
        )}
      >
        <span className="mt-0.5 shrink-0 text-ink-faint">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] font-medium text-ink">{title}</span>
          {context ? (
            <span className="block truncate text-xs text-ink-faint">{context}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {trailing}
          <span
            className={cn(
              'tabular font-mono text-[0.6875rem] whitespace-nowrap',
              late ? 'font-medium text-danger' : 'text-ink-faint',
            )}
          >
            {when}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function FollowUpItems({ items, late }: { items: FollowUpCard[]; late?: boolean }) {
  return (
    <>
      {items.map((lead) => (
        <AgendaItem
          key={lead.id}
          to={`/leads/${lead.id}`}
          icon={<Target aria-hidden className="size-3.5" />}
          title={lead.companyName}
          context={[lead.reference, lead.contactPerson].filter(Boolean).join(' · ')}
          when={relativeTime(lead.nextFollowUpAt)}
          late={late}
          trailing={
            lead.priority === 'URGENT' || lead.priority === 'HIGH' ? (
              <Badge tone={PRIORITY_TONES[lead.priority] ?? 'neutral'}>{lead.priority}</Badge>
            ) : null
          }
        />
      ))}
    </>
  );
}

export function TaskItems({ items, late }: { items: TaskCard[]; late?: boolean }) {
  return (
    <>
      {items.map((task) => (
        <AgendaItem
          key={task.id}
          to="/tasks"
          icon={<CalendarClock aria-hidden className="size-3.5" />}
          title={task.title}
          context={[task.reference, task.project?.name, task.assignee
            ? `${task.assignee.firstName} ${task.assignee.lastName}`
            : 'Unassigned',
          ]
            .filter(Boolean)
            .join(' · ')}
          when={task.dueAt ? relativeTime(task.dueAt) : '—'}
          late={late}
          trailing={
            <Badge tone={TASK_STATUS_TONES[task.status] ?? 'neutral'}>
              {humanise(task.status)}
            </Badge>
          }
        />
      ))}
    </>
  );
}

export function ProjectItems({ items, late }: { items: ProjectCard[]; late?: boolean }) {
  return (
    <>
      {items.map((project) => (
        <AgendaItem
          key={project.id}
          to={`/projects/${project.id}`}
          icon={<AlarmClock aria-hidden className="size-3.5" />}
          title={project.name}
          context={`${project.client.companyName} · ${project.progress}% done`}
          when={project.deliveryDate ? relativeTime(project.deliveryDate) : '—'}
          late={late}
        />
      ))}
    </>
  );
}

export function PaymentItems({ items, late }: { items: PaymentCard[]; late?: boolean }) {
  return (
    <>
      {items.map((payment) => (
        <AgendaItem
          key={payment.id}
          to={`/clients/${payment.client.id}`}
          icon={<Wallet aria-hidden className="size-3.5" />}
          title={payment.title}
          context={`${payment.client.companyName} · ${formatMoney(payment.outstanding, payment.currency)} outstanding`}
          when={payment.dueDate ? relativeTime(payment.dueDate) : '—'}
          late={late}
        />
      ))}
    </>
  );
}

export function MeetingItems({ items }: { items: MeetingCard[] }) {
  return (
    <>
      {items.map((meeting) => (
        <AgendaItem
          key={meeting.id}
          to="/calendar"
          icon={<Video aria-hidden className="size-3.5" />}
          title={meeting.title}
          context={
            meeting.client?.companyName ??
            meeting.lead?.companyName ??
            meeting.location ??
            undefined
          }
          when={formatDate(meeting.startsAt)}
        />
      ))}
    </>
  );
}
