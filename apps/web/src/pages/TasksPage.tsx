import { useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { PERMISSIONS, Priority, TaskStatus } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/States';
import { Pagination } from '@/components/ui/Table';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { useProjects } from '@/features/projects/api';
import { TaskFormModal } from '@/features/tasks/TaskFormModal';
import { TaskDetailModal } from '@/features/tasks/TaskDetailModal';
import { TaskRow } from '@/features/tasks/TaskRow';
import { useTaskSummary, useTasks } from '@/features/tasks/api';
import type { Task } from '@/features/tasks/types';
import { toMessage } from '@/lib/api';
import { cn, humanise } from '@/lib/utils';

export default function TasksPage() {
  const { can, user } = useAuth();
  const canWrite = can(PERMISSIONS.TASK_WRITE);

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
    page,
    pageSize: 25,
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
          <>
            <ul className="divide-y divide-line">
              {query.data.items.map((task) => (
                <TaskRow key={task.id} task={task} showProject onOpen={() => setViewing(task)} />
              ))}
            </ul>
            <Pagination meta={query.data.meta} onPageChange={setPage} label="tasks" />
          </>
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
