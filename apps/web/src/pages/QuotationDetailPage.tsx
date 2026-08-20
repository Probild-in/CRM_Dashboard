import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, QuotationStatus } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { QUOTATION_STATUS_TONES } from '@/components/ui/tones';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { TableWrap, Td, Th } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthContext';
import { QuotationBuilder } from '@/features/quotations/QuotationBuilder';
import { DocumentsPanel } from '@/features/documents/DocumentsPanel';
import { SendDocumentModal } from '@/features/documents/SendDocumentModal';
import { useGenerateDocument, type StoredDocument } from '@/features/documents/api';
import {
  useChangeQuotationStatus,
  usePricingHistory,
  useQuotation,
} from '@/features/quotations/api';
import { toMessage } from '@/lib/api';
import { cn, formatDate, formatDateTime, formatMoney, humanise } from '@/lib/utils';

/** Mirrors the server's transition table so the picker only offers real moves. */
const NEXT_STATUSES: Record<QuotationStatus, QuotationStatus[]> = {
  DRAFT: [QuotationStatus.SENT],
  SENT: [
    QuotationStatus.VIEWED,
    QuotationStatus.NEGOTIATION,
    QuotationStatus.ACCEPTED,
    QuotationStatus.REJECTED,
    QuotationStatus.EXPIRED,
  ],
  VIEWED: [
    QuotationStatus.NEGOTIATION,
    QuotationStatus.ACCEPTED,
    QuotationStatus.REJECTED,
    QuotationStatus.EXPIRED,
  ],
  NEGOTIATION: [
    QuotationStatus.SENT,
    QuotationStatus.ACCEPTED,
    QuotationStatus.REJECTED,
    QuotationStatus.EXPIRED,
  ],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [QuotationStatus.NEGOTIATION],
};

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.QUOTATION_WRITE);

  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<QuotationStatus | ''>('');
  const [sendingDocument, setSendingDocument] = useState<StoredDocument | null>(null);
  const generateDocument = useGenerateDocument();

  const quotation = useQuotation(id);
  const history = usePricingHistory(id);
  const changeStatus = useChangeQuotationStatus();

  if (quotation.isPending) return <LoadingState label="Loading quotation" />;
  if (quotation.isError) {
    return (
      <Panel>
        <ErrorState
          title="This quotation did not load"
          message={toMessage(quotation.error)}
          onRetry={() => void quotation.refetch()}
        />
      </Panel>
    );
  }

  const record = quotation.data;
  const moves = NEXT_STATUSES[record.status];
  const isLocked = record.status === 'ACCEPTED' || record.status === 'REJECTED';

  const onChangeStatus = async (): Promise<void> => {
    if (!nextStatus) return;
    try {
      await changeStatus.mutateAsync({ id: record.id, status: nextStatus });
      toast.success(`${record.reference} moved to ${humanise(nextStatus)}`);
      setStatusOpen(false);
      setNextStatus('');
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <>
      <Link
        to="/quotations"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-faint hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All quotations
      </Link>

      <PageHeader
        eyebrow={record.reference}
        title={record.title}
        description={
          record.client
            ? `For ${record.client.companyName}`
            : record.lead
              ? `For ${record.lead.companyName} (lead)`
              : undefined
        }
        action={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={generateDocument.isPending}
                onClick={async () => {
                  try {
                    // Draw the current version, then open the covering note.
                    const document = await generateDocument.mutateAsync({
                      source: 'QUOTATION',
                      sourceId: record.id,
                    });
                    setSendingDocument(document);
                  } catch (error) {
                    toast.error(toMessage(error));
                  }
                }}
              >
                <Send aria-hidden className="size-4" />
                Send to client
              </Button>
              {moves.length > 0 ? (
                <Button variant="secondary" onClick={() => setStatusOpen(true)}>
                  <ArrowRight aria-hidden className="size-4" />
                  Move status
                </Button>
              ) : null}
              {!isLocked ? (
                <Button variant="primary" onClick={() => setEditOpen(true)}>
                  <Pencil aria-hidden className="size-4" />
                  Revise
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={QUOTATION_STATUS_TONES[record.status] ?? 'neutral'}>
          {humanise(record.status)}
        </Badge>
        {record.isExpired ? <Badge tone="danger">Past its validity date</Badge> : null}
        {record.deal ? <Badge tone="accent">Deal {record.deal.reference}</Badge> : null}
      </div>

      {isLocked ? (
        <p className="edge-marker mb-5 rounded-r bg-neutral-soft py-2.5 pr-4 pl-4 text-sm text-ink-soft">
          This quotation was {record.status.toLowerCase()} on {formatDate(record.decidedAt)} and is
          kept as it stands. Create a new one to quote again.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader eyebrow="What is being quoted" title="Line items" />
            <TableWrap>
              <thead>
                <tr>
                  <Th>Description</Th>
                  <Th align="right">Qty</Th>
                  <Th align="right">Unit price</Th>
                  <Th align="right">Disc</Th>
                  <Th align="right">Line total</Th>
                </tr>
              </thead>
              <tbody>
                {record.items.map((item) => (
                  <tr key={item.id}>
                    <Td>
                      <span className="block text-[0.8125rem] text-ink">{item.description}</span>
                      {item.service ? (
                        <span className="block font-mono text-[0.625rem] text-ink-faint">
                          {item.service.name}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem]">
                      {item.quantity}
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem]">
                      {formatMoney(item.unitPrice, record.currency)}
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem]">
                      {item.discountPercent > 0 ? `${item.discountPercent}%` : '—'}
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem] text-ink">
                      {formatMoney(item.lineTotal, record.currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>

            <dl className="flex flex-col gap-2 border-t border-line px-5 py-4">
              <TotalRow label="Subtotal" value={formatMoney(record.subtotal, record.currency)} />
              {record.discountAmount > 0 ? (
                <TotalRow
                  label="Discount"
                  value={`− ${formatMoney(record.discountAmount, record.currency)}`}
                />
              ) : null}
              <TotalRow
                label={`Tax (${record.taxPercent}%)`}
                value={formatMoney(record.taxAmount, record.currency)}
              />
              <div className="mt-1 border-t border-line pt-2">
                <TotalRow label="Total" value={formatMoney(record.total, record.currency)} emphasis />
              </div>
            </dl>
          </Panel>

          {record.paymentTerms || record.notes ? (
            <Panel>
              <PanelHeader eyebrow="Terms" title="Payment and notes" />
              <PanelBody className="flex flex-col gap-4">
                {record.paymentTerms ? (
                  <div>
                    <p className="eyebrow mb-1">Payment terms</p>
                    <p className="text-sm whitespace-pre-wrap text-ink-soft">
                      {record.paymentTerms}
                    </p>
                  </div>
                ) : null}
                {record.notes ? (
                  <div>
                    <p className="eyebrow mb-1">Notes</p>
                    <p className="text-sm whitespace-pre-wrap text-ink-soft">{record.notes}</p>
                  </div>
                ) : null}
              </PanelBody>
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader eyebrow="Timing" title="Dates" />
            <PanelBody className="flex flex-col gap-3">
              <Row label="Issued">{formatDate(record.issueDate)}</Row>
              <Row label="Valid until">
                <span className={cn(record.isExpired && 'font-medium text-danger')}>
                  {formatDate(record.validUntil)}
                </span>
              </Row>
              <Row label="Sent">{record.sentAt ? formatDateTime(record.sentAt) : '—'}</Row>
              <Row label="Viewed">{record.viewedAt ? formatDateTime(record.viewedAt) : '—'}</Row>
              <Row label="Decided">{record.decidedAt ? formatDateTime(record.decidedAt) : '—'}</Row>
              <Row label="Prepared by">
                {record.createdBy
                  ? `${record.createdBy.firstName} ${record.createdBy.lastName}`
                  : '—'}
              </Row>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Never overwritten" title="Pricing history" />
            {history.isPending ? (
              <LoadingState label="Loading history" />
            ) : history.isError ? (
              <ErrorState message={toMessage(history.error)} />
            ) : (
              <ol className="flex flex-col px-5 py-4">
                {history.data.map((entry, index) => (
                  <li key={entry.id} className="relative flex gap-3.5 pb-4 last:pb-0">
                    {index < history.data.length - 1 ? (
                      <span aria-hidden className="absolute top-4 bottom-0 left-[3px] w-px bg-line" />
                    ) : null}
                    <span
                      aria-hidden
                      className={cn(
                        'relative mt-1.5 size-[7px] shrink-0 rounded-full',
                        index === history.data.length - 1 ? 'bg-accent' : 'bg-line-strong',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="tabular font-mono text-[0.8125rem] text-ink">
                        {entry.previousValue !== null ? (
                          <>
                            <span className="text-ink-faint line-through">
                              {formatMoney(entry.previousValue, entry.currency)}
                            </span>
                            <span className="mx-1.5 text-ink-faint">→</span>
                          </>
                        ) : null}
                        {formatMoney(entry.newValue, entry.currency)}
                      </p>
                      {entry.reason ? (
                        <p className="mt-0.5 text-xs text-ink-soft">{entry.reason}</p>
                      ) : null}
                      <p className="mt-0.5 font-mono text-[0.625rem] text-ink-faint">
                        {formatDateTime(entry.createdAt)}
                        {entry.changedBy
                          ? ` · ${entry.changedBy.firstName} ${entry.changedBy.lastName}`
                          : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-5">
        <DocumentsPanel
          entityType="QUOTATION"
          entityId={record.id}
          clientEmail={record.client ? undefined : null}
          clientName={record.client?.companyName ?? record.lead?.companyName ?? null}
        />
      </div>

      {editOpen ? (
        <QuotationBuilder open onClose={() => setEditOpen(false)} quotation={record} />
      ) : null}

      {sendingDocument ? (
        <SendDocumentModal
          key={sendingDocument.id}
          document={sendingDocument}
          defaultToName={record.client?.companyName ?? record.lead?.companyName ?? null}
          companyName={record.client?.companyName ?? record.lead?.companyName ?? null}
          onClose={() => setSendingDocument(null)}
        />
      ) : null}

      <Modal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        size="sm"
        title="Move this quotation"
        description={`Currently ${humanise(record.status).toLowerCase()}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void onChangeStatus()}
              loading={changeStatus.isPending}
              disabled={!nextStatus}
            >
              Move it
            </Button>
          </>
        }
      >
        <Field
          label="New status"
          htmlFor="quotationStatus"
          hint={
            nextStatus === QuotationStatus.ACCEPTED && record.deal
              ? `Accepting this also wins deal ${record.deal.reference}.`
              : undefined
          }
        >
          <Select
            id="quotationStatus"
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value as QuotationStatus)}
          >
            <option value="">Choose a status</option>
            {moves.map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>
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
          emphasis ? 'text-base font-semibold text-ink' : 'text-[0.8125rem] text-ink-soft',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
