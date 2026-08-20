import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Move, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  LeadSource,
  LeadStatus,
  PERMISSIONS,
  Priority,
  type LeadStatus as LeadStatusType,
} from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { LEAD_STATUS_TONES, PRIORITY_TONES } from '@/components/ui/tones';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination, TableWrap, Td, Th } from '@/components/ui/Table';
import { ConfirmDialog } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { LeadFormModal } from '@/features/leads/LeadFormModal';
import { ChangeStatusModal } from '@/features/leads/LeadActionModals';
import { useDeleteLead, useLeadSummary, useLeads } from '@/features/leads/api';
import type { Lead } from '@/features/leads/types';
import { toMessage } from '@/lib/api';
import { cn, formatDate, formatMoney, humanise, relativeTime } from '@/lib/utils';

export default function LeadsPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.LEAD_WRITE);
  const canDelete = can(PERMISSIONS.LEAD_DELETE);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<LeadStatusType | ''>('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [source, setSource] = useState<LeadSource | ''>('');
  const [owner, setOwner] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'open' | 'overdue' | 'unassigned'>('open');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [moving, setMoving] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);

  const summary = useLeadSummary();
  const team = useUsers({ page: 1, pageSize: 100 });
  const deleteLead = useDeleteLead();

  const query = useLeads({
    page,
    pageSize: 20,
    search,
    status,
    priority,
    source,
    assignedToId: owner || undefined,
    openOnly: quickFilter === 'open',
    followUpOverdue: quickFilter === 'overdue',
    unassigned: quickFilter === 'unassigned',
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const hasFilters = Boolean(search || status || priority || source || owner);

  const QUICK_FILTERS = [
    { key: 'open', label: 'Open', count: summary.data?.open },
    { key: 'overdue', label: 'Follow-up due', count: summary.data?.followUpOverdue },
    { key: 'unassigned', label: 'Unassigned', count: summary.data?.unassigned },
    { key: 'all', label: 'All', count: summary.data?.total },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        description="Every enquiry Probild is working, who owns it, and when it needs chasing next."
        action={
          canWrite ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" />
              Add lead
            </Button>
          ) : null
        }
      />

      {/* Counts double as filters — the number and the way to act on it are the same control. */}
      <div className="mb-5 flex flex-wrap gap-2">
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => change(setQuickFilter)(filter.key)}
            className={cn(
              'flex items-baseline gap-2 rounded-md border px-3.5 py-2 transition-colors',
              quickFilter === filter.key
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-panel text-ink-soft hover:border-line-strong',
            )}
          >
            <span className="tabular font-display text-lg font-semibold">
              {filter.count ?? '—'}
            </span>
            <span className="text-[0.8125rem]">{filter.label}</span>
          </button>
        ))}
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
          <Input
            type="search"
            value={search}
            onChange={(event) => change(setSearch)(event.target.value)}
            placeholder="Company, contact, email or reference"
            aria-label="Search leads"
            className="h-9 max-w-xs"
          />
          <Select
            value={status}
            onChange={(event) => change(setStatus)(event.target.value as LeadStatusType | '')}
            aria-label="Filter by stage"
            className="h-9 w-auto"
          >
            <option value="">All stages</option>
            {Object.values(LeadStatus).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={priority}
            onChange={(event) => change(setPriority)(event.target.value as Priority | '')}
            aria-label="Filter by priority"
            className="h-9 w-auto"
          >
            <option value="">All priorities</option>
            {Object.values(Priority).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={source}
            onChange={(event) => change(setSource)(event.target.value as LeadSource | '')}
            aria-label="Filter by source"
            className="h-9 w-auto"
          >
            <option value="">All sources</option>
            {Object.values(LeadSource).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={owner}
            onChange={(event) => change(setOwner)(event.target.value)}
            aria-label="Filter by owner"
            className="h-9 w-auto"
          >
            <option value="">All owners</option>
            {team.data?.items.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </Select>
          {hasFilters ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch('');
                setStatus('');
                setPriority('');
                setSource('');
                setOwner('');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        {query.isPending ? (
          <TableSkeleton rows={8} columns={6} />
        ) : query.isError ? (
          <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={<Target aria-hidden className="size-4.5" />}
            title={hasFilters ? 'No leads match those filters' : 'No leads here yet'}
            description={
              hasFilters
                ? 'Clear the filters to see the rest of the pipeline.'
                : 'Add the first lead and Probild will track its follow-ups from then on.'
            }
            action={
              canWrite && !hasFilters ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  <Plus aria-hidden className="size-4" />
                  Add lead
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Lead</Th>
                  <Th>Stage</Th>
                  <Th>Owner</Th>
                  <Th align="right">Value</Th>
                  <Th>Next follow-up</Th>
                  {canWrite ? <Th align="right">Actions</Th> : null}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((lead) => (
                  <tr key={lead.id} className="group transition-colors hover:bg-panel-muted">
                    <Td>
                      <Link to={`/leads/${lead.id}`} className="block min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[0.8125rem] font-medium text-ink group-hover:text-accent">
                            {lead.companyName}
                          </span>
                          <Badge tone={PRIORITY_TONES[lead.priority] ?? 'neutral'}>
                            {lead.priority}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-faint">
                          {lead.reference}
                          {lead.contactPerson ? ` · ${lead.contactPerson}` : ''}
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={LEAD_STATUS_TONES[lead.status] ?? 'neutral'}>
                        {humanise(lead.status)}
                      </Badge>
                    </Td>
                    <Td className="text-[0.8125rem]">
                      {lead.assignedTo
                        ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}`
                        : 'Unassigned'}
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem] whitespace-nowrap">
                      {formatMoney(lead.expectedValue, lead.currency)}
                    </Td>
                    <Td>
                      {lead.nextFollowUpAt ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 text-[0.8125rem]',
                            lead.isFollowUpOverdue && 'font-medium text-danger',
                          )}
                        >
                          {lead.isFollowUpOverdue ? (
                            <AlarmClock aria-hidden className="size-3.5" />
                          ) : null}
                          {formatDate(lead.nextFollowUpAt)}
                          <span className="font-mono text-[0.6875rem] text-ink-faint">
                            {relativeTime(lead.nextFollowUpAt)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[0.8125rem] text-ink-faint">Not scheduled</span>
                      )}
                    </Td>
                    {canWrite ? (
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Move ${lead.companyName}`}
                            onClick={() => setMoving(lead)}
                          >
                            <Move aria-hidden className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${lead.companyName}`}
                            onClick={() => {
                              setEditing(lead);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil aria-hidden className="size-4" />
                          </Button>
                          {canDelete ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Delete ${lead.companyName}`}
                              onClick={() => setDeleting(lead)}
                            >
                              <Trash2 aria-hidden className="size-4" />
                            </Button>
                          ) : null}
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="leads" />
          </>
        )}
      </Panel>

      <LeadFormModal open={formOpen} onClose={() => setFormOpen(false)} lead={editing} />
      {moving ? (
        <ChangeStatusModal key={moving.id} lead={moving} onClose={() => setMoving(null)} />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        loading={deleteLead.isPending}
        destructive
        title="Delete this lead?"
        confirmLabel="Delete lead"
        message={
          deleting
            ? `${deleting.reference} — ${deleting.companyName} will be removed from the pipeline. Its history is kept, and a super admin can restore it.`
            : ''
        }
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteLead.mutateAsync(deleting.id);
            toast.success(`Deleted ${deleting.reference}`);
            setDeleting(null);
          } catch (error) {
            toast.error(toMessage(error));
          }
        }}
      />
    </>
  );
}
