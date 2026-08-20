import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlarmClock, ArrowLeft, ArrowRight, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { MilestoneStatus, PERMISSIONS, ProjectStatus } from '@probild/shared';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import {
  MILESTONE_STATUS_TONES,
  PRIORITY_TONES,
  PROJECT_STATUS_TONES,
} from '@/components/ui/tones';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { useAuth } from '@/features/auth/AuthContext';
import { useUsers } from '@/features/users/api';
import { ProjectFormModal } from '@/features/projects/ProjectFormModal';
import { TaskFormModal } from '@/features/tasks/TaskFormModal';
import { TaskDetailModal } from '@/features/tasks/TaskDetailModal';
import { TaskRow } from '@/features/tasks/TaskRow';
import {
  useAddMember,
  useChangeProjectStatus,
  useCreateMilestone,
  useDeleteMilestone,
  useMilestones,
  useProject,
  useRemoveMember,
  useUpdateMilestone,
} from '@/features/projects/api';
import { useTasks } from '@/features/tasks/api';
import type { Milestone } from '@/features/projects/types';
import type { Task } from '@/features/tasks/types';
import { toMessage } from '@/lib/api';
import {
  cn,
  formatDate,
  formatDateTime,
  formatMoney,
  humanise,
  initials,
  plural,
  relativeTime,
} from '@/lib/utils';

