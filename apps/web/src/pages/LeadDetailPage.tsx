import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  Mail,
  MessageCircle,
  Move,
  Pencil,
  Phone,
  PlusCircle,
  Repeat2,
} from 'lucide-react';
import { LeadStatus, PERMISSIONS, TERMINAL_LEAD_STATUSES } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel';
import { Button, buttonStyles } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LEAD_STATUS_TONES, PRIORITY_TONES } from '@/components/ui/tones';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/features/auth/AuthContext';
import { LeadFormModal } from '@/features/leads/LeadFormModal';
import { ChangeStatusModal, LogActivityModal } from '@/features/leads/LeadActionModals';
import { ConvertLeadModal } from '@/features/clients/ConvertLeadModal';
import { useLead, useLeadActivities } from '@/features/leads/api';
import type { LeadActivity } from '@/features/leads/types';
import { toMessage } from '@/lib/api';
import { cn, formatDate, formatDateTime, formatMoney, humanise, relativeTime } from '@/lib/utils';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.LEAD_WRITE);
  const canConvert = can(PERMISSIONS.LEAD_CONVERT) && can(PERMISSIONS.CLIENT_WRITE);

  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const lead = useLead(id);
  const activities = useLeadActivities(id);

  if (lead.isPending) return <LoadingState label="Loading lead" />;
  if (lead.isError) {
    return (
      <Panel>
        <ErrorState
          title="This lead did not load"
          message={toMessage(lead.error)}
          onRetry={() => void lead.refetch()}
        />
      </Panel>
    );
  }

  const record = lead.data;
  const isClosed = TERMINAL_LEAD_STATUSES.includes(record.status);

  return (
    <>
      <Link
        to="/leads"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-faint hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All leads
      </Link>

      <PageHeader
        eyebrow={record.reference}
        title={record.companyName}
        description={
          [record.industry, record.city, record.country].filter(Boolean).join(' · ') || undefined
        }
        action={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              {record.status === LeadStatus.WON && !record.convertedClientId && canConvert ? (
                <Button variant="primary" onClick={() => setConvertOpen(true)}>
                  <Repeat2 aria-hidden className="size-4" />
                  Convert to client
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setLogOpen(true)}>
                <PlusCircle aria-hidden className="size-4" />
                Log activity
              </Button>
              <Button variant="secondary" onClick={() => setMoveOpen(true)}>
                <Move aria-hidden className="size-4" />
                Move stage
              </Button>
              <Button
                variant={record.status === LeadStatus.WON ? 'secondary' : 'primary'}
                onClick={() => setEditOpen(true)}
              >
                <Pencil aria-hidden className="size-4" />
                Edit
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={LEAD_STATUS_TONES[record.status] ?? 'neutral'}>{humanise(record.status)}</Badge>
        <Badge tone={PRIORITY_TONES[record.priority] ?? 'neutral'}>
          {humanise(record.priority)} priority
        </Badge>
        <Badge>{humanise(record.source)}</Badge>
        {record.isFollowUpOverdue ? <Badge tone="danger">Follow-up overdue</Badge> : null}
      </div>

      {record.convertedClientId ? (
        <p className="edge-marker mb-5 flex flex-wrap items-center gap-2 rounded-r bg-success-soft py-2.5 pr-4 pl-4 text-sm text-success">
          Converted to a client on {formatDate(record.convertedAt)}.
          <Link
            to={`/clients/${record.convertedClientId}`}
            className="font-medium underline underline-offset-2"
          >
            Open the client
          </Link>
        </p>
      ) : null}

      {record.status === 'LOST' && record.lostReason ? (
        <p className="edge-marker mb-5 rounded-r bg-danger-soft py-2.5 pr-4 pl-4 text-sm text-danger">
          Lost: {record.lostReason}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.25fr] lg:items-start">
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader eyebrow="Opportunity" title="The deal" />
            <PanelBody className="flex flex-col gap-3">
              <Row label="Expected value">
                <span className="tabular font-mono">
                  {formatMoney(record.expectedValue, record.currency)}
                </span>
              </Row>
              <Row label="Service">{record.interestedService?.name ?? 'Not decided'}</Row>
              <Row label="Expected close">{formatDate(record.expectedCloseDate)}</Row>
              <Row label="Owner">
                {record.assignedTo
                  ? `${record.assignedTo.firstName} ${record.assignedTo.lastName}`
                  : 'Unassigned'}
              </Row>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Timing" title="Follow-up" />
            <PanelBody className="flex flex-col gap-3">
              <Row label="Next follow-up">
                {record.nextFollowUpAt ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5',
                      record.isFollowUpOverdue && 'font-medium text-danger',
                    )}
                  >
                    <CalendarClock aria-hidden className="size-3.5" />
                    {formatDateTime(record.nextFollowUpAt)}
                  </span>
                ) : isClosed ? (
                  'Not needed — this lead is closed'
                ) : (
                  'Not scheduled'
                )}
              </Row>
              <Row label="Last contacted">
                {record.lastContactedAt
                  ? `${formatDate(record.lastContactedAt)} (${relativeTime(record.lastContactedAt)})`
                  : 'Never'}
              </Row>
              <Row label="Created">{formatDate(record.createdAt)}</Row>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Contact" title="How to reach them" />
            <PanelBody className="flex flex-col gap-3">
              <Row label="Person">{record.contactPerson ?? '—'}</Row>
              <Row label="Email">
                {record.email ? (
                  <a href={`mailto:${record.email}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <Mail aria-hidden className="size-3.5" />
                    {record.email}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Phone">
                {record.phone ? (
                  <a href={`tel:${record.phone}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                    <Phone aria-hidden className="size-3.5" />
                    {record.phone}
                  </a>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="WhatsApp">
                {record.whatsapp ? (
                  <span className="inline-flex items-center gap-1.5">
                    <MessageCircle aria-hidden className="size-3.5" />
                    {record.whatsapp}
                  </span>
                ) : (
                  '—'
                )}
              </Row>
              {record.website ? (
                <Row label="Website">
                  <a
                    href={record.website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-accent"
                  >
                    Visit
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                </Row>
              ) : null}
              {record.linkedin ? (
                <Row label="LinkedIn">
                  <a
                    href={record.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-accent"
                  >
                    Profile
                    <ExternalLink aria-hidden className="size-3.5" />
                  </a>
                </Row>
              ) : null}
            </PanelBody>
          </Panel>

          {record.notes ? (
            <Panel>
              <PanelHeader eyebrow="Context" title="Notes" />
              <PanelBody>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
                  {record.notes}
                </p>
              </PanelBody>
            </Panel>
          ) : null}
        </div>

        <Panel>
          <PanelHeader
            eyebrow="History"
            title="Activity"
            action={
              canWrite ? (
                <Button size="sm" variant="secondary" onClick={() => setLogOpen(true)}>
                  Log activity
                </Button>
              ) : null
            }
          />
          {activities.isPending ? (
            <LoadingState label="Loading history" />
          ) : activities.isError ? (
            <ErrorState
              message={toMessage(activities.error)}
              onRetry={() => void activities.refetch()}
            />
          ) : activities.data.length === 0 ? (
            <EmptyState
              title="Nothing logged yet"
              description="Calls, emails, meetings and stage changes all appear here in order."
            />
          ) : (
            <ol className="flex flex-col px-5 py-4">
              {activities.data.map((entry, index) => (
                <TimelineEntry
                  key={entry.id}
                  entry={entry}
                  isLast={index === activities.data.length - 1}
                />
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <LeadFormModal open={editOpen} onClose={() => setEditOpen(false)} lead={record} />
      {moveOpen ? (
        <ChangeStatusModal key={record.id} lead={record} onClose={() => setMoveOpen(false)} />
      ) : null}
      {logOpen ? (
        <LogActivityModal key={record.id} lead={record} onClose={() => setLogOpen(false)} />
      ) : null}
      {convertOpen ? (
        <ConvertLeadModal key={record.id} lead={record} onClose={() => setConvertOpen(false)} />
      ) : null}

      <div className="mt-6 lg:hidden">
        <Link to="/pipeline" className={buttonStyles({ variant: 'secondary' })}>
          Open the pipeline board
        </Link>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[0.8125rem] text-ink-faint">{label}</span>
      <span className="text-right text-[0.8125rem] text-ink">{children}</span>
    </div>
  );
}

/** System entries are quieter than the ones a person wrote. */
const SYSTEM_TYPES = new Set(['CREATED', 'STATUS_CHANGE', 'VALUE_CHANGE', 'FOLLOW_UP_SET', 'ASSIGNED', 'CONVERTED']);

function TimelineEntry({ entry, isLast }: { entry: LeadActivity; isLast: boolean }) {
  const isSystem = SYSTEM_TYPES.has(entry.type);

  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-0">
      {!isLast ? (
        <span aria-hidden className="absolute top-5 bottom-0 left-[3px] w-px bg-line" />
      ) : null}
      <span
        aria-hidden
        className={cn(
          'relative mt-1.5 size-[7px] shrink-0 rounded-full',
          isSystem ? 'bg-line-strong' : 'bg-accent',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={cn('text-[0.8125rem]', isSystem ? 'text-ink-soft' : 'font-medium text-ink')}>
            {entry.title}
          </p>
          <span className="font-mono text-[0.6875rem] whitespace-nowrap text-ink-faint">
            {formatDateTime(entry.occurredAt)}
          </span>
        </div>
        {entry.body ? (
          <p className="mt-1 text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-ink-soft">
            {entry.body}
          </p>
        ) : null}
        <p className="mt-1 font-mono text-[0.625rem] tracking-wide text-ink-faint uppercase">
          {humanise(entry.type)}
          {entry.user ? ` · ${entry.user.firstName} ${entry.user.lastName}` : ''}
        </p>
      </div>
    </li>
  );
}
