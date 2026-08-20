import { useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { PERMISSIONS, Priority, TaskStatus } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { PRIORITY_TONES } from '@/components/ui/tones';
import { Board, type BoardColumn } from '@/components/ui/Board';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { useViewMode } from '@/hooks/useViewMode';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { useProjects } from '@/features/projects/api';
import { TaskFormModal } from '@/features/tasks/TaskFormModal';
import { TaskDetailModal } from '@/features/tasks/TaskDetailModal';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useTaskSummary, useTasks, useChangeTaskStatus } from '@/features/tasks/api';
import type { Task } from '@/features/tasks/types';
import { toMessage } from '@/lib/api';
import { cn, humanise, relativeTime } from '@/lib/utils';

/*
 * Live work gets a column; finished work gets a drop zone.
 *
 * There is deliberately no "Overdue" column. Lateness is derived from due_at on
 * every read, not stored — a late task still reports what someone is actually
 * doing with it, and a column would turn that back into a status.
 */
const BOARD_COLUMNS: BoardColumn<TaskStatus>[] = [
  { status: TaskStatus.TODO, label: 'To do' },
  { status: TaskStatus.IN_PROGRESS },
  { status: TaskStatus.REVIEW },
  { status: TaskStatus.BLOCKED },
];

const BOARD_COLLAPSED: BoardColumn<TaskStatus>[] = [
  { status: TaskStatus.COMPLETED },
  { status: TaskStatus.CANCELLED },
];

const BOARD_PAGE_SIZE = 100;

