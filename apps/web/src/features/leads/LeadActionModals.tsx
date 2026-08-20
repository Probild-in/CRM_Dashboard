import { useState } from 'react';
import { toast } from 'sonner';
import {
  LeadStatus,
  LOGGABLE_ACTIVITY_TYPES,
  TERMINAL_LEAD_STATUSES,
  type LeadActivityType,
} from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { toMessage } from '@/lib/api';
import { fromDateInput, humanise, toDateTimeInput } from '@/lib/utils';
import { useChangeLeadStatus, useLogActivity } from './api';
import type { Lead } from './types';

/**
 * Moves a lead through the pipeline. A lost lead needs a reason — that is the
 * one field a pipeline review actually depends on.
 */
export function ChangeStatusModal({
  lead,
  onClose,
  initialStatus,
}: {
  /** Render this only when a lead is selected, keyed by `lead.id`, so the
   *  form starts fresh for each one rather than syncing state in an effect. */
  lead: Lead;
  onClose: () => void;
  initialStatus?: LeadStatus;
}) {
  const changeStatus = useChangeLeadStatus();
  const [status, setStatus] = useState<LeadStatus>(initialStatus ?? nextStage(lead.status));
  const [lostReason, setLostReason] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async (): Promise<void> => {
    if (status === LeadStatus.LOST && lostReason.trim() === '') {
      setError('Record why this lead was lost.');
      return;
    }
    try {
      await changeStatus.mutateAsync({
        id: lead.id,
        status,
        ...(status === LeadStatus.LOST ? { lostReason } : {}),
        ...(note ? { note } : {}),
      });
      toast.success(`${lead.reference} moved to ${humanise(status)}`);
      onClose();
    } catch (caught) {
      toast.error(toMessage(caught));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Move this lead"
      description={`${lead.reference} · ${lead.companyName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={changeStatus.isPending}>
            Move lead
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="New stage" htmlFor="newStatus" hint={`Currently ${humanise(lead.status)}.`}>
          <Select
            id="newStatus"
            value={status}
            onChange={(event) => setStatus(event.target.value as LeadStatus)}
          >
            {Object.values(LeadStatus)
              .filter((value) => value !== lead.status)
              .map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
          </Select>
        </Field>

        {status === LeadStatus.LOST ? (
          <Field label="Why was it lost?" htmlFor="lostReason" error={error ?? undefined} required>
            <Input
              id="lostReason"
              value={lostReason}
              onChange={(event) => setLostReason(event.target.value)}
              placeholder="Went with a cheaper agency"
            />
          </Field>
        ) : null}

        <Field label="Note" htmlFor="statusNote" hint="Optional. Added to the lead's history.">
          <Textarea
            id="statusNote"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-20"
          />
        </Field>
      </div>
    </Modal>
  );
}

/** The next stage a lead would normally move to. */
function nextStage(current: LeadStatus): LeadStatus {
  const order: LeadStatus[] = [
    LeadStatus.NEW,
    LeadStatus.CONTACTED,
    LeadStatus.QUALIFIED,
    LeadStatus.MEETING,
    LeadStatus.PROPOSAL,
    LeadStatus.NEGOTIATION,
    LeadStatus.WON,
  ];
  const index = order.indexOf(current);
  if (index === -1 || index === order.length - 1) return LeadStatus.CONTACTED;
  return order[index + 1]!;
}

/**
 * Logs a call, email, meeting, message or note — and sets the next follow-up in
 * the same step, so nobody has to remember to do it separately.
 */
export function LogActivityModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const logActivity = useLogActivity();
  const [type, setType] = useState<LeadActivityType>('CALL');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [followUp, setFollowUp] = useState(() => toDateTimeInput(lead.nextFollowUpAt));
  const [error, setError] = useState<string | null>(null);

  const isClosed = TERMINAL_LEAD_STATUSES.includes(lead.status);

  const onConfirm = async (): Promise<void> => {
    if (title.trim() === '') {
      setError('Give this entry a title.');
      return;
    }
    try {
      await logActivity.mutateAsync({
        id: lead.id,
        type,
        title,
        ...(body ? { body } : {}),
        nextFollowUpAt: fromDateInput(followUp),
      });
      toast.success('Activity logged');
      onClose();
    } catch (caught) {
      toast.error(toMessage(caught));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Log activity"
      description={`${lead.reference} · ${lead.companyName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={logActivity.isPending}>
            Log it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What happened" htmlFor="activityType">
            <Select
              id="activityType"
              value={type}
              onChange={(event) => setType(event.target.value as LeadActivityType)}
            >
              {LOGGABLE_ACTIVITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Next follow-up"
            htmlFor="activityFollowUp"
            hint={isClosed ? 'This lead is closed.' : 'Leave empty to clear it.'}
          >
            <Input
              id="activityFollowUp"
              type="datetime-local"
              value={followUp}
              disabled={isClosed}
              onChange={(event) => setFollowUp(event.target.value)}
            />
          </Field>
        </div>

        <Field label="Title" htmlFor="activityTitle" error={error ?? undefined} required>
          <Input
            id="activityTitle"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Intro call with the founder"
          />
        </Field>

        <Field label="Details" htmlFor="activityBody">
          <Textarea
            id="activityBody"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="What was discussed, and what happens next"
          />
        </Field>
      </div>
    </Modal>
  );
}
