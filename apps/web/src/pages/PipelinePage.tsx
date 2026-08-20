import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { LeadStatus, PERMISSIONS, type Currency } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { PRIORITY_TONES } from '@/components/ui/tones';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { ChangeStatusModal } from '@/features/leads/LeadActionModals';
import { useChangeLeadStatus, usePipeline } from '@/features/leads/api';
import type { Lead, PipelineStage } from '@/features/leads/types';
import { toMessage } from '@/lib/api';
import { cn, formatMoney, humanise, relativeTime } from '@/lib/utils';

export default function PipelinePage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.LEAD_WRITE);

  const [owner, setOwner] = useState('');
  const [dragging, setDragging] = useState<Lead | null>(null);
  const [dropTarget, setDropTarget] = useState<LeadStatus | null>(null);
  /** A lead dropped on Lost needs a reason, so it opens the move dialog instead. */
  const [needsReason, setNeedsReason] = useState<{ lead: Lead; status: LeadStatus } | null>(null);

  const team = useUsers({ page: 1, pageSize: 100 });
  const board = usePipeline(owner || undefined);
  const changeStatus = useChangeLeadStatus();

  const onDrop = async (status: LeadStatus): Promise<void> => {
    const lead = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!lead || lead.status === status) return;

    if (status === LeadStatus.LOST) {
      setNeedsReason({ lead, status });
      return;
    }

    try {
      await changeStatus.mutateAsync({ id: lead.id, status });
      toast.success(`${lead.reference} moved to ${humanise(status)}`);
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Sales board"
        description="Drag a lead to move it. Every move is written to its history."
        action={
          <Select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            aria-label="Filter by owner"
            className="h-9 w-auto"
          >
            <option value="">Whole team</option>
            {team.data?.items.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </Select>
        }
      />

      {board.isPending ? (
        <LoadingState label="Loading the board" />
      ) : board.isError ? (
        <div className="rounded-panel border border-line bg-panel">
          <ErrorState message={toMessage(board.error)} onRetry={() => void board.refetch()} />
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-3">
            <ClosedTotal label="Won" stage={board.data.closed.won} tone="success" />
            <ClosedTotal label="Lost" stage={board.data.closed.lost} tone="danger" />
          </div>

          {/* The board scrolls sideways on its own; the page never does. */}
          <div className="-mx-4 overflow-x-auto px-4 pb-3 lg:-mx-6 lg:px-6">
            <div className="flex min-w-max gap-3">
              {board.data.stages.map((stage) => (
                <Column
                  key={stage.status}
                  stage={stage}
                  canWrite={canWrite}
                  isDropTarget={dropTarget === stage.status}
                  onDragEnter={() => canWrite && setDropTarget(stage.status)}
                  onDrop={() => void onDrop(stage.status)}
                  onDragStart={setDragging}
                  draggingId={dragging?.id ?? null}
                />
              ))}

              {canWrite ? (
                <div className="flex w-16 shrink-0 flex-col gap-3">
                  <DropZone
                    label="Won"
                    tone="success"
                    active={dropTarget === LeadStatus.WON}
                    onDragEnter={() => setDropTarget(LeadStatus.WON)}
                    onDrop={() => void onDrop(LeadStatus.WON)}
                  />
                  <DropZone
                    label="Lost"
                    tone="danger"
                    active={dropTarget === LeadStatus.LOST}
                    onDragEnter={() => setDropTarget(LeadStatus.LOST)}
                    onDrop={() => void onDrop(LeadStatus.LOST)}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}

      {needsReason ? (
        <ChangeStatusModal
          key={needsReason.lead.id}
          lead={needsReason.lead}
          initialStatus={needsReason.status}
          onClose={() => setNeedsReason(null)}
        />
      ) : null}
    </>
  );
}

function Column({
  stage,
  canWrite,
  isDropTarget,
  draggingId,
  onDragStart,
  onDragEnter,
  onDrop,
}: {
  stage: PipelineStage;
  canWrite: boolean;
  isDropTarget: boolean;
  draggingId: string | null;
  onDragStart: (lead: Lead) => void;
  onDragEnter: () => void;
  onDrop: () => void;
}) {
  return (
    <section
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-panel border bg-panel-muted transition-colors',
        isDropTarget ? 'border-accent bg-accent-soft' : 'border-line',
      )}
      onDragOver={(event) => {
        if (!canWrite) return;
        event.preventDefault();
        onDragEnter();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-[0.8125rem] font-semibold text-ink">
            {humanise(stage.status)}
          </h2>
          <span className="tabular font-mono text-xs text-ink-faint">{stage.count}</span>
        </div>
        <p className="tabular mt-1 font-mono text-[0.6875rem] text-ink-faint">
          {formatStageValue(stage.value)}
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-2 p-2.5">
        {stage.leads.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-faint">
            {isDropTarget ? 'Drop to move here' : 'Nothing at this stage'}
          </p>
        ) : (
          stage.leads.map((lead) => (
            <article
              key={lead.id}
              draggable={canWrite}
              onDragStart={() => onDragStart(lead)}
              className={cn(
                'rounded-md border border-line bg-panel p-3 transition-opacity',
                canWrite && 'cursor-grab active:cursor-grabbing',
                draggingId === lead.id && 'opacity-40',
                lead.isFollowUpOverdue && 'edge-marker text-danger',
              )}
            >
              <Link to={`/leads/${lead.id}`} className="block">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-[0.8125rem] font-medium text-ink hover:text-accent">
                    {lead.companyName}
                  </p>
                  <Badge tone={PRIORITY_TONES[lead.priority] ?? 'neutral'}>{lead.priority}</Badge>
                </div>
                <p className="tabular mt-1.5 font-mono text-xs text-ink-soft">
                  {formatMoney(lead.expectedValue, lead.currency)}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[0.625rem] text-ink-faint">
                    {lead.reference}
                  </span>
                  {lead.nextFollowUpAt ? (
                    <span
                      className={cn(
                        'font-mono text-[0.625rem]',
                        lead.isFollowUpOverdue ? 'font-medium text-danger' : 'text-ink-faint',
                      )}
                    >
                      {relativeTime(lead.nextFollowUpAt)}
                    </span>
                  ) : null}
                </div>
              </Link>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function DropZone({
  label,
  tone,
  active,
  onDragEnter,
  onDrop,
}: {
  label: string;
  tone: 'success' | 'danger';
  active: boolean;
  onDragEnter: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        onDragEnter();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={cn(
        'flex flex-1 items-center justify-center rounded-panel border border-dashed text-center',
        tone === 'success' ? 'border-success/45' : 'border-danger/45',
        active && (tone === 'success' ? 'bg-success-soft' : 'bg-danger-soft'),
      )}
    >
      <span
        className={cn(
          'font-mono text-[0.6875rem] tracking-widest uppercase [writing-mode:vertical-rl]',
          tone === 'success' ? 'text-success' : 'text-danger',
        )}
      >
        {label}
      </span>
    </div>
  );
}

function ClosedTotal({
  label,
  stage,
  tone,
}: {
  label: string;
  stage: PipelineStage;
  tone: 'success' | 'danger';
}) {
  return (
    <div
      className={cn(
        'edge-marker rounded-r border border-line bg-panel py-2.5 pr-4 pl-4',
        tone === 'success' ? 'text-success' : 'text-danger',
      )}
    >
      <p className="eyebrow">{label}</p>
      <p className="tabular mt-1 font-display text-lg font-semibold text-ink">
        {stage.count}
        <span className="ml-2 font-mono text-xs font-normal text-ink-faint">
          {formatStageValue(stage.value)}
        </span>
      </p>
    </div>
  );
}

/** Currencies are shown side by side. Adding INR to USD would be a lie. */
function formatStageValue(value: Record<Currency, number>): string {
  const parts = (Object.entries(value) as Array<[Currency, number]>)
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => formatMoney(amount, currency));
  return parts.length > 0 ? parts.join(' · ') : '—';
}
