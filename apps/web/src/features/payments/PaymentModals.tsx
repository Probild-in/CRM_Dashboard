import { useState } from 'react';
import { toast } from 'sonner';
import { Currency, PaymentMethod } from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useClients } from '@/features/clients/api';
import { useProjects } from '@/features/projects/api';
import { toMessage } from '@/lib/api';
import { formatMoney, fromDateInput, humanise, toDateInput } from '@/lib/utils';
import { useCreatePayment, useRecordReceipt, useUpdatePayment } from './api';
import type { Payment } from './types';

export function PaymentFormModal({
  onClose,
  payment,
  fixedClientId,
}: {
  onClose: () => void;
  payment?: Payment | null;
  fixedClientId?: string;
}) {
  const isEdit = Boolean(payment);
  const createPayment = useCreatePayment();
  const updatePayment = useUpdatePayment();
  const clients = useClients({ page: 1, pageSize: 100 });

  const [clientId, setClientId] = useState(payment?.client.id ?? fixedClientId ?? '');
  const [title, setTitle] = useState(payment?.title ?? '');
  const [amount, setAmount] = useState(String(payment?.amount ?? ''));
  const [currency, setCurrency] = useState<Currency>(payment?.currency ?? Currency.INR);
  const [dueDate, setDueDate] = useState(toDateInput(payment?.dueDate));
  const [projectId, setProjectId] = useState(payment?.project?.id ?? '');
  const [notes, setNotes] = useState(payment?.notes ?? '');
  const [amountChangeReason, setAmountChangeReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const projects = useProjects({ page: 1, pageSize: 100, clientId: clientId || undefined });
  const pending = createPayment.isPending || updatePayment.isPending;
  const amountChanged = isEdit && Number(amount) !== payment?.amount;

  const onSubmit = async (): Promise<void> => {
    const next: Record<string, string> = {};
    if (!clientId) next.clientId = 'Choose the client this is for.';
    if (title.trim() === '') next.title = 'Give the payment a title.';
    if (!amount || Number(amount) <= 0) next.amount = 'Enter an amount.';
    if (isEdit && payment && Number(amount) < payment.paidAmount) {
      next.amount = `Already received ${formatMoney(payment.paidAmount, payment.currency)}.`;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      if (isEdit && payment) {
        await updatePayment.mutateAsync({
          id: payment.id,
          title,
          amount: Number(amount),
          currency,
          dueDate: fromDateInput(dueDate),
          projectId: projectId || null,
          notes,
          ...(amountChanged && amountChangeReason ? { amountChangeReason } : {}),
        });
        toast.success(`Saved ${payment.reference}`);
      } else {
        const created = await createPayment.mutateAsync({
          clientId,
          title,
          amount: Number(amount),
          currency,
          dueDate: fromDateInput(dueDate),
          projectId: projectId || null,
          notes,
        });
        toast.success(`Raised ${created.reference}`);
      }
      onClose();
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${payment?.reference}` : 'Raise a payment'}
      description={
        isEdit
          ? 'Record receipts separately — this changes what is owed.'
          : 'What the client owes and when. Probild will remind you before it falls due.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={pending}>
            {isEdit ? 'Save payment' : 'Raise it'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Client" htmlFor="paymentClient" error={errors.clientId} required>
          <Select
            id="paymentClient"
            value={clientId}
            disabled={isEdit || Boolean(fixedClientId)}
            onChange={(event) => {
              setClientId(event.target.value);
              setProjectId('');
            }}
          >
            <option value="">Choose a client</option>
            {clients.data?.items.map((client) => (
              <option key={client.id} value={client.id}>
                {client.companyName}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="What it is for" htmlFor="paymentTitle" error={errors.title} required>
          <Input
            id="paymentTitle"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="50% advance — website build"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount" htmlFor="paymentAmount" error={errors.amount} required>
            <Input
              id="paymentAmount"
              type="number"
              min="0"
              step="1000"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="tabular"
            />
          </Field>
          <Field label="Currency" htmlFor="paymentCurrency">
            <Select
              id="paymentCurrency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              {Object.values(Currency).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" htmlFor="paymentDue" hint="You will be reminded before it.">
            <Input
              id="paymentDue"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          <Field label="Against a project" htmlFor="paymentProject">
            <Select
              id="paymentProject"
              value={projectId}
              disabled={!clientId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Not project-specific</option>
              {projects.data?.items.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {amountChanged ? (
          <Field
            label="Why is the amount changing?"
            htmlFor="paymentReason"
            hint="Kept with the old and new figures."
          >
            <Input
              id="paymentReason"
              value={amountChangeReason}
              onChange={(event) => setAmountChangeReason(event.target.value)}
              placeholder="Extra scope agreed with the client"
            />
          </Field>
        ) : null}

        <Field label="Notes" htmlFor="paymentNotes">
          <Textarea
            id="paymentNotes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Money arriving.
 *
 * Additive: the amount defaults to what is still outstanding, and each receipt
 * is added to what came before rather than replacing it.
 */
export function RecordReceiptModal({
  payment,
  onClose,
}: {
  payment: Payment;
  onClose: () => void;
}) {
  const recordReceipt = useRecordReceipt();

  const [amount, setAmount] = useState(String(payment.outstanding));
  const [paidAt, setPaidAt] = useState(toDateInput(new Date().toISOString()));
  const [method, setMethod] = useState<PaymentMethod | ''>(payment.method ?? '');
  const [transactionRef, setTransactionRef] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter the amount received.');
      return;
    }
    if (value > payment.outstanding) {
      setError(`Only ${formatMoney(payment.outstanding, payment.currency)} is outstanding.`);
      return;
    }

    try {
      const updated = await recordReceipt.mutateAsync({
        id: payment.id,
        amount: value,
        paidAt: fromDateInput(paidAt) ?? undefined,
        method: method || null,
        ...(transactionRef ? { transactionRef } : {}),
      });
      toast.success(
        updated.outstanding === 0
          ? `${payment.reference} settled in full`
          : `Recorded ${formatMoney(value, payment.currency)} — ${formatMoney(updated.outstanding, payment.currency)} still outstanding`,
      );
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
      title="Record a receipt"
      description={`${payment.reference} · ${payment.client.companyName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={recordReceipt.isPending}>
            Record it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 rounded-md border border-line bg-panel-muted px-4 py-3">
          <Row label="Billed">{formatMoney(payment.amount, payment.currency)}</Row>
          <Row label="Received so far">{formatMoney(payment.paidAmount, payment.currency)}</Row>
          <Row label="Outstanding" emphasis>
            {formatMoney(payment.outstanding, payment.currency)}
          </Row>
        </dl>

        <Field label="Amount received" htmlFor="receiptAmount" error={error ?? undefined} required>
          <Input
            id="receiptAmount"
            type="number"
            min="0"
            step="1000"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="tabular"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received on" htmlFor="receiptDate">
            <Input
              id="receiptDate"
              type="date"
              value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}
            />
          </Field>
          <Field label="How" htmlFor="receiptMethod">
            <Select
              id="receiptMethod"
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod | '')}
            >
              <option value="">Not recorded</option>
              {Object.values(PaymentMethod).map((entry) => (
                <option key={entry} value={entry}>
                  {humanise(entry)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Reference"
          htmlFor="receiptRef"
          hint="The UTR, cheque number or transaction id."
        >
          <Input
            id="receiptRef"
            value={transactionRef}
            onChange={(event) => setTransactionRef(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function Row({
  label,
  children,
  emphasis = false,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={emphasis ? 'text-[0.8125rem] font-medium text-ink' : 'text-[0.8125rem] text-ink-faint'}>
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? 'tabular font-mono text-[0.9375rem] font-semibold text-ink'
            : 'tabular font-mono text-[0.8125rem] text-ink-soft'
        }
      >
        {children}
      </dd>
    </div>
  );
}
