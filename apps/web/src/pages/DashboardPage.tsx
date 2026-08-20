import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, CalendarClock, Sun } from 'lucide-react';
import { Currency, LeadStatus, ProjectStatus, TaskStatus } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Select } from '@/components/ui/Field';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { BarList, ChartFrame, StatusBar, type BarDatum } from '@/components/charts/BarList';
import { TrendChart } from '@/components/charts/TrendChart';
import { useAuth } from '@/features/auth/AuthContext';
import {
  FollowUpItems,
  MeetingItems,
  PaymentItems,
  ProjectItems,
  TaskItems,
} from '@/features/dashboard/AgendaLists';
import {
  useDashboard,
  useDeliveryDashboard,
  useSalesDashboard,
} from '@/features/dashboard/api';
import { toMessage } from '@/lib/api';
import { cn, formatMoneyTotals as money, humanise, plural } from '@/lib/utils';

export default function DashboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('today');
  const overview = useDashboard();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (overview.isPending) return <LoadingState label="Loading your day" />;
  if (overview.isError) {
    return (
      <Panel>
        <ErrorState
          title="The dashboard did not load"
          message={toMessage(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      </Panel>
    );
  }

  const { kpis, today, overdue, upcoming } = overview.data;
  const todayCount = today.followUps.length + today.tasks.length + today.meetings.length;
  const overdueCount =
    overdue.followUps.length + overdue.tasks.length + overdue.projects.length + overdue.payments.length;
  const upcomingCount =
    upcoming.tasks.length + upcoming.projects.length + upcoming.meetings.length + upcoming.payments.length;

  return (
    <>
      <PageHeader
        eyebrow={new Intl.DateTimeFormat('en-IN', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: overview.data.timezone,
        }).format(new Date())}
        title={`${greeting}, ${user?.firstName ?? 'there'}`}
        description={summarise(overdueCount, todayCount)}
      />

      {/* Headline numbers first — magnitude with no comparison wants a figure, not a chart. */}
      <div className="mb-6 grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Active leads" value={String(kpis.activeLeads)} hint={`${kpis.totalLeads} in total`} to="/leads" />
        <Kpi label="Pipeline value" value={money(kpis.pipelineValue)} hint="Open leads" to="/pipeline" />
        <Kpi label="Won business" value={money(kpis.wonDealValue)} hint={`${kpis.wonLeads} won · ${kpis.lostLeads} lost`} to="/clients" />
        <Kpi label="Revenue this month" value={money(kpis.monthlyRevenue)} hint="Payments received" to="/payments" />
        <Kpi label="Pending payments" value={money(kpis.pendingPayments)} hint="Still outstanding" to="/payments" />
        <Kpi label="Active projects" value={String(kpis.activeProjects)} hint="In flight" to="/projects" />
        <Kpi label="Due in 2 weeks" value={String(kpis.projectsDueSoon)} hint="Project deliveries" to="/projects" />
        <Kpi
          label="Overdue tasks"
          value={String(kpis.overdueTasks)}
          hint={kpis.overdueTasks > 0 ? 'Needs attention' : 'All on time'}
          tone={kpis.overdueTasks > 0 ? 'danger' : undefined}
          to="/tasks"
        />
      </div>

      <Tabs
        tabs={[
          { key: 'today', label: 'Your day' },
          { key: 'sales', label: 'Sales' },
          { key: 'delivery', label: 'Delivery' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <TabPanel active={tab} tabKey="today">
        <div className="grid gap-5 lg:grid-cols-3">
          <Panel>
            <PanelHeader eyebrow="Now" title="Today" />
            {todayCount === 0 ? (
              <EmptyState
                icon={<Sun aria-hidden className="size-4.5" />}
                title="Nothing scheduled today"
                description="Meetings, follow-ups and tasks due today appear here."
              />
            ) : (
              <ul className="divide-y divide-line">
                <MeetingItems items={today.meetings} />
                <FollowUpItems items={today.followUps} />
                <TaskItems items={today.tasks} />
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Late" title="Overdue" />
            {overdueCount === 0 ? (
              <EmptyState
                icon={<AlarmClock aria-hidden className="size-4.5" />}
                title="Nothing is late"
                description="Anything past its due date shows up here until it is closed."
              />
            ) : (
              <ul className="divide-y divide-line">
                <FollowUpItems items={overdue.followUps} late />
                <TaskItems items={overdue.tasks} late />
                <ProjectItems items={overdue.projects} late />
                <PaymentItems items={overdue.payments} late />
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader eyebrow="Ahead" title="Next 7 days" />
            {upcomingCount === 0 ? (
              <EmptyState
                icon={<CalendarClock aria-hidden className="size-4.5" />}
                title="The week is clear"
                description="Deadlines, meetings and payment dates land here a week out."
              />
            ) : (
              <ul className="divide-y divide-line">
                <MeetingItems items={upcoming.meetings} />
                <TaskItems items={upcoming.tasks} />
                <ProjectItems items={upcoming.projects} />
                <PaymentItems items={upcoming.payments} />
              </ul>
            )}
          </Panel>
        </div>
      </TabPanel>

      <TabPanel active={tab} tabKey="sales">
        <SalesSection />
      </TabPanel>

      <TabPanel active={tab} tabKey="delivery">
        <DeliverySection />
      </TabPanel>
    </>
  );
}

function SalesSection() {
  const [currency, setCurrency] = useState<Currency>(Currency.INR);
  const sales = useSalesDashboard(6);

  if (sales.isPending) return <LoadingState label="Loading sales" />;
  if (sales.isError) {
    return (
      <Panel>
        <ErrorState message={toMessage(sales.error)} onRetry={() => void sales.refetch()} />
      </Panel>
    );
  }

  const { pipeline, conversion, sources, revenueByMonth } = sales.data;

  const pipelineData: BarDatum[] = pipeline.map((stage) => ({
    key: stage.status,
    label: humanise(stage.status as LeadStatus),
    value: stage.value[currency],
    display: formatCompact(stage.value[currency], currency),
    note: plural(stage.count, 'lead'),
  }));

  const sourceData: BarDatum[] = sources.slice(0, 8).map((source) => ({
    key: source.source,
    label: humanise(source.source),
    value: source.total,
    display: String(source.total),
    note: source.rate === null ? undefined : `${source.rate}% won`,
  }));

  return (
    <div className="flex flex-col gap-5">
      {/* One filter row above the charts. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-ink-faint">
          Money is shown one currency at a time — INR and USD are never added together.
        </p>
        <Select
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
          aria-label="Currency"
          className="h-9 w-auto"
        >
          {Object.values(Currency).map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartFrame eyebrow="Where the money sits" title={`Pipeline by stage (${currency})`}>
          <BarList
            data={pipelineData}
            emptyMessage={`No open ${currency} pipeline right now.`}
          />
        </ChartFrame>

        <ChartFrame
          eyebrow="Conversion"
          title="Where leads come from"
          action={
            <span className="text-right">
              <span className="tabular block font-display text-lg font-semibold text-ink">
                {conversion.rate === null ? '—' : `${conversion.rate}%`}
              </span>
              <span className="block font-mono text-[0.625rem] text-ink-faint">
                {conversion.decided === 0
                  ? 'nothing decided yet'
                  : `${conversion.won} of ${conversion.decided} decided`}
              </span>
            </span>
          }
        >
          <BarList data={sourceData} emptyMessage="No leads recorded yet." />
        </ChartFrame>
      </div>

      <ChartFrame eyebrow="Last six months" title={`Won and received (${currency})`}>
        <TrendChart
          currency={currency}
          data={revenueByMonth.map((month) => ({
            label: month.label,
            won: month.won[currency],
            received: month.received[currency],
          }))}
        />
      </ChartFrame>
    </div>
  );
}

function DeliverySection() {
  const delivery = useDeliveryDashboard();

  if (delivery.isPending) return <LoadingState label="Loading delivery" />;
  if (delivery.isError) {
    return (
      <Panel>
        <ErrorState message={toMessage(delivery.error)} onRetry={() => void delivery.refetch()} />
      </Panel>
    );
  }

  const { projectsByStatus, tasksByStatus, averageCompletion, delayed, workload } = delivery.data;
  const taskTotal = tasksByStatus.reduce((sum, entry) => sum + entry.count, 0);

  /* Status colours are the reserved set, and every segment is named in the key. */
  const TASK_FILLS: Record<TaskStatus, string> = {
    TODO: 'bg-line-strong',
    IN_PROGRESS: 'bg-series-1',
    REVIEW: 'bg-warning',
    BLOCKED: 'bg-danger',
    COMPLETED: 'bg-success',
    CANCELLED: 'bg-neutral-soft',
  };

  const projectData: BarDatum[] = projectsByStatus
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      key: entry.status,
      label: humanise(entry.status as ProjectStatus),
      value: entry.count,
      display: String(entry.count),
    }));

  const workloadData: BarDatum[] = workload.slice(0, 8).map((entry) => ({
    key: entry.userId ?? 'unassigned',
    label: entry.name,
    value: entry.openTasks,
    display: String(entry.openTasks),
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartFrame
          eyebrow="In flight"
          title="Projects by status"
          action={
            <span className="text-right">
              <span className="tabular block font-display text-lg font-semibold text-ink">
                {averageCompletion}%
              </span>
              <span className="block font-mono text-[0.625rem] text-ink-faint">
                average completion
              </span>
            </span>
          }
        >
          <BarList data={projectData} emptyMessage="No projects yet." />
        </ChartFrame>

        <ChartFrame eyebrow="The work" title="Tasks by status">
          <StatusBar
            total={taskTotal}
            segments={tasksByStatus.map((entry) => ({
              key: entry.status,
              label: humanise(entry.status as TaskStatus),
              value: entry.count,
              className: TASK_FILLS[entry.status] ?? 'bg-line-strong',
            }))}
          />
        </ChartFrame>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader eyebrow="Behind schedule" title="Delayed projects" />
          {delayed.length === 0 ? (
            <EmptyState
              title="Nothing is behind"
              description="Projects past their delivery date show up here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {delayed.map((project) => (
                <li key={project.id} className="edge-marker text-danger">
                  <Link
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-panel-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] font-medium text-ink">
                        {project.name}
                      </span>
                      <span className="block truncate text-xs text-ink-faint">
                        {project.client.companyName} · {project.reference}
                      </span>
                    </span>
                    <ProgressBar value={project.progress} tone="warning" showLabel className="w-32 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <ChartFrame eyebrow="Who is carrying what" title="Open tasks per person">
          <BarList data={workloadData} emptyMessage="No open tasks." />
        </ChartFrame>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
  to,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'danger';
  to: string;
}) {
  return (
    <Link to={to} className="group bg-panel px-5 py-4 transition-colors hover:bg-panel-muted">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          'tabular mt-2 truncate font-display text-xl font-semibold',
          tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
      <p className={cn('mt-0.5 text-xs', tone === 'danger' ? 'text-danger' : 'text-ink-faint')}>
        {hint}
      </p>
    </Link>
  );
}

/** The one line that answers "what needs me today?" before anything is read. */
function summarise(overdueCount: number, todayCount: number): string {
  if (overdueCount === 0 && todayCount === 0) {
    return 'Nothing is late and nothing is due today.';
  }
  if (overdueCount === 0) {
    return `Nothing is late. ${plural(todayCount, 'thing')} due today.`;
  }
  if (todayCount === 0) {
    return `${plural(overdueCount, 'thing')} past due. Nothing new today.`;
  }
  return `${plural(overdueCount, 'thing')} past due, and ${plural(todayCount, 'thing')} due today.`;
}

/** Short enough to sit at the end of a bar. */
function formatCompact(value: number, currency: Currency): string {
  if (value === 0) return '—';
  if (currency === 'INR') {
    if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)}Cr`;
    if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
    if (value >= 1000) return `₹${Math.round(value / 1000)}k`;
    return `₹${value}`;
  }
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}
