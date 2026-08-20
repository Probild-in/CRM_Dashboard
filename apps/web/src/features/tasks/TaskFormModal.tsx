import { useState } from 'react';
import { toast } from 'sonner';
import { Priority, TaskStatus } from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useUsers } from '@/features/users/api';
import { useMilestones, useProjects } from '@/features/projects/api';
import { toMessage } from '@/lib/api';
import { fromDateInput, humanise, toDateInput, toDateTimeInput } from '@/lib/utils';
import { useCreateTask, useUpdateTask } from './api';
import type { Task } from './types';

export function TaskFormModal({
  onClose,
  task,
  fixedProjectId,
  fixedMilestoneId,
}: {
  onClose: () => void;
  task?: Task | null;
  fixedProjectId?: string;
  fixedMilestoneId?: string;
}) {
  const isEdit = Boolean(task);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const team = useUsers({ page: 1, pageSize: 100 });
  const projects = useProjects({ page: 1, pageSize: 100, activeOnly: true });

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [projectId, setProjectId] = useState(task?.project?.id ?? fixedProjectId ?? '');
  const [milestoneId, setMilestoneId] = useState(task?.milestone?.id ?? fixedMilestoneId ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assignee?.id ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? TaskStatus.TODO);
  const [priority, setPriority] = useState<Priority>(task?.priority ?? Priority.MEDIUM);
  const [startDate, setStartDate] = useState(toDateInput(task?.startDate));
  const [dueAt, setDueAt] = useState(toDateTimeInput(task?.dueAt));
  const [estimatedHours, setEstimatedHours] = useState(
    task?.estimatedHours === null || task?.estimatedHours === undefined
      ? ''
      : String(task.estimatedHours),
  );
  const [error, setError] = useState<string | null>(null);

  const milestones = useMilestones(projectId || undefined);
  const pending = createTask.isPending || updateTask.isPending;

  const onSubmit = async (): Promise<void> => {
    if (title.trim() === '') {
      setError('Give the task a title.');
      return;
    }

    const shared = {
      title,
      description,
      milestoneId: milestoneId || null,
      assigneeId: assigneeId || null,
      priority,
      startDate: fromDateInput(startDate),
      dueAt: fromDateInput(dueAt),
      estimatedHours: estimatedHours === '' ? null : Number(estimatedHours),
    };

    try {
      if (isEdit && task) {
        await updateTask.mutateAsync({ id: task.id, ...shared });
        toast.success(`Saved ${task.reference}`);
      } else {
        const created = await createTask.mutateAsync({
          ...shared,
          projectId: projectId || null,
          status,
        });
        toast.success(`Created ${created.reference}`);
      }
      onClose();
    } catch (caught) {
      toast.error(toMessage(caught));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${task?.reference}` : 'New task'}
      description={
        isEdit
          ? 'Use the status control on the task to move it, so the change is recorded.'
          : 'A due time is what the reminders are built on.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={pending}>
            {isEdit ? 'Save task' : 'Create task'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="taskTitle" error={error ?? undefined} required>
          <Input
            id="taskTitle"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Create the homepage"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" htmlFor="taskProject" hint="The client follows the project.">
            <Select
              id="taskProject"
              value={projectId}
              disabled={isEdit || Boolean(fixedProjectId)}
              onChange={(event) => {
                setProjectId(event.target.value);
                // A milestone from the old project would not belong here.
                setMilestoneId('');
              }}
            >
              <option value="">No project</option>
              {projects.data?.items.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Milestone" htmlFor="taskMilestone">
            <Select
              id="taskMilestone"
              value={milestoneId}
              disabled={!projectId}
              onChange={(event) => setMilestoneId(event.target.value)}
            >
              <option value="">{projectId ? 'No milestone' : 'Choose a project first'}</option>
              {milestones.data?.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assigned to" htmlFor="taskAssignee">
            <Select
              id="taskAssignee"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">Nobody yet</option>
              {team.data?.items.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" htmlFor="taskPriority">
            <Select
              id="taskPriority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {Object.values(Priority).map((entry) => (
                <option key={entry} value={entry}>
                  {humanise(entry)}
                </option>
              ))}
            </Select>
          </Field>

          {!isEdit ? (
            <Field label="Starting status" htmlFor="taskStatus">
              <Select
                id="taskStatus"
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
              >
                {Object.values(TaskStatus).map((entry) => (
                  <option key={entry} value={entry}>
                    {humanise(entry)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Start date" htmlFor="taskStart">
            <Input
              id="taskStart"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>

          <Field label="Due" htmlFor="taskDue" hint="Date and time in your zone.">
            <Input
              id="taskDue"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>

          <Field label="Estimated hours" htmlFor="taskEstimate">
            <Input
              id="taskEstimate"
              type="number"
              min="0"
              step="0.5"
              value={estimatedHours}
              onChange={(event) => setEstimatedHours(event.target.value)}
              className="tabular"
            />
          </Field>
        </div>

        <Field label="Details" htmlFor="taskDescription">
          <Textarea
            id="taskDescription"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What needs doing, and what done looks like"
          />
        </Field>
      </div>
    </Modal>
  );
}
