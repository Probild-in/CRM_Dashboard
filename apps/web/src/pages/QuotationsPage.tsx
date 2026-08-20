import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, FileText } from 'lucide-react';
import { PERMISSIONS, QuotationStatus } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { QUOTATION_STATUS_TONES } from '@/components/ui/tones';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination, TableWrap, Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/AuthContext';
import { QuotationBuilder } from '@/features/quotations/QuotationBuilder';
import { useQuotations } from '@/features/quotations/api';
import { toMessage } from '@/lib/api';
import { cn, formatDate, formatMoney, humanise, relativeTime } from '@/lib/utils';

export default function QuotationsPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.QUOTATION_WRITE);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<QuotationStatus | ''>('');
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  const query = useQuotations({ page, pageSize: 20, search, status, expiringSoon });
  const hasFilters = Boolean(search || status || expiringSoon);

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Quotations"
        description="What Probild has quoted, what it is worth, and where each one stands."
        action={
          canWrite ? (
            <Button variant="primary" onClick={() => setBuilderOpen(true)}>
              <FilePlus2 aria-hidden className="size-4" />
              New quotation
            </Button>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Title, reference or client"
            aria-label="Search quotations"
            className="h-9 max-w-xs"
          />
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as QuotationStatus | '');
              setPage(1);
            }}
            aria-label="Filter by status"
            className="h-9 w-auto"
          >
            <option value="">All statuses</option>
            {Object.values(QuotationStatus).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant={expiringSoon ? 'primary' : 'secondary'}
            onClick={() => {
              setExpiringSoon((current) => !current);
              setPage(1);
            }}
          >
            Expiring soon
          </Button>
        </div>

        {query.isPending ? (
          <TableSkeleton rows={6} columns={5} />
        ) : query.isError ? (
          <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden className="size-4.5" />}
            title={hasFilters ? 'No quotations match those filters' : 'No quotations yet'}
            description={
              hasFilters
                ? 'Clear the filters to see them all.'
                : 'Build one from a client profile, or start a new one here.'
            }
            action={
              canWrite && !hasFilters ? (
                <Button variant="primary" size="sm" onClick={() => setBuilderOpen(true)}>
                  <FilePlus2 aria-hidden className="size-4" />
                  New quotation
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Quotation</Th>
                  <Th>For</Th>
                  <Th>Status</Th>
                  <Th align="right">Total</Th>
                  <Th>Valid until</Th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((quotation) => (
                  <tr key={quotation.id} className="group transition-colors hover:bg-panel-muted">
                    <Td>
                      <Link to={`/quotations/${quotation.id}`} className="block min-w-0">
                        <span className="block truncate text-[0.8125rem] font-medium text-ink group-hover:text-accent">
                          {quotation.title}
                        </span>
                        <span className="mt-0.5 block font-mono text-[0.6875rem] text-ink-faint">
                          {quotation.reference} · {quotation.items.length} lines
                        </span>
                      </Link>
                    </Td>
                    <Td className="text-[0.8125rem]">
                      {quotation.client?.companyName ?? quotation.lead?.companyName ?? '—'}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Badge tone={QUOTATION_STATUS_TONES[quotation.status] ?? 'neutral'}>
                          {humanise(quotation.status)}
                        </Badge>
                        {quotation.isExpired ? <Badge tone="danger">Expired</Badge> : null}
                      </div>
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem] whitespace-nowrap">
                      {formatMoney(quotation.total, quotation.currency)}
                    </Td>
                    <Td>
                      {quotation.validUntil ? (
                        <span
                          className={cn(
                            'text-[0.8125rem]',
                            quotation.isExpired && 'font-medium text-danger',
                          )}
                        >
                          {formatDate(quotation.validUntil)}
                          <span className="ml-1.5 font-mono text-[0.6875rem] text-ink-faint">
                            {relativeTime(quotation.validUntil)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[0.8125rem] text-ink-faint">No expiry</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="quotations" />
          </>
        )}
      </Panel>

      {builderOpen ? <QuotationBuilder open onClose={() => setBuilderOpen(false)} /> : null}
    </>
  );
}
