import { useState } from 'react';
import { Download } from 'lucide-react';
import { Currency } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { TableWrap, Td, Th } from '@/components/ui/Table';
import { BarList, ChartFrame, type BarDatum } from '@/components/charts/BarList';
import { TrendChart } from '@/components/charts/TrendChart';
import {
  useOutstandingReport,
  useProjectReport,
  useRevenueReport,
  useSalesReport,
} from '@/features/reports/api';
import { downloadCsv, reportFilename } from '@/features/reports/csv';
import { toMessage } from '@/lib/api';
import {
  cn,
  formatDate,
  formatMoney,
  formatMoneyTotals as money,
  humanise,
  plural,
} from '@/lib/utils';

export default function ReportsPage() {
  const [tab, setTab] = useState('revenue');
  const [months, setMonths] = useState(12);
  const [currency, setCurrency] = useState<Currency>(Currency.INR);

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Reports"
        description="Revenue, sales performance, delivery and what is still owed. Every table exports."
        action={
          <div className="flex flex-wrap gap-2">
            <Select
              value={months}
              onChange={(event) => setMonths(Number(event.target.value))}
              aria-label="Window"
              className="h-9 w-auto"
            >
              {[3, 6, 12, 24].map((value) => (
                <option key={value} value={value}>
                  Last {value} months
                </option>
              ))}
            </Select>
            <Select
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
              aria-label="Currency"
              className="h-9 w-auto"
            >
              {Object.values(Currency).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <Tabs
        tabs={[
          { key: 'revenue', label: 'Revenue' },
          { key: 'sales', label: 'Sales' },
          { key: 'projects', label: 'Delivery' },
          { key: 'outstanding', label: 'Outstanding' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <TabPanel active={tab} tabKey="revenue">
        <RevenueTab months={months} currency={currency} />
      </TabPanel>
      <TabPanel active={tab} tabKey="sales">
        <SalesTab months={months} currency={currency} />
      </TabPanel>
      <TabPanel active={tab} tabKey="projects">
        <DeliveryTab />
      </TabPanel>
      <TabPanel active={tab} tabKey="outstanding">
        <OutstandingTab />
      </TabPanel>
    </>
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick}>
      <Download aria-hidden className="size-4" />
      Export
    </Button>
  );
}

function ReportState({
  isPending,
  error,
  retry,
}: {
  isPending: boolean;
  error: unknown;
  retry: () => void;
}) {
  if (isPending) return <LoadingState label="Building the report" />;
  return (
    <Panel>
      <ErrorState message={toMessage(error)} onRetry={retry} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

function RevenueTab({ months, currency }: { months: number; currency: Currency }) {
  const report = useRevenueReport(months);

  if (report.isPending || report.isError || !report.data) {
    return (
      <ReportState
        isPending={report.isPending}
        error={report.error}
        retry={() => void report.refetch()}
      />
    );
  }

  const { byMonth, byClient, byService, totals } = report.data;

  const clientData: BarDatum[] = byClient.slice(0, 10).map((client) => ({
    key: client.id,
    label: client.name,
    value: client.value[currency],
    display: formatMoney(client.value[currency], currency),
  }));

  const serviceData: BarDatum[] = byService
    .filter((service) => service.value[currency] > 0)
    .slice(0, 10)
    .map((service) => ({
      key: service.id,
      label: service.name,
      value: service.value[currency],
      display: formatMoney(service.value[currency], currency),
    }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2">
        <Metric label="Received" value={money(totals.received)} hint={`Over ${months} months`} />
        <Metric label="Won" value={money(totals.won)} hint="Deals closed in the window" />
      </div>

      <ChartFrame
        eyebrow={`Last ${months} months`}
        title={`Won and received (${currency})`}
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(
                reportFilename('revenue-by-month'),
                ['Month', `Won (${currency})`, `Received (${currency})`],
                byMonth.map((month) => [month.label, month.won[currency], month.received[currency]]),
              )
            }
          />
        }
      >
        <TrendChart
          currency={currency}
          data={byMonth.map((month) => ({
            label: month.label,
            won: month.won[currency],
            received: month.received[currency],
          }))}
        />
      </ChartFrame>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartFrame
          eyebrow="Who pays the most"
          title={`Revenue by client (${currency})`}
          action={
            <ExportButton
              onClick={() =>
                downloadCsv(
                  reportFilename('revenue-by-client'),
                  ['Client', 'INR', 'USD'],
                  byClient.map((client) => [client.name, client.value.INR, client.value.USD]),
                )
              }
            />
          }
        >
          <BarList data={clientData} emptyMessage={`No ${currency} received in this window.`} />
        </ChartFrame>

        <ChartFrame
          eyebrow="What sells"
          title={`Revenue by service (${currency})`}
          action={
            <ExportButton
              onClick={() =>
                downloadCsv(
                  reportFilename('revenue-by-service'),
                  ['Service', 'INR', 'USD'],
                  byService.map((service) => [service.name, service.value.INR, service.value.USD]),
                )
              }
            />
          }
        >
          <BarList
            data={serviceData}
            emptyMessage="Nothing sold through an accepted quotation yet."
          />
        </ChartFrame>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SalesTab({ months, currency }: { months: number; currency: Currency }) {
  const report = useSalesReport(months);

  if (report.isPending || report.isError || !report.data) {
    return (
      <ReportState
        isPending={report.isPending}
        error={report.error}
        retry={() => void report.refetch()}
      />
    );
  }

  const { totals, byOwner, bySource } = report.data;

  const sourceData: BarDatum[] = bySource.map((source) => ({
    key: source.source,
    label: humanise(source.source),
    value: source.total,
    display: String(source.total),
    note: source.rate === null ? undefined : `${source.rate}% won`,
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Leads" value={String(totals.leads)} hint={`${totals.open} still open`} />
        <Metric label="Won" value={String(totals.won)} hint={`${totals.lost} lost`} />
        <Metric
          label="Conversion"
          value={totals.rate === null ? '—' : `${totals.rate}%`}
          hint={totals.won + totals.lost === 0 ? 'nothing decided yet' : 'of decided leads'}
        />
        <Metric label="Won value" value={money(totals.wonValue)} hint="Deals closed" />
      </div>

      <Panel>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            <p className="eyebrow mb-1">Who is closing</p>
            <h2 className="text-[0.9375rem] font-semibold text-ink">By owner</h2>
          </div>
          <ExportButton
            onClick={() =>
              downloadCsv(
                reportFilename('sales-by-owner'),
                ['Owner', 'Leads', 'Won', 'Lost', 'Conversion %', 'Won INR', 'Won USD'],
                byOwner.map((owner) => [
                  owner.name,
                  owner.leads,
                  owner.won,
                  owner.lost,
                  owner.rate ?? '',
                  owner.value.INR,
                  owner.value.USD,
                ]),
              )
            }
          />
        </div>

        {byOwner.length === 0 ? (
          <EmptyState title="No leads in this window" description="Nothing to measure yet." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Owner</Th>
                <Th align="right">Leads</Th>
                <Th align="right">Won</Th>
                <Th align="right">Lost</Th>
                <Th align="right">Conversion</Th>
                <Th align="right">Won value</Th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((owner) => (
                <tr key={owner.id} className="hover:bg-panel-muted">
                  <Td className="text-[0.8125rem] font-medium text-ink">{owner.name}</Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem]">
                    {owner.leads}
                  </Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem] text-success">
                    {owner.won}
                  </Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem] text-ink-faint">
                    {owner.lost}
                  </Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem]">
                    {owner.rate === null ? '—' : `${owner.rate}%`}
                  </Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem]">
                    {formatMoney(owner.value[currency], currency)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <ChartFrame
        eyebrow="Where they come from"
        title="By source"
        action={
          <ExportButton
            onClick={() =>
              downloadCsv(
                reportFilename('sales-by-source'),
                ['Source', 'Leads', 'Won', 'Lost', 'Conversion %'],
                bySource.map((source) => [
                  humanise(source.source),
                  source.total,
                  source.won,
                  source.lost,
                  source.rate ?? '',
                ]),
              )
            }
          />
        }
      >
        <BarList data={sourceData} emptyMessage="No leads in this window." />
      </ChartFrame>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DeliveryTab() {
  const report = useProjectReport();

  if (report.isPending || report.isError || !report.data) {
    return (
      <ReportState
        isPending={report.isPending}
        error={report.error}
        retry={() => void report.refetch()}
      />
    );
  }

  const { totals, delivery, open } = report.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Delivered on time"
          value={totals.onTimeRate === null ? '—' : `${totals.onTimeRate}%`}
          hint={
            totals.completed === 0
              ? 'nothing delivered yet'
              : `${totals.onTime} of ${plural(totals.completed, 'project')}`
          }
        />
        <Metric
          label="Delivered late"
          value={String(totals.late)}
          hint={
            totals.late === 0
              ? 'none'
              : `${totals.averageDaysLate} days late on average`
          }
          tone={totals.late > 0 ? 'danger' : undefined}
        />
        <Metric
          label="In flight"
          value={String(totals.open)}
          hint={`${totals.averageProgress}% average completion`}
        />
        <Metric
          label="Behind schedule"
          value={String(totals.slipping)}
          hint={totals.slipping === 0 ? 'nothing is late' : 'past their delivery date'}
          tone={totals.slipping > 0 ? 'danger' : undefined}
        />
      </div>

      <Panel>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            <p className="eyebrow mb-1">Against the date promised</p>
            <h2 className="text-[0.9375rem] font-semibold text-ink">Delivery performance</h2>
          </div>
          <ExportButton
            onClick={() =>
              downloadCsv(
                reportFilename('delivery-performance'),
                ['Reference', 'Project', 'Client', 'Manager', 'Promised', 'Delivered', 'Days late'],
                delivery.map((project) => [
                  project.reference,
                  project.name,
                  project.client,
                  project.manager ?? '',
                  project.deliveryDate ? formatDate(project.deliveryDate) : '',
                  project.completedAt ? formatDate(project.completedAt) : '',
                  project.daysLate,
                ]),
              )
            }
          />
        </div>

        {delivery.length === 0 ? (
          <EmptyState
            title="Nothing delivered yet"
            description="Completed projects are measured here against the date they promised."
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Promised</Th>
                <Th>Delivered</Th>
                <Th align="right">Days late</Th>
              </tr>
            </thead>
            <tbody>
              {delivery.map((project) => (
                <tr
                  key={project.id}
                  className={cn('hover:bg-panel-muted', !project.onTime && 'edge-marker-row text-danger')}
                >
                  <Td>
                    <span className="block text-[0.8125rem] font-medium text-ink">
                      {project.name}
                    </span>
                    <span className="block font-mono text-[0.625rem] text-ink-faint">
                      {project.reference} · {project.client}
                    </span>
                  </Td>
                  <Td className="tabular font-mono text-xs">{formatDate(project.deliveryDate)}</Td>
                  <Td className="tabular font-mono text-xs">{formatDate(project.completedAt)}</Td>
                  <Td align="right">
                    {project.onTime ? (
                      <Badge tone="success">On time</Badge>
                    ) : (
                      <Badge tone="danger">{plural(project.daysLate, 'day')} late</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            <p className="eyebrow mb-1">Still running</p>
            <h2 className="text-[0.9375rem] font-semibold text-ink">Open projects</h2>
          </div>
          <ExportButton
            onClick={() =>
              downloadCsv(
                reportFilename('open-projects'),
                ['Reference', 'Project', 'Client', 'Status', 'Progress %', 'Delivery', 'Tasks'],
                open.map((project) => [
                  project.reference,
                  project.name,
                  project.client,
                  humanise(project.status),
                  project.progress,
                  project.deliveryDate ? formatDate(project.deliveryDate) : '',
                  project.tasks,
                ]),
              )
            }
          />
        </div>

        {open.length === 0 ? (
          <EmptyState title="Nothing in flight" description="Every project is closed." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Status</Th>
                <Th className="w-40">Progress</Th>
                <Th>Delivery</Th>
              </tr>
            </thead>
            <tbody>
              {open.map((project) => (
                <tr
                  key={project.id}
                  className={cn('hover:bg-panel-muted', project.isSlipping && 'edge-marker-row text-danger')}
                >
                  <Td>
                    <span className="block text-[0.8125rem] font-medium text-ink">
                      {project.name}
                    </span>
                    <span className="block font-mono text-[0.625rem] text-ink-faint">
                      {project.reference} · {project.client}
                    </span>
                  </Td>
                  <Td>
                    <Badge>{humanise(project.status)}</Badge>
                  </Td>
                  <Td>
                    <ProgressBar
                      value={project.progress}
                      tone={project.isSlipping ? 'warning' : 'accent'}
                      showLabel
                    />
                  </Td>
                  <Td className="tabular font-mono text-xs">{formatDate(project.deliveryDate)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OutstandingTab() {
  const report = useOutstandingReport();

  if (report.isPending || report.isError || !report.data) {
    return (
      <ReportState
        isPending={report.isPending}
        error={report.error}
        retry={() => void report.refetch()}
      />
    );
  }

  const { totals, byClient, items } = report.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-3">
        <Metric label="Outstanding" value={money(totals.outstanding)} hint={plural(totals.count, 'payment')} />
        <Metric
          label="Overdue"
          value={money(totals.overdue)}
          hint="Past its due date"
          tone={Object.values(totals.overdue).some((value) => value > 0) ? 'danger' : undefined}
        />
        <Metric label="Clients owing" value={String(byClient.length)} hint="With money still due" />
      </div>

      <Panel>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            <p className="eyebrow mb-1">Worst first</p>
            <h2 className="text-[0.9375rem] font-semibold text-ink">Who owes what</h2>
          </div>
          <ExportButton
            onClick={() =>
              downloadCsv(
                reportFilename('outstanding-by-client'),
                ['Client', 'Payments', 'Outstanding INR', 'Outstanding USD', 'Overdue INR', 'Overdue USD'],
                byClient.map((client) => [
                  client.name,
                  client.count,
                  client.outstanding.INR,
                  client.outstanding.USD,
                  client.overdue.INR,
                  client.overdue.USD,
                ]),
              )
            }
          />
        </div>

        {byClient.length === 0 ? (
          <EmptyState title="Nothing outstanding" description="Every payment raised has arrived." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Client</Th>
                <Th align="right">Payments</Th>
                <Th align="right">Outstanding</Th>
                <Th align="right">Of which overdue</Th>
              </tr>
            </thead>
            <tbody>
              {byClient.map((client) => (
                <tr key={client.id} className="hover:bg-panel-muted">
                  <Td className="text-[0.8125rem] font-medium text-ink">{client.name}</Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem]">
                    {client.count}
                  </Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem]">
                    {money(client.outstanding)}
                  </Td>
                  <Td
                    align="right"
                    className={cn(
                      'tabular font-mono text-[0.8125rem]',
                      Object.values(client.overdue).some((value) => value > 0)
                        ? 'font-medium text-danger'
                        : 'text-ink-faint',
                    )}
                  >
                    {money(client.overdue)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <div>
            <p className="eyebrow mb-1">Every open payment</p>
            <h2 className="text-[0.9375rem] font-semibold text-ink">The detail</h2>
          </div>
          <ExportButton
            onClick={() =>
              downloadCsv(
                reportFilename('outstanding-detail'),
                ['Reference', 'For', 'Client', 'Project', 'Currency', 'Billed', 'Received', 'Outstanding', 'Due', 'Days late'],
                items.map((item) => [
                  item.reference,
                  item.title,
                  item.client,
                  item.project ?? '',
                  item.currency,
                  item.amount,
                  item.received,
                  item.outstanding,
                  item.dueDate ? formatDate(item.dueDate) : '',
                  item.daysLate,
                ]),
              )
            }
          />
        </div>

        {items.length === 0 ? (
          <EmptyState title="Nothing outstanding" description="Every payment raised has arrived." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Payment</Th>
                <Th align="right">Billed</Th>
                <Th align="right">Received</Th>
                <Th align="right">Outstanding</Th>
                <Th align="right">Late by</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={cn('hover:bg-panel-muted', item.daysLate > 0 && 'edge-marker-row text-danger')}
                >
                  <Td>
                    <span className="block text-[0.8125rem] font-medium text-ink">{item.title}</span>
                    <span className="block font-mono text-[0.625rem] text-ink-faint">
                      {item.reference} · {item.client}
                    </span>
                  </Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem]">
                    {formatMoney(item.amount, item.currency)}
                  </Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem] text-ink-faint">
                    {formatMoney(item.received, item.currency)}
                  </Td>
                  <Td align="right" className="tabular font-mono text-[0.8125rem]">
                    {formatMoney(item.outstanding, item.currency)}
                  </Td>
                  <Td align="right">
                    {item.daysLate > 0 ? (
                      <Badge tone="danger">{plural(item.daysLate, 'day')}</Badge>
                    ) : (
                      <span className="text-[0.8125rem] text-ink-faint">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </div>
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
