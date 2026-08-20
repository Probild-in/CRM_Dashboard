import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useUsers } from '@/features/users/api';
import type { Lead } from '@/features/leads/types';
import { toMessage } from '@/lib/api';
import { formatMoney } from '@/lib/utils';
import { useConvertLead } from './api';

/**
 * Turns a won lead into a client.
 *
 * Everything is prefilled from the lead, so the normal path is to read it and
 * confirm. The lead itself is kept and linked — it is the record of how the
 * client was won.
 */
export function ConvertLeadModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const navigate = useNavigate();
  const convertLead = useConvertLead();
  const team = useUsers({ page: 1, pageSize: 100 });

  const [companyName, setCompanyName] = useState(lead.companyName);
  const [accountManagerId, setAccountManagerId] = useState(lead.assignedTo?.id ?? '');
  const [createDeal, setCreateDeal] = useState(true);
  const [dealValue, setDealValue] = useState(
    lead.expectedValue === null ? '' : String(lead.expectedValue),
  );
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async (): Promise<void> => {
    if (companyName.trim() === '') {
      setError('Enter the company name.');
      return;
    }
    try {
      const result = await convertLead.mutateAsync({
        leadId: lead.id,
        companyName,
        accountManagerId: accountManagerId || null,
        createDeal,
        dealValue: dealValue === '' ? null : Number(dealValue),
      });
      toast.success(`${lead.reference} is now client ${result.client.reference}`);
      onClose();
      navigate(`/clients/${result.client.id}`);
    } catch (caught) {
      toast.error(toMessage(caught));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Convert to client"
      description={`${lead.reference} · ${lead.companyName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void onConfirm()} loading={convertLead.isPending}>
            Create client
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="edge-marker rounded-r bg-accent-soft py-2.5 pr-3 pl-3.5 text-[0.8125rem] text-accent">
          The lead stays where it is and links to the new client, so the pipeline history is kept.
        </p>

        <Field label="Client name" htmlFor="convertName" error={error ?? undefined} required>
          <Input
            id="convertName"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
          />
        </Field>

        <Field
          label="Account manager"
          htmlFor="convertManager"
          hint="Defaults to whoever owned the lead."
        >
          <Select
            id="convertManager"
            value={accountManagerId}
            onChange={(event) => setAccountManagerId(event.target.value)}
          >
            <option value="">Nobody yet</option>
            {team.data?.items.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex items-start gap-2.5 rounded-md border border-line px-3.5 py-3">
          <input
            type="checkbox"
            checked={createDeal}
            onChange={(event) => setCreateDeal(event.target.checked)}
            className="mt-0.5 size-4 accent-[var(--app-accent)]"
          />
          <span>
            <span className="block text-[0.8125rem] font-medium text-ink">
              Open a won deal for this
            </span>
            <span className="block text-xs text-ink-faint">
              Records the value Probild won, ready for a project and payments.
            </span>
          </span>
        </label>

        {createDeal ? (
          <Field
            label={`Deal value (${lead.currency})`}
            htmlFor="convertValue"
            hint={
              lead.expectedValue === null
                ? 'The lead had no value set.'
                : `The lead expected ${formatMoney(lead.expectedValue, lead.currency)}.`
            }
          >
            <Input
              id="convertValue"
              type="number"
              min="0"
              step="1000"
              value={dealValue}
              onChange={(event) => setDealValue(event.target.value)}
              className="tabular"
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
