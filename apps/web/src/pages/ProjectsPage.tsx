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
import { Board, type BoardColumn } from '@/components/ui/Board';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { useViewMode } from '@/hooks/useViewMode';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { ProjectFormModal } from '@/features/projects/ProjectFormModal';
import { useProjectSummary, useProjects, useChangeProjectStatus } from '@/features/projects/api';
import type { Project } from '@/features/projects/types';
import { toMessage } from '@/lib/api';
import { cn, formatDate, formatMoney, humanise, relativeTime } from '@/lib/utils';

/** Work in progress gets a column; finished work gets a drop zone. */
const BOARD_COLUMNS: BoardColumn<ProjectStatus>[] = [
  { status: ProjectStatus.PLANNING },
  { status: ProjectStatus.ACTIVE },
  { status: ProjectStatus.ON_HOLD },
  { status: ProjectStatus.IN_REVIEW },
  { status: ProjectStatus.CLIENT_REVIEW },
];

const BOARD_COLLAPSED: BoardColumn<ProjectStatus>[] = [
  { status: ProjectStatus.COMPLETED },
  { status: ProjectStatus.CANCELLED },
];

/** The board shows everything at once, so it asks for as much as the API allows. */
const BOARD_PAGE_SIZE = 100;

export default function ProjectsPage() {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.PROJECT_WRITE);
  const [view, setView] = useViewMode('projects');
  const changeStatus = useChangeProjectStatus();

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
    page: view === 'board' ? 1 : page,
    pageSize: view === 'board' ? BOARD_PAGE_SIZE : 20,
    search,
    status,
    priority,
    managerId: manager || undefined,
    activeOnly: quickFilter === 'active',
    overdue: quickFilter === 'overdue',
    dueSoon: quickFilter === 'dueSoon',
  });

  const moveProject = async (project: Project, next: ProjectStatus): Promise<void> => {
    try {
      await changeStatus.mutateAsync({ id: project.id, status: next });
      toast.success(`${project.reference} moved to ${humanise(next)}`);
    } catch (error) {
      // The card snaps back because the list re-renders from server state.
      toast.error(toMessage(error));
    }
  };

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
          {view === 'list' ? (
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
          ) : null}
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
          <ViewToggle value={view} onChange={setView} className="ml-auto" />
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
          view === 'board' ? (
            <Board<Project, ProjectStatus>
              columns={BOARD_COLUMNS}
              collapsed={BOARD_COLLAPSED}
              items={query.data.items}
              getId={(project) => project.id}
              getStatus={(project) => project.status}
              canMove={canWrite}
              onMove={(project, next) => void moveProject(project, next)}
              emptyLabel="Nothing at this stage"
              footer={
                query.data.meta.total > query.data.items.length ? (
                  <p className="px-1 pt-3 text-xs text-ink-faint">
                    Showing the first {query.data.items.length} of {query.data.meta.total}. Narrow
                    the filters to see the rest on the board, or switch to the list.
                  </p>
                ) : null
              }
              renderCard={(project) => (
                <Link to={`/projects/${project.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[0.8125rem] font-medium text-ink hover:text-accent">
                      {project.name}
                    </p>
                    <Badge tone={PRIORITY_TONES[project.priority] ?? 'neutral'}>
                      {project.priority}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {project.client.companyName}
                  </p>
                  <div className="mt-2">
                    <ProgressBar
                      value={project.progress}
                      tone={project.isOverdue ? 'warning' : 'accent'}
                      showLabel
                    />
                  </div>
                  <p className="tabular mt-2 font-mono text-xs text-ink-soft">
                    {formatMoney(project.value, project.currency)}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[0.625rem] text-ink-faint">
                      {project.reference}
                    </span>
                    {project.deliveryDate ? (
                      <span
                        className={cn(
                          'font-mono text-[0.625rem]',
                          project.isOverdue ? 'font-medium text-danger' : 'text-ink-faint',
                        )}
                      >
                        {relativeTime(project.deliveryDate)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              )}
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
          )
        )}
      </Panel>

      {formOpen ? <ProjectFormModal onClose={() => setFormOpen(false)} /> : null}
    </>
  );
}
