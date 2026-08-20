import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Currency } from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useServices } from '@/features/leads/api';
import { useClients } from '@/features/clients/api';
import { toMessage } from '@/lib/api';
import { cn, formatMoney, toDateInput } from '@/lib/utils';
import {
  previewTotals,
  useCreateQuotation,
  useUpdateQuotation,
  type QuotationItemBody,
} from './api';
import type { Quotation } from './types';

interface DraftItem extends QuotationItemBody {
  /** Local key only — line items have no id until the server stores them. */
  key: string;
}

const EMPTY_LINE = (): DraftItem => ({
  key: Math.random().toString(36).slice(2),
  serviceId: null,
  description: '',
  quantity: 1,
  unitPrice: 0,
  discountPercent: 0,
});

export function QuotationBuilder({
  open,
  onClose,
  quotation,
  fixedClientId,
}: {
  open: boolean;
  onClose: () => void;
  /** Present when revising an existing quotation. */
  quotation?: Quotation | null;
  /** Locks the recipient when opened from a client profile. */
  fixedClientId?: string;
}) {
  const isEdit = Boolean(quotation);
  const createQuotation = useCreateQuotation();
  const updateQuotation = useUpdateQuotation();
  const services = useServices();
  const clients = useClients({ page: 1, pageSize: 100 });

  const [title, setTitle] = useState(quotation?.title ?? '');
  const [clientId, setClientId] = useState(quotation?.client?.id ?? fixedClientId ?? '');
  const [currency, setCurrency] = useState<Currency>(quotation?.currency ?? Currency.INR);
  const [issueDate, setIssueDate] = useState(
    toDateInput(quotation?.issueDate ?? new Date().toISOString()),
  );
  const [validUntil, setValidUntil] = useState(toDateInput(quotation?.validUntil));
  const [discountAmount, setDiscountAmount] = useState(String(quotation?.discountAmount ?? 0));
  const [taxPercent, setTaxPercent] = useState(String(quotation?.taxPercent ?? 18));
  const [paymentTerms, setPaymentTerms] = useState(
    quotation?.paymentTerms ?? '50% advance, 50% on delivery',
  );
  const [notes, setNotes] = useState(quotation?.notes ?? '');
  const [changeReason, setChangeReason] = useState('');
  const [items, setItems] = useState<DraftItem[]>(
    quotation
      ? quotation.items.map((item) => ({
          key: item.id,
          serviceId: item.service?.id ?? null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountPercent: item.discountPercent,
        }))
      : [EMPTY_LINE()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const totals = previewTotals(items, Number(discountAmount) || 0, Number(taxPercent) || 0);
  const pending = createQuotation.isPending || updateQuotation.isPending;

  const patchItem = (key: string, patch: Partial<DraftItem>): void => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const onSubmit = async (): Promise<void> => {
    const nextErrors: Record<string, string> = {};
    if (title.trim() === '') nextErrors.title = 'Give the quotation a title.';
    if (!clientId) nextErrors.clientId = 'Choose who this is for.';
    if (items.length === 0) nextErrors.items = 'Add at least one line.';
    if (items.some((item) => item.description.trim() === ''))
      nextErrors.items = 'Every line needs a description.';
    if (validUntil && issueDate && validUntil < issueDate)
      nextErrors.validUntil = 'Validity cannot be before the issue date.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const body = {
      title,
      currency,
      issueDate,
      validUntil: validUntil || null,
      discountAmount: Number(discountAmount) || 0,
      taxPercent: Number(taxPercent) || 0,
      paymentTerms,
      notes,
      items: items.map(({ key: _key, ...item }) => item),
    };

    try {
      if (isEdit && quotation) {
        await updateQuotation.mutateAsync({
          id: quotation.id,
          ...body,
          ...(changeReason ? { changeReason } : {}),
        });
        toast.success(`Revised ${quotation.reference}`);
      } else {
        const created = await createQuotation.mutateAsync({ ...body, clientId });
        toast.success(`Created ${created.reference}`);
      }
      onClose();
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? `Revise ${quotation?.reference}` : 'New quotation'}
      description={
        isEdit
          ? 'The previous figure is kept in the pricing history.'
          : 'Totals are calculated as you type and confirmed by the server on save.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={pending}>
            {isEdit ? 'Save revision' : 'Create quotation'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="quotationTitle" error={errors.title} required>
            <Input
              id="quotationTitle"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Website design and build"
            />
          </Field>
          <Field label="For" htmlFor="quotationClient" error={errors.clientId} required>
            <Select
              id="quotationClient"
              value={clientId}
              disabled={isEdit || Boolean(fixedClientId)}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">Choose a client</option>
              {clients.data?.items.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.companyName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Issue date" htmlFor="issueDate" required>
            <Input
              id="issueDate"
              type="date"
              value={issueDate}
              onChange={(event) => setIssueDate(event.target.value)}
            />
          </Field>
          <Field
            label="Valid until"
            htmlFor="validUntil"
            error={errors.validUntil}
            hint="You will be reminded before it expires."
          >
            <Input
              id="validUntil"
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          </Field>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Line items</p>
            <Select
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
              aria-label="Currency"
              className="h-8 w-auto text-xs"
            >
              {Object.values(Currency).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>

          {errors.items ? <p className="mb-2 text-xs text-danger">{errors.items}</p> : null}

          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="bg-panel-muted">
                  <th className="eyebrow px-3 py-2 text-left">Description</th>
                  <th className="eyebrow w-20 px-2 py-2 text-right">Qty</th>
                  <th className="eyebrow w-32 px-2 py-2 text-right">Unit price</th>
                  <th className="eyebrow w-20 px-2 py-2 text-right">Disc %</th>
                  <th className="eyebrow w-32 px-3 py-2 text-right">Line total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key} className="border-t border-line">
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        <Input
                          value={item.description}
                          onChange={(event) =>
                            patchItem(item.key, { description: event.target.value })
                          }
                          placeholder="What is being delivered"
                          aria-label="Line description"
                          className="h-8"
                        />
                        <Select
                          value={item.serviceId ?? ''}
                          onChange={(event) => {
                            const serviceId = event.target.value || null;
                            const service = services.data?.find((entry) => entry.id === serviceId);
                            patchItem(item.key, {
                              serviceId,
                              // Picking a service names the line, unless it is already named.
                              description:
                                item.description === '' && service
                                  ? service.name
                                  : item.description,
                            });
                          }}
                          aria-label="Service"
                          className="h-7 text-xs"
                        >
                          <option value="">No service linked</option>
                          {services.data?.map((service) => (
                            <option key={service.id} value={service.id}>
                              {service.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Input
                        type="number"
                        min="0.01"
                        step="0.5"
                        value={item.quantity}
                        onChange={(event) =>
                          patchItem(item.key, { quantity: Number(event.target.value) })
                        }
                        aria-label="Quantity"
                        className="tabular h-8 text-right"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Input
                        type="number"
                        min="0"
                        step="500"
                        value={item.unitPrice}
                        onChange={(event) =>
                          patchItem(item.key, { unitPrice: Number(event.target.value) })
                        }
                        aria-label="Unit price"
                        className="tabular h-8 text-right"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={item.discountPercent}
                        onChange={(event) =>
                          patchItem(item.key, { discountPercent: Number(event.target.value) })
                        }
                        aria-label="Discount percent"
                        className="tabular h-8 text-right"
                      />
                    </td>
                    <td className="tabular px-3 py-2 text-right align-top font-mono text-[0.8125rem] text-ink">
                      <span className="inline-block pt-2">
                        {formatMoney(
                          Math.round(
                            item.quantity * item.unitPrice * (1 - item.discountPercent / 100) * 100,
                          ) / 100,
                          currency,
                        )}
                      </span>
                    </td>
                    <td className="px-1 py-2 align-top">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1"
                        disabled={items.length === 1}
                        aria-label="Remove line"
                        onClick={() =>
                          setItems((current) => current.filter((row) => row.key !== item.key))
                        }
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => setItems((current) => [...current, EMPTY_LINE()])}
          >
            <Plus aria-hidden className="size-4" />
            Add line
          </Button>
        </section>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Field label={`Discount (${currency})`} htmlFor="discountAmount">
              <Input
                id="discountAmount"
                type="number"
                min="0"
                step="1000"
                value={discountAmount}
                onChange={(event) => setDiscountAmount(event.target.value)}
                className="tabular"
              />
            </Field>
            <Field label="Tax %" htmlFor="taxPercent" hint="GST is 18% for most Probild services.">
              <Input
                id="taxPercent"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={taxPercent}
                onChange={(event) => setTaxPercent(event.target.value)}
                className="tabular"
              />
            </Field>
          </div>

          <dl className="flex flex-col gap-2 self-start rounded-md border border-line bg-panel-muted px-4 py-3.5">
            <TotalRow label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
            <TotalRow
              label="Discount"
              value={`− ${formatMoney(totals.discountAmount, currency)}`}
            />
            <TotalRow
              label={`Tax (${Number(taxPercent) || 0}%)`}
              value={formatMoney(totals.taxAmount, currency)}
            />
            <div className="mt-1 border-t border-line pt-2">
              <TotalRow label="Total" value={formatMoney(totals.total, currency)} emphasis />
            </div>
          </dl>
        </div>

        {isEdit ? (
          <Field
            label="Why is this changing?"
            htmlFor="changeReason"
            hint="Kept with the old and new figures in the pricing history."
          >
            <Input
              id="changeReason"
              value={changeReason}
              onChange={(event) => setChangeReason(event.target.value)}
              placeholder="Client negotiated the build down"
            />
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment terms" htmlFor="paymentTerms">
            <Textarea
              id="paymentTerms"
              value={paymentTerms}
              onChange={(event) => setPaymentTerms(event.target.value)}
              className="min-h-20"
            />
          </Field>
          <Field label="Notes" htmlFor="quotationNotes">
            <Textarea
              id="quotationNotes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-20"
              placeholder="Anything the client should read alongside the price"
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TotalRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cn('text-[0.8125rem]', emphasis ? 'font-medium text-ink' : 'text-ink-faint')}>
        {label}
      </dt>
      <dd
        className={cn(
          'tabular font-mono',
          emphasis ? 'text-[0.9375rem] font-semibold text-ink' : 'text-[0.8125rem] text-ink-soft',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
