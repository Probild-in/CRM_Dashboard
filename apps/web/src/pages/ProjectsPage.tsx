import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, FolderKanban, Plus } from 'lucide-react';
import { PERMISSIONS, Priority, ProjectStatus } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { PRIORITY_TONES, PROJECT_STATUS_TONES } from '@/components/ui/tones';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination, TableWrap, Td, Th } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { ProjectFormModal } from '@/features/projects/ProjectFormModal';
import { useProjectSummary, useProjects } from '@/features/projects/api';
import { toMessage } from '@/lib/api';
import { cn, formatDate, formatMoney, humanise, relativeTime } from '@/lib/utils';

export default function ProjectsPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.PROJECT_WRITE);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [manager, setManager] = useState('');
  const [quickFilter, setQuickFilter] = useState<'active' | 'overdue' | 'dueSoon' | 'all'>('active');
  const [formOpen, setFormOpen] = useState(false);

  const summary = useProjectSummary();
  const team = useUsers({ page: 1, pageSize: 100 });
  const query = useProjects({
    page,
    pageSize: 20,
    search,
    status,
    priority,
    managerId: manager || undefined,
    activeOnly: quickFilter === 'active',
    overdue: quickFilter === 'overdue',
    dueSoon: quickFilter === 'dueSoon',
  });

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const hasFilters = Boolean(search || status || priority || manager);

  const QUICK_FILTERS = [
    { key: 'active', label: 'In flight', count: summary.data?.active },
    { key: 'overdue', label: 'Late', count: summary.data?.overdue },
    { key: 'dueSoon', label: 'Due in 2 weeks', count: summary.data?.dueSoon },
    { key: 'all', label: 'All', count: summary.data?.total },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Projects"
        description="What Probild is building, for whom, and how close each one is to delivery."
        action={
          canWrite ? (
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              <Plus aria-hidden className="size-4" />
              New project
            </Button>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => change(setQuickFilter)(filter.key)}
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

      <Panel>
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3">
          <Input
            type="search"
            value={search}
            onChange={(event) => change(setSearch)(event.target.value)}
            placeholder="Project, client or reference"
            aria-label="Search projects"
            className="h-9 max-w-xs"
          />
          <Select
            value={status}
            onChange={(event) => change(setStatus)(event.target.value as ProjectStatus | '')}
            aria-label="Filter by status"
            className="h-9 w-auto"
          >
            <option value="">All statuses</option>
            {Object.values(ProjectStatus).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={priority}
            onChange={(event) => change(setPriority)(event.target.value as Priority | '')}
            aria-label="Filter by priority"
            className="h-9 w-auto"
          >
            <option value="">All priorities</option>
            {Object.values(Priority).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
          <Select
            value={manager}
            onChange={(event) => change(setManager)(event.target.value)}
            aria-label="Filter by manager"
            className="h-9 w-auto"
          >
            <option value="">All managers</option>
            {team.data?.items.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </Select>
        </div>

        {query.isPending ? (
          <TableSkeleton rows={6} columns={6} />
        ) : query.isError ? (
          <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={<FolderKanban aria-hidden className="size-4.5" />}
            title={hasFilters ? 'No projects match those filters' : 'No projects here yet'}
            description={
              hasFilters
                ? 'Clear the filters to see the rest of the work.'
                : 'Start one from a won deal, or create it directly.'
            }
            action={
              canWrite && !hasFilters ? (
                <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                  <Plus aria-hidden className="size-4" />
                  New project
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>Status</Th>
                  <Th>Manager</Th>
                  <Th className="w-40">Progress</Th>
                  <Th align="right">Value</Th>
                  <Th>Delivery</Th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((project) => (
                  <tr key={project.id} className="group transition-colors hover:bg-panel-muted">
                    <Td>
                      <Link to={`/projects/${project.id}`} className="block min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[0.8125rem] font-medium text-ink group-hover:text-accent">
                            {project.name}
                          </span>
                          <Badge tone={PRIORITY_TONES[project.priority] ?? 'neutral'}>
                            {project.priority}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-faint">
                          {project.reference} · {project.client.companyName}
                        </span>
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={PROJECT_STATUS_TONES[project.status] ?? 'neutral'}>
                        {humanise(project.status)}
                      </Badge>
                    </Td>
                    <Td className="text-[0.8125rem]">
                      {project.manager
                        ? `${project.manager.firstName} ${project.manager.lastName}`
                        : 'Unassigned'}
                    </Td>
                    <Td>
                      <ProgressBar
                        value={project.progress}
                        tone={project.isOverdue ? 'warning' : 'accent'}
                        showLabel
                      />
                    </Td>
                    <Td align="right" className="tabular font-mono text-[0.8125rem] whitespace-nowrap">
                      {formatMoney(project.value, project.currency)}
                    </Td>
                    <Td>
                      {project.deliveryDate ? (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 text-[0.8125rem]',
                            project.isOverdue && 'font-medium text-danger',
                          )}
                        >
                          {project.isOverdue ? (
                            <AlarmClock aria-hidden className="size-3.5" />
                          ) : null}
                          {formatDate(project.deliveryDate)}
                          <span className="font-mono text-[0.6875rem] text-ink-faint">
                            {relativeTime(project.deliveryDate)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[0.8125rem] text-ink-faint">No date set</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="projects" />
          </>
        )}
      </Panel>

      {formOpen ? <ProjectFormModal onClose={() => setFormOpen(false)} /> : null}
    </>
  );
}
