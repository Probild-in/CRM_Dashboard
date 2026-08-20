import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, HandCoins, Pencil, Plus, Send, Wallet } from 'lucide-react';
import { PaymentStatus, PERMISSIONS } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { PAYMENT_STATUS_TONES } from '@/components/ui/tones';
import { BarList, ChartFrame, type BarDatum } from '@/components/charts/BarList';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination, TableWrap, Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/AuthContext';
import { PaymentFormModal, RecordReceiptModal } from '@/features/payments/PaymentModals';
import { usePaymentSummary, usePayments } from '@/features/payments/api';
import { SendDocumentModal } from '@/features/documents/SendDocumentModal';
import { useGenerateDocument, type StoredDocument } from '@/features/documents/api';
import type { Payment } from '@/features/payments/types';
import { toMessage } from '@/lib/api';
import { toast } from 'sonner';
import {
  cn,
  formatDate,
  formatMoney,
  formatMoneyTotals as money,
  humanise,
  relativeTime,
} from '@/lib/utils';

export default function PaymentsPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.PAYMENT_WRITE);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [quickFilter, setQuickFilter] = useState<'outstanding' | 'overdue' | 'all'>('outstanding');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [receipting, setReceipting] = useState<Payment | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<Payment | null>(null);
  const [sendingDocument, setSendingDocument] = useState<StoredDocument | null>(null);
  const generateDocument = useGenerateDocument();

  const summary = usePaymentSummary();
  const query = usePayments({
    page,
    pageSize: 20,
    search,
    status,
    outstandingOnly: quickFilter === 'outstanding',
    overdue: quickFilter === 'overdue',
  });

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const agingData: BarDatum[] =
    summary.data?.aging
      .filter((bucket) => bucket.count > 0)
      .map((bucket) => ({
        key: bucket.bucket,
        label: bucket.bucket,
        value: bucket.value.INR + bucket.value.USD,
        display: money(bucket.value),
        note: `${bucket.count}`,
      })) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Payments"
        description="What has been billed, what has arrived, and what is still owed."
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
              Raise a payment
            </Button>
          ) : null
        }
      />

      <div className="mb-5 grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Billed" value={money(summary.data?.billed ?? {})} hint={`${summary.data?.counts.total ?? 0} raised`} />
        <Metric label="Received" value={money(summary.data?.received ?? {})} hint={`${summary.data?.counts.paid ?? 0} settled`} />
        <Metric
          label="Outstanding"
          value={money(summary.data?.outstanding ?? {})}
          hint={`${summary.data?.counts.outstanding ?? 0} still owed`}
        />
        <Metric
          label="Overdue"
          value={money(summary.data?.overdue ?? {})}
          hint={`${summary.data?.counts.overdue ?? 0} past their date`}
          tone={(summary.data?.counts.overdue ?? 0) > 0 ? 'danger' : undefined}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {[
          { key: 'outstanding', label: 'Still owed', count: summary.data?.counts.outstanding },
          { key: 'overdue', label: 'Overdue', count: summary.data?.counts.overdue },
          { key: 'all', label: 'Everything', count: summary.data?.counts.total },
        ].map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => change(setQuickFilter)(filter.key as typeof quickFilter)}
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

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        <Panel>
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
            <Input
              type="search"
              value={search}
              onChange={(event) => change(setSearch)(event.target.value)}
              placeholder="Title, reference or client"
              aria-label="Search payments"
              className="h-9 max-w-xs"
            />
            <Select
              value={status}
              onChange={(event) => change(setStatus)(event.target.value as PaymentStatus | '')}
              aria-label="Filter by status"
              className="h-9 w-auto"
            >
              <option value="">All statuses</option>
              {Object.values(PaymentStatus).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </div>

          {query.isPending ? (
            <TableSkeleton rows={7} columns={5} />
          ) : query.isError ? (
            <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
          ) : query.data.items.length === 0 ? (
            <EmptyState
              icon={<Wallet aria-hidden className="size-4.5" />}
              title={quickFilter === 'overdue' ? 'Nothing is overdue' : 'No payments here'}
              description={
                quickFilter === 'overdue'
                  ? 'Everything billed is either paid or still within its date.'
                  : 'Raise a payment against a client and Probild tracks it from there.'
              }
              action={
                canWrite && quickFilter !== 'overdue' ? (
                  <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                    <Plus aria-hidden className="size-4" />
                    Raise a payment
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Payment</Th>
                    <Th>Status</Th>
                    <Th align="right">Billed</Th>
                    <Th align="right">Outstanding</Th>
                    <Th>Due</Th>
                    {canWrite ? <Th align="right">Actions</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {query.data.items.map((payment) => (
                    <tr
                      key={payment.id}
                      className={cn(
                        'group transition-colors hover:bg-panel-muted',
                        payment.isOverdue && 'edge-marker-row text-danger',
                      )}
                    >
                      <Td>
                        <Link to={`/clients/${payment.client.id}`} className="block min-w-0">
                          <span className="block truncate text-[0.8125rem] font-medium text-ink group-hover:text-accent">
                            {payment.title}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-faint">
                            {payment.reference} · {payment.client.companyName}
                            {payment.project ? ` · ${payment.project.name}` : ''}
                          </span>
                        </Link>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Badge tone={PAYMENT_STATUS_TONES[payment.status] ?? 'neutral'}>
                            {humanise(payment.status)}
                          </Badge>
                          {payment.isOverdue ? <Badge tone="danger">Late</Badge> : null}
                        </div>
                      </Td>
                      <Td align="right" className="tabular font-mono text-[0.8125rem] whitespace-nowrap">
                        {formatMoney(payment.amount, payment.currency)}
                      </Td>
                      <Td
                        align="right"
                        className={cn(
                          'tabular font-mono text-[0.8125rem] whitespace-nowrap',
                          payment.outstanding > 0 ? 'text-ink' : 'text-ink-faint',
                        )}
                      >
                        {payment.outstanding > 0
                          ? formatMoney(payment.outstanding, payment.currency)
                          : '—'}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {payment.dueDate ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap',
                              payment.isOverdue && 'font-medium text-danger',
                            )}
                          >
                            {payment.isOverdue ? (
                              <AlarmClock aria-hidden className="size-3.5" />
                            ) : null}
                            {formatDate(payment.dueDate)}
                            <span className="font-mono text-[0.6875rem] text-ink-faint">
                              {relativeTime(payment.dueDate)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[0.8125rem] text-ink-faint">No date</span>
                        )}
                      </Td>
                      {canWrite ? (
                        <Td align="right">
                          <div className="flex justify-end gap-1">
                            {payment.outstanding > 0 && payment.status !== PaymentStatus.CANCELLED ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Record a receipt for ${payment.title}`}
                                onClick={() => setReceipting(payment)}
                              >
                                <HandCoins aria-hidden className="size-4" />
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Send the invoice for ${payment.title}`}
                              onClick={async () => {
                                setInvoiceFor(payment);
                                try {
                                  const document = await generateDocument.mutateAsync({
                                    source: 'PAYMENT',
                                    sourceId: payment.id,
                                  });
                                  setSendingDocument(document);
                                } catch (error) {
                                  toast.error(toMessage(error));
                                  setInvoiceFor(null);
                                }
                              }}
                            >
                              <Send aria-hidden className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit ${payment.title}`}
                              onClick={() => {
                                setEditing(payment);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil aria-hidden className="size-4" />
                            </Button>
                          </div>
                        </Td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Pagination meta={query.data.meta} onPageChange={setPage} label="payments" />
            </>
          )}
        </Panel>

        <ChartFrame eyebrow="How late the money is" title="Ageing">
          <BarList data={agingData} emptyMessage="Nothing outstanding." />
        </ChartFrame>
      </div>

      {formOpen ? (
        <PaymentFormModal
          key={editing?.id ?? 'new'}
          onClose={() => setFormOpen(false)}
          payment={editing}
        />
      ) : null}

      {receipting ? (
        <RecordReceiptModal
          key={receipting.id}
          payment={receipting}
          onClose={() => setReceipting(null)}
        />
      ) : null}

      {sendingDocument ? (
        <SendDocumentModal
          key={sendingDocument.id}
          document={sendingDocument}
          defaultToName={invoiceFor?.client.companyName ?? null}
          companyName={invoiceFor?.client.companyName ?? null}
          onClose={() => {
            setSendingDocument(null);
            setInvoiceFor(null);
          }}
        />
      ) : null}
    </>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'danger';
}) {
  return (
    <div className="bg-panel px-5 py-4">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          'tabular mt-2 truncate font-display text-lg font-semibold',
          tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
      <p className={cn('mt-0.5 text-xs', tone === 'danger' ? 'text-danger' : 'text-ink-faint')}>
        {hint}
      </p>
    </div>
  );
}
