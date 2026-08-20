import { Badge } from '@/components/ui/Badge';
import { PRIORITY_TONES, TASK_STATUS_TONES } from '@/components/ui/tones';
import { cn, humanise, plural, relativeTime } from '@/lib/utils';
import type { Task } from './types';

/**
 * One line of work.
 *
 * A late task carries the edge marker and the danger tone, while its status
 * badge still says what the person doing it is actually doing.
 */
export function TaskRow({
  task,
  onOpen,
  showProject = false,
}: {
  task: Task;
  onOpen: () => void;
  showProject?: boolean;
}) {
  const context = [
    task.reference,
    showProject ? task.project?.name : task.milestone?.name,
    task._count.comments > 0 ? plural(task._count.comments, 'comment') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-panel-muted',
          task.isOverdue && 'edge-marker text-danger',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] font-medium text-ink">{task.title}</span>
          <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-faint">
            {context}
          </span>
        </span>

        <Badge tone={PRIORITY_TONES[task.priority] ?? 'neutral'}>{task.priority}</Badge>
        <Badge tone={TASK_STATUS_TONES[task.status] ?? 'neutral'}>{humanise(task.status)}</Badge>

        <span className="w-28 shrink-0 truncate text-right text-[0.8125rem] text-ink-soft">
          {task.assignee ? `${task.assignee.firstName} ${task.assignee.lastName}` : 'Unassigned'}
        </span>

        <span
          className={cn(
            'w-24 shrink-0 text-right font-mono text-[0.6875rem]',
            task.isOverdue ? 'font-medium text-danger' : 'text-ink-faint',
          )}
        >
          {task.dueAt ? relativeTime(task.dueAt) : 'No deadline'}
        </span>
      </button>
    </li>
  );
}
