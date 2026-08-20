import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Send } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSIONS, TaskStatus } from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { PRIORITY_TONES, TASK_STATUS_TONES } from '@/components/ui/tones';
import { LoadingState } from '@/components/ui/States';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { toMessage } from '@/lib/api';
import { cn, formatDate, formatDateTime, humanise, relativeTime } from '@/lib/utils';
import {
  useAddTaskComment,
  useAssignTask,
  useChangeTaskStatus,
  useTaskComments,
} from './api';
import type { Task } from './types';

/**
 * The task, its discussion and the two controls people actually reach for:
 * who is doing it, and where it has got to.
 */
export function TaskDetailModal({
  task,
  onClose,
  onEdit,
}: {
  task: Task;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.TASK_WRITE);
  const canAssign = can(PERMISSIONS.TASK_ASSIGN);

  const comments = useTaskComments(task.id);
  const team = useUsers({ page: 1, pageSize: 100 });
  const changeStatus = useChangeTaskStatus();
  const assignTask = useAssignTask();
  const addComment = useAddTaskComment();

  const [draft, setDraft] = useState('');
  const [actualHours, setActualHours] = useState('');

  const onStatusChange = async (status: TaskStatus): Promise<void> => {
    if (status === task.status) return;
    try {
      await changeStatus.mutateAsync({
        id: task.id,
        status,
        ...(status === TaskStatus.COMPLETED && actualHours ? { actualHours: Number(actualHours) } : {}),
      });
      toast.success(`${task.reference} moved to ${humanise(status)}`);
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  const onAssign = async (assigneeId: string): Promise<void> => {
    try {
      await assignTask.mutateAsync({ id: task.id, assigneeId: assigneeId || null });
      toast.success('Assignment updated');
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  const onComment = async (): Promise<void> => {
    if (draft.trim() === '') return;
    try {
      await addComment.mutateAsync({ id: task.id, body: draft });
      setDraft('');
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={task.title}
      description={`${task.reference}${task.project ? ` · ${task.project.name}` : ''}`}
      footer={
        canWrite ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" onClick={onEdit}>
              Edit task
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TASK_STATUS_TONES[task.status] ?? 'neutral'}>{humanise(task.status)}</Badge>
          <Badge tone={PRIORITY_TONES[task.priority] ?? 'neutral'}>{humanise(task.priority)}</Badge>
          {/* Lateness sits beside the status, never replaces it. */}
          {task.isOverdue ? (
            <Badge tone="danger">
              <AlarmClock aria-hidden className="mr-1 inline size-3" />
              Overdue
            </Badge>
          ) : task.isDueToday ? (
            <Badge tone="warning">Due today</Badge>
          ) : null}
        </div>

        {task.description ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
            {task.description}
          </p>
        ) : null}

        {canWrite ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="taskDetailStatus">
              <Select
                id="taskDetailStatus"
                value={task.status}
                disabled={changeStatus.isPending}
                onChange={(event) => void onStatusChange(event.target.value as TaskStatus)}
              >
                {Object.values(TaskStatus).map((entry) => (
                  <option key={entry} value={entry}>
                    {humanise(entry)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Assigned to" htmlFor="taskDetailAssignee">
              <Select
                id="taskDetailAssignee"
                value={task.assignee?.id ?? ''}
                disabled={!canAssign || assignTask.isPending}
                onChange={(event) => void onAssign(event.target.value)}
              >
                <option value="">Nobody yet</option>
                {team.data?.items.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </Select>
            </Field>

            {task.status !== TaskStatus.COMPLETED ? (
              <Field
                label="Hours spent"
                htmlFor="taskDetailHours"
                hint="Recorded when you mark it complete."
                className="sm:col-span-2"
              >
                <input
                  id="taskDetailHours"
                  type="number"
                  min="0"
                  step="0.5"
                  value={actualHours}
                  onChange={(event) => setActualHours(event.target.value)}
                  className="tabular h-9.5 w-full rounded-md border border-line-strong bg-panel px-3 text-sm text-ink"
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        <dl className="grid gap-3 rounded-md border border-line bg-panel-muted px-4 py-3.5 sm:grid-cols-2">
          <Row label="Due">
            {task.dueAt ? (
              <span className={cn(task.isOverdue && 'font-medium text-danger')}>
                {formatDateTime(task.dueAt)}
                <span className="ml-1.5 font-mono text-[0.6875rem] text-ink-faint">
                  {relativeTime(task.dueAt)}
                </span>
              </span>
            ) : (
              'No deadline'
            )}
          </Row>
          <Row label="Started">{formatDate(task.startDate)}</Row>
          <Row label="Estimated">
            {task.estimatedHours === null ? '—' : `${task.estimatedHours}h`}
          </Row>
          <Row label="Actual">{task.actualHours === null ? '—' : `${task.actualHours}h`}</Row>
          <Row label="Milestone">{task.milestone?.name ?? '—'}</Row>
          <Row label="Client">
            {task.client ? (
              <Link to={`/clients/${task.client.id}`} className="hover:text-accent">
                {task.client.companyName}
              </Link>
            ) : (
              '—'
            )}
          </Row>
        </dl>

        <section>
          <p className="eyebrow mb-2.5">Discussion</p>

          {comments.isPending || !comments.data ? (
            <LoadingState label="Loading comments" />
          ) : comments.data.length === 0 ? (
            <p className="text-[0.8125rem] text-ink-faint">
              Nothing said yet. Keep the discussion with the work.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {comments.data.map((comment) => (
                <li key={comment.id} className="rounded-md border border-line px-3.5 py-2.5">
                  <p className="text-[0.8125rem] whitespace-pre-wrap text-ink-soft">
                    {comment.body}
                  </p>
                  <p className="mt-1.5 font-mono text-[0.625rem] text-ink-faint">
                    {comment.user
                      ? `${comment.user.firstName} ${comment.user.lastName} · `
                      : ''}
                    {formatDateTime(comment.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <div className="mt-3 flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a comment"
                aria-label="Add a comment"
                className="min-h-16"
              />
              <Button
                variant="primary"
                onClick={() => void onComment()}
                loading={addComment.isPending}
                disabled={draft.trim() === ''}
                aria-label="Post comment"
              >
                <Send aria-hidden className="size-4" />
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[0.8125rem] text-ink-faint">{label}</dt>
      <dd className="text-right text-[0.8125rem] text-ink">{children}</dd>
    </div>
  );
}