export default function TasksPage() {
  const { can, user } = useAuth();
  const canWrite = can(PERMISSIONS.TASK_WRITE);
  const [view, setView] = useViewMode('tasks');
  const changeStatus = useChangeTaskStatus();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [assignee, setAssignee] = useState('');
  const [projectId, setProjectId] = useState('');
  const [quickFilter, setQuickFilter] = useState<'mine' | 'overdue' | 'today' | 'open' | 'all'>(
    'mine',
  );

  const [formOpen, setFormOpen] = useState(false);
  const [viewing, setViewing] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);

  const summary = useTaskSummary();
  const team = useUsers({ page: 1, pageSize: 100 });
  const projects = useProjects({ page: 1, pageSize: 100, activeOnly: true });

  const query = useTasks({
    page: view === 'board' ? 1 : page,
    pageSize: view === 'board' ? BOARD_PAGE_SIZE : 25,
    search,
    status,
    priority,
    assigneeId: quickFilter === 'mine' ? user?.id : assignee || undefined,
    projectId: projectId || undefined,
    overdue: quickFilter === 'overdue',
    dueToday: quickFilter === 'today',
    openOnly: quickFilter === 'open' || quickFilter === 'mine',
    sortBy: 'dueAt',
    sortOrder: 'asc',
  });

  const moveTask = async (task: Task, next: TaskStatus): Promise<void> => {
    try {
      await changeStatus.mutateAsync({ id: task.id, status: next });
      toast.success(`${task.reference} moved to ${humanise(next)}`);
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const hasFilters = Boolean(search || status || priority || assignee || projectId);

  const QUICK_FILTERS = [
    { key: 'mine', label: 'Mine, open', count: undefined },
    { key: 'overdue', label: 'Overdue', count: summary.data?.overdue },
    { key: 'today', label: 'Due today', count: summary.data?.dueToday },
    { key: 'open', label: 'All open', count: summary.data?.open },
    { key: 'all', label: 'Everything', count: summary.data?.total },
  ] as const;

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Tasks"
        description="The day-to-day work, who owns it, and what is late."
        action={
          canWrite ? (
            <Button variant="primary" onClick={() => setFormOpen(true)}>
              <Plus aria-hidden className="size-4" />
              New task
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
              filter.key === 'overdue' &&
                quickFilter !== 'overdue' &&
                (summary.data?.overdue ?? 0) > 0 &&
                'border-danger/40 text-danger',
            )}
          >
            {filter.count !== undefined ? (
              <span className="tabular font-display text-lg font-semibold">{filter.count}</span>
            ) : null}
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
            placeholder="Title, reference or project"
            aria-label="Search tasks"
            className="h-9 max-w-xs"
          />
          {view === 'list' ? (
            <Select
              value={status}
              onChange={(event) => change(setStatus)(event.target.value as TaskStatus | '')}
              aria-label="Filter by status"
              className="h-9 w-auto"
            >
              <option value="">All statuses</option>
              {Object.values(TaskStatus).map((value) => (
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
            value={projectId}
            onChange={(event) => change(setProjectId)(event.target.value)}
            aria-label="Filter by project"
            className="h-9 w-auto"
          >
            <option value="">All projects</option>
            {projects.data?.items.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          {quickFilter !== 'mine' ? (
            <Select
              value={assignee}
              onChange={(event) => change(setAssignee)(event.target.value)}
              aria-label="Filter by assignee"
              className="h-9 w-auto"
            >
              <option value="">Anyone</option>
              {team.data?.items.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </Select>
          ) : null}
          <ViewToggle value={view} onChange={setView} className="ml-auto" />
        </div>

        {query.isPending ? (
          <TableSkeleton rows={8} columns={5} />
        ) : query.isError ? (
          <ErrorState message={toMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : query.data.items.length === 0 ? (
          <EmptyState
            icon={<ListChecks aria-hidden className="size-4.5" />}
            title={
              quickFilter === 'mine'
                ? 'Nothing assigned to you'
                : hasFilters
                  ? 'No tasks match those filters'
                  : 'No tasks yet'
            }
            description={
              quickFilter === 'mine'
                ? 'Work assigned to you shows up here, soonest deadline first.'
                : hasFilters
                  ? 'Clear the filters to see the rest of the work.'
                  : 'Add the first task and Probild will keep an eye on its deadline.'
            }
            action={
              canWrite && !hasFilters ? (
                <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
                  <Plus aria-hidden className="size-4" />
                  New task
                </Button>
              ) : null
            }
          />
        ) : (
          view === 'board' ? (
            <Board<Task, TaskStatus>
              columns={BOARD_COLUMNS}
              collapsed={BOARD_COLLAPSED}
              items={query.data.items}
              getId={(task) => task.id}
              getStatus={(task) => task.status}
              canMove={canWrite}
              onMove={(task, next) => void moveTask(task, next)}
              emptyLabel="Nothing here"
              footer={
                query.data.meta.total > query.data.items.length ? (
                  <p className="px-1 pt-3 text-xs text-ink-faint">
                    Showing the first {query.data.items.length} of {query.data.meta.total}. Narrow
                    the filters to see the rest on the board, or switch to the list.
                  </p>
                ) : null
              }
              renderCard={(task) => (
                <button
                  type="button"
                  onClick={() => setViewing(task)}
                  className="block w-full text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-[0.8125rem] font-medium text-ink hover:text-accent">
                      {task.title}
                    </p>
                    <Badge tone={PRIORITY_TONES[task.priority] ?? 'neutral'}>{task.priority}</Badge>
                  </div>
                  {task.project ? (
                    <p className="mt-0.5 truncate text-xs text-ink-soft">{task.project.name}</p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate text-[0.6875rem] text-ink-faint">
                      {task.assignee
                        ? `${task.assignee.firstName} ${task.assignee.lastName}`
                        : 'Unassigned'}
                    </span>
                    {task.dueAt ? (
                      <span
                        className={cn(
                          'font-mono text-[0.625rem]',
                          task.isOverdue ? 'font-medium text-danger' : 'text-ink-faint',
                        )}
                      >
                        {relativeTime(task.dueAt)}
                      </span>
                    ) : null}
                  </div>
                </button>
              )}
            />
          ) : (
          <>
            <ul className="divide-y divide-line">
              {query.data.items.map((task) => (
                <TaskRow key={task.id} task={task} showProject onOpen={() => setViewing(task)} />
              ))}
            </ul>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="tasks" />
          </>
          )
        )}
      </Panel>

      {formOpen ? <TaskFormModal onClose={() => setFormOpen(false)} /> : null}

      {editing ? (
        <TaskFormModal key={editing.id} onClose={() => setEditing(null)} task={editing} />
      ) : viewing ? (
        <TaskDetailModal
          key={viewing.id}
          task={query.data?.items.find((entry) => entry.id === viewing.id) ?? viewing}
          onClose={() => setViewing(null)}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
        />
      ) : null}
    </>
  );
}