export default function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.PROJECT_WRITE);
  const canMilestones = can(PERMISSIONS.MILESTONE_WRITE);
  const canTasks = can(PERMISSIONS.TASK_WRITE);

  const [tab, setTab] = useState('milestones');
  const [editOpen, setEditOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<ProjectStatus | ''>('');
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [milestoneName, setMilestoneName] = useState('');
  const [milestoneDue, setMilestoneDue] = useState('');
  const [removingMilestone, setRemovingMilestone] = useState<Milestone | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [memberRole, setMemberRole] = useState('');
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [viewingTask, setViewingTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const project = useProject(id);
  const milestones = useMilestones(id);
  const tasks = useTasks({ page: 1, pageSize: 100, projectId: id });
  const team = useUsers({ page: 1, pageSize: 100 });

  const changeStatus = useChangeProjectStatus();
  const createMilestone = useCreateMilestone(id);
  const updateMilestone = useUpdateMilestone(id);
  const deleteMilestone = useDeleteMilestone(id);
  const addMember = useAddMember(id);
  const removeMember = useRemoveMember(id);

  if (project.isPending) return <LoadingState label="Loading project" />;
  if (project.isError) {
    return (
      <Panel>
        <ErrorState
          title="This project did not load"
          message={toMessage(project.error)}
          onRetry={() => void project.refetch()}
        />
      </Panel>
    );
  }

  const record = project.data;
  const openTasks = tasks.data?.items.filter((task) => !['COMPLETED', 'CANCELLED'].includes(task.status)) ?? [];
  const overdueTasks = tasks.data?.items.filter((task) => task.isOverdue) ?? [];

  const TABS = [
    { key: 'milestones', label: 'Milestones', count: milestones.data?.length },
    { key: 'tasks', label: 'Tasks', count: tasks.data?.items.length },
    { key: 'team', label: 'Team', count: record.members.length },
    { key: 'details', label: 'Details' },
  ];

  return (
    <>
      <Link
        to="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-faint hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All projects
      </Link>

      <PageHeader
        eyebrow={record.reference}
        title={record.name}
        description={
          <>
            For{' '}
            <Link to={`/clients/${record.client.id}`} className="text-ink-soft hover:text-accent">
              {record.client.companyName}
            </Link>
          </>
        }
        action={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setStatusOpen(true)}>
                <ArrowRight aria-hidden className="size-4" />
                Move status
              </Button>
              <Button variant="primary" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden className="size-4" />
                Edit
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={PROJECT_STATUS_TONES[record.status] ?? 'neutral'}>
          {humanise(record.status)}
        </Badge>
        <Badge tone={PRIORITY_TONES[record.priority] ?? 'neutral'}>
          {humanise(record.priority)} priority
        </Badge>
        {record.isOverdue ? <Badge tone="danger">Past delivery date</Badge> : null}
        {record.deal ? <Badge tone="accent">Deal {record.deal.reference}</Badge> : null}
      </div>

      <div className="mb-6 grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-panel px-5 py-4">
          <p className="eyebrow">Progress</p>
          <p className="tabular mt-2 font-display text-lg font-semibold text-ink">
            {record.progress}%
          </p>
          <ProgressBar
            value={record.progress}
            tone={record.isOverdue ? 'warning' : 'accent'}
            className="mt-2"
          />
        </div>
        <Metric
          label="Delivery"
          value={record.deliveryDate ? formatDate(record.deliveryDate) : '—'}
          hint={
            record.deliveryDate
              ? record.isOverdue
                ? `${relativeTime(record.deliveryDate)} — late`
                : relativeTime(record.deliveryDate)
              : 'No date set'
          }
          tone={record.isOverdue ? 'danger' : undefined}
        />
        <Metric
          label="Open tasks"
          value={String(openTasks.length)}
          hint={overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : 'None overdue'}
          tone={overdueTasks.length > 0 ? 'danger' : undefined}
        />
        <Metric
          label="Value"
          value={formatMoney(record.value, record.currency)}
          hint={`${record.members.length} on the team`}
        />
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <TabPanel active={tab} tabKey="milestones">
        <Panel>
          <PanelHeader
            eyebrow="Delivery stages"
            title="Milestones"
            action={
              canMilestones ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setMilestoneName('');
                    setMilestoneDue('');
                    setMilestoneOpen(true);
                  }}
                >
                  <Plus aria-hidden className="size-4" />
                  Add milestone
                </Button>
              ) : null
            }
          />
          {milestones.isPending || !milestones.data ? (
            <LoadingState label="Loading milestones" />
          ) : milestones.data.length === 0 ? (
            <EmptyState
              title="No milestones yet"
              description="Break delivery into stages and the project's progress follows them automatically."
            />
          ) : (
            <ul className="divide-y divide-line">
              {milestones.data.map((milestone) => (
                <li key={milestone.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                  <span className="tabular w-6 shrink-0 font-mono text-[0.6875rem] text-ink-faint">
                    {String(milestone.position + 1).padStart(2, '0')}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink">
                      {milestone.name}
                      {milestone.isOverdue ? (
                        <AlarmClock aria-label="Overdue" className="size-3.5 text-danger" />
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {milestone.dueDate ? `Due ${formatDate(milestone.dueDate)}` : 'No due date'}
                      {milestone._count.tasks > 0
                        ? ` · ${plural(milestone._count.tasks, 'task')}`
                        : ''}
                    </p>
                  </div>

                  <ProgressBar
                    value={milestone.completionPercent}
                    tone={milestone.isOverdue ? 'warning' : 'accent'}
                    showLabel
                    className="w-36 shrink-0"
                  />

                  {canMilestones ? (
                    <Select
                      value={milestone.status}
                      aria-label={`Status for ${milestone.name}`}
                      className="h-8 w-auto shrink-0 text-xs"
                      onChange={async (event) => {
                        try {
                          await updateMilestone.mutateAsync({
                            id: milestone.id,
                            status: event.target.value as MilestoneStatus,
                          });
                        } catch (error) {
                          toast.error(toMessage(error));
                        }
                      }}
                    >
                      {Object.values(MilestoneStatus).map((entry) => (
                        <option key={entry} value={entry}>
                          {humanise(entry)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge tone={MILESTONE_STATUS_TONES[milestone.status] ?? 'neutral'}>
                      {humanise(milestone.status)}
                    </Badge>
                  )}

                  {canMilestones ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${milestone.name}`}
                      onClick={() => setRemovingMilestone(milestone)}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="tasks">
        <Panel>
          <PanelHeader
            eyebrow="The work"
            title="Tasks"
            action={
              canTasks ? (
                <Button size="sm" variant="secondary" onClick={() => setTaskFormOpen(true)}>
                  <Plus aria-hidden className="size-4" />
                  Add task
                </Button>
              ) : null
            }
          />
          {tasks.isPending || !tasks.data ? (
            <LoadingState label="Loading tasks" />
          ) : tasks.data.items.length === 0 ? (
            <EmptyState
              title="No tasks on this project"
              description="Add the work that needs doing, with owners and deadlines."
            />
          ) : (
            <ul className="divide-y divide-line">
              {tasks.data.items.map((task) => (
                <TaskRow key={task.id} task={task} onOpen={() => setViewingTask(task)} />
              ))}
            </ul>
          )}
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="team">
        <Panel>
          <PanelHeader
            eyebrow="Who is on it"
            title="Team"
            action={
              canWrite ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setMemberId('');
                    setMemberRole('');
                    setMemberOpen(true);
                  }}
                >
                  <UserPlus aria-hidden className="size-4" />
                  Add member
                </Button>
              ) : null
            }
          />
          <ul className="divide-y divide-line">
            {record.members.map((member) => {
              const isManager = member.user.id === record.manager?.id;
              return (
                <li key={member.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded bg-neutral-soft font-mono text-[0.6875rem] font-semibold text-ink-soft">
                    {initials(member.user.firstName, member.user.lastName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8125rem] font-medium text-ink">
                      {member.user.firstName} {member.user.lastName}
                      {isManager ? (
                        <span className="ml-2 font-mono text-[0.625rem] text-accent">MANAGER</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-ink-faint">
                      {member.roleLabel ?? humanise(member.user.role)} · {member.user.email}
                    </p>
                  </div>
                  {canWrite && !isManager ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${member.user.firstName}`}
                      onClick={async () => {
                        try {
                          await removeMember.mutateAsync(member.user.id);
                          toast.success('Removed from the project');
                        } catch (error) {
                          toast.error(toMessage(error));
                        }
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Panel>
      </TabPanel>

      <TabPanel active={tab} tabKey="details">
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel>
            <PanelHeader eyebrow="Dates and money" title="Details" />
            <PanelBody className="flex flex-col gap-3">
              <Row label="Started">{formatDate(record.startDate)}</Row>
              <Row label="Delivery">{formatDate(record.deliveryDate)}</Row>
              <Row label="Completed">
                {record.completedAt ? formatDateTime(record.completedAt) : '—'}
              </Row>
              <Row label="Value">{formatMoney(record.value, record.currency)}</Row>
              <Row label="Services">
                {record.services.length > 0
                  ? record.services.map((service) => service.name).join(', ')
                  : '—'}
              </Row>
            </PanelBody>
          </Panel>

          {record.description ? (
            <Panel>
              <PanelHeader eyebrow="Context" title="Description" />
              <PanelBody>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
                  {record.description}
                </p>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </TabPanel>

      {editOpen ? (
        <ProjectFormModal onClose={() => setEditOpen(false)} project={record} />
      ) : null}

      {taskFormOpen ? (
        <TaskFormModal onClose={() => setTaskFormOpen(false)} fixedProjectId={id} />
      ) : null}

      {editingTask ? (
        <TaskFormModal
          key={editingTask.id}
          onClose={() => setEditingTask(null)}
          task={editingTask}
          fixedProjectId={id}
        />
      ) : viewingTask ? (
        <TaskDetailModal
          key={viewingTask.id}
          task={tasks.data?.items.find((entry) => entry.id === viewingTask.id) ?? viewingTask}
          onClose={() => setViewingTask(null)}
          onEdit={() => {
            setEditingTask(viewingTask);
            setViewingTask(null);
          }}
        />
      ) : null}

      <Modal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        size="sm"
        title="Move this project"
        description={`Currently ${humanise(record.status).toLowerCase()}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!nextStatus}
              loading={changeStatus.isPending}
              onClick={async () => {
                if (!nextStatus) return;
                try {
                  await changeStatus.mutateAsync({ id, status: nextStatus });
                  toast.success(`${record.reference} moved to ${humanise(nextStatus)}`);
                  setStatusOpen(false);
                  setNextStatus('');
                } catch (error) {
                  toast.error(toMessage(error));
                }
              }}
            >
              Move it
            </Button>
          </>
        }
      >
        <Field
          label="New status"
          htmlFor="projectNextStatus"
          hint={
            nextStatus === ProjectStatus.COMPLETED
              ? 'Completing a project sets its progress to 100%.'
              : undefined
          }
        >
          <Select
            id="projectNextStatus"
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value as ProjectStatus)}
          >
            <option value="">Choose a status</option>
            {Object.values(ProjectStatus)
              .filter((entry) => entry !== record.status)
              .map((entry) => (
                <option key={entry} value={entry}>
                  {humanise(entry)}
                </option>
              ))}
          </Select>
        </Field>
      </Modal>

      <Modal
        open={milestoneOpen}
        onClose={() => setMilestoneOpen(false)}
        size="sm"
        title="Add a milestone"
        description="Progress is averaged across the milestones that still count."
        footer={
          <>
            <Button variant="ghost" onClick={() => setMilestoneOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createMilestone.isPending}
              disabled={milestoneName.trim() === ''}
              onClick={async () => {
                try {
                  await createMilestone.mutateAsync({
                    name: milestoneName,
                    dueDate: milestoneDue || null,
                  });
                  toast.success(`Added "${milestoneName}"`);
                  setMilestoneOpen(false);
                } catch (error) {
                  toast.error(toMessage(error));
                }
              }}
            >
              Add milestone
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="milestoneName" required>
            <Input
              id="milestoneName"
              value={milestoneName}
              onChange={(event) => setMilestoneName(event.target.value)}
              placeholder="UI/UX design"
            />
          </Field>
          <Field label="Due date" htmlFor="milestoneDue">
            <Input
              id="milestoneDue"
              type="date"
              value={milestoneDue}
              onChange={(event) => setMilestoneDue(event.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={memberOpen}
        onClose={() => setMemberOpen(false)}
        size="sm"
        title="Add someone to the project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMemberOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!memberId}
              loading={addMember.isPending}
              onClick={async () => {
                try {
                  await addMember.mutateAsync({
                    userId: memberId,
                    ...(memberRole ? { roleLabel: memberRole } : {}),
                  });
                  toast.success('Added to the project');
                  setMemberOpen(false);
                } catch (error) {
                  toast.error(toMessage(error));
                }
              }}
            >
              Add member
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Team member" htmlFor="newMember" required>
            <Select
              id="newMember"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            >
              <option value="">Choose someone</option>
              {team.data?.items
                .filter(
                  (member) => !record.members.some((entry) => entry.user.id === member.id),
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="What they do here" htmlFor="memberRole">
            <Input
              id="memberRole"
              value={memberRole}
              onChange={(event) => setMemberRole(event.target.value)}
              placeholder="Frontend developer"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(removingMilestone)}
        onClose={() => setRemovingMilestone(null)}
        loading={deleteMilestone.isPending}
        destructive
        title="Remove this milestone?"
        confirmLabel="Remove"
        message={
          removingMilestone
            ? `"${removingMilestone.name}" will be removed and the project's progress recalculated.`
            : ''
        }
        onConfirm={async () => {
          if (!removingMilestone) return;
          try {
            await deleteMilestone.mutateAsync(removingMilestone.id);
            toast.success('Milestone removed');
            setRemovingMilestone(null);
          } catch (error) {
            toast.error(toMessage(error));
          }
        }}
      />
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
      <p className="tabular mt-2 font-display text-lg font-semibold text-ink">{value}</p>
      <p className={cn('mt-0.5 text-xs', tone === 'danger' ? 'text-danger' : 'text-ink-faint')}>
        {hint}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-[0.8125rem] text-ink-faint">{label}</span>
      <span className="text-right text-[0.8125rem] text-ink">{children}</span>
    </div>
  );
}
