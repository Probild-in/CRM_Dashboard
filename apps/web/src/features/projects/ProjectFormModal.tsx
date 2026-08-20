import { useState } from 'react';
import { toast } from 'sonner';
import { Currency, Priority, ProjectStatus } from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useUsers } from '@/features/users/api';
import { useClients } from '@/features/clients/api';
import { useServices } from '@/features/leads/api';
import { toMessage } from '@/lib/api';
import { fromDateInput, humanise, toDateInput } from '@/lib/utils';
import { useCreateProject, useUpdateProject } from './api';
import type { Project } from './types';

export function ProjectFormModal({
  onClose,
  project,
  fixedClientId,
}: {
  onClose: () => void;
  /** Present when editing; absent when starting a new project. */
  project?: Project | null;
  /** Locks the client when opened from a client profile. */
  fixedClientId?: string;
}) {
  const isEdit = Boolean(project);
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const clients = useClients({ page: 1, pageSize: 100 });
  const team = useUsers({ page: 1, pageSize: 100 });
  const services = useServices();

  const [clientId, setClientId] = useState(project?.client.id ?? fixedClientId ?? '');
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [managerId, setManagerId] = useState(project?.manager?.id ?? '');
  const [priority, setPriority] = useState<Priority>(project?.priority ?? Priority.MEDIUM);
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? ProjectStatus.PLANNING);
  const [value, setValue] = useState(String(project?.value ?? 0));
  const [currency, setCurrency] = useState<Currency>(project?.currency ?? Currency.INR);
  const [startDate, setStartDate] = useState(toDateInput(project?.startDate));
  const [deliveryDate, setDeliveryDate] = useState(toDateInput(project?.deliveryDate));
  const [serviceIds, setServiceIds] = useState<string[]>(
    project?.services.map((service) => service.id) ?? [],
  );
  const [memberIds, setMemberIds] = useState<string[]>(
    project?.members.map((member) => member.user.id) ?? [],
  );
  const [valueChangeReason, setValueChangeReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pending = createProject.isPending || updateProject.isPending;
  const valueChanged = isEdit && Number(value) !== project?.value;

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];

  const onSubmit = async (): Promise<void> => {
    const nextErrors: Record<string, string> = {};
    if (!clientId) nextErrors.clientId = 'Choose the client this is for.';
    if (name.trim() === '') nextErrors.name = 'Give the project a name.';
    if (startDate && deliveryDate && deliveryDate < startDate)
      nextErrors.deliveryDate = 'Delivery cannot be before the start date.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    try {
      if (isEdit && project) {
        await updateProject.mutateAsync({
          id: project.id,
          name,
          description,
          managerId: managerId || null,
          priority,
          value: Number(value) || 0,
          currency,
          startDate: fromDateInput(startDate),
          deliveryDate: fromDateInput(deliveryDate),
          serviceIds,
          ...(valueChanged && valueChangeReason ? { valueChangeReason } : {}),
        });
        toast.success(`Saved ${project.reference}`);
      } else {
        const created = await createProject.mutateAsync({
          clientId,
          name,
          description,
          managerId: managerId || null,
          status,
          priority,
          value: Number(value) || 0,
          currency,
          startDate: fromDateInput(startDate),
          deliveryDate: fromDateInput(deliveryDate),
          serviceIds,
          memberIds,
        });
        toast.success(`Created ${created.reference} — ${created.name}`);
      }
      onClose();
    } catch (error) {
      toast.error(toMessage(error));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit ${project?.reference}` : 'New project'}
      description={
        isEdit
          ? 'Use the status action to move the project, so the change is recorded.'
          : 'Set a delivery date and Probild will warn you before it slips.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={pending}>
            {isEdit ? 'Save project' : 'Create project'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" htmlFor="projectClient" error={errors.clientId} required>
            <Select
              id="projectClient"
              value={clientId}
              disabled={isEdit || Boolean(fixedClientId)}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">Choose a client</option>
              {clients.data?.items.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.companyName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project name" htmlFor="projectName" error={errors.name} required>
            <Input
              id="projectName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Website rebuild"
            />
          </Field>

          <Field label="Project manager" htmlFor="projectManager" hint="Defaults to you.">
            <Select
              id="projectManager"
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
            >
              <option value="">Assign to me</option>
              {team.data?.items.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="projectPriority">
            <Select
              id="projectPriority"
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
            <Field label="Starting status" htmlFor="projectStatus">
              <Select
                id="projectStatus"
                value={status}
                onChange={(event) => setStatus(event.target.value as ProjectStatus)}
              >
                {Object.values(ProjectStatus).map((entry) => (
                  <option key={entry} value={entry}>
                    {humanise(entry)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Project value" htmlFor="projectValue">
            <Input
              id="projectValue"
              type="number"
              min="0"
              step="1000"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="tabular"
            />
          </Field>
          <Field label="Currency" htmlFor="projectCurrency">
            <Select
              id="projectCurrency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as Currency)}
            >
              {Object.values(Currency).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Start date" htmlFor="projectStart">
            <Input
              id="projectStart"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field
            label="Delivery date"
            htmlFor="projectDelivery"
            error={errors.deliveryDate}
            hint="You will be warned as this approaches."
          >
            <Input
              id="projectDelivery"
              type="date"
              value={deliveryDate}
              onChange={(event) => setDeliveryDate(event.target.value)}
            />
          </Field>
        </div>

        {valueChanged ? (
          <Field
            label="Why is the value changing?"
            htmlFor="projectValueReason"
            hint="Kept with the old and new figures in the project's history."
          >
            <Input
              id="projectValueReason"
              value={valueChangeReason}
              onChange={(event) => setValueChangeReason(event.target.value)}
              placeholder="Extra scope agreed with the client"
            />
          </Field>
        ) : null}

        <fieldset>
          <legend className="eyebrow mb-2">Services being delivered</legend>
          <div className="flex flex-wrap gap-1.5">
            {services.data?.map((service) => {
              const selected = serviceIds.includes(service.id);
              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => setServiceIds((current) => toggle(current, service.id))}
                  className={
                    selected
                      ? 'rounded-md border border-accent bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent'
                      : 'rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-soft hover:border-line-strong'
                  }
                >
                  {service.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        {!isEdit ? (
          <fieldset>
            <legend className="eyebrow mb-2">Team</legend>
            <div className="flex flex-wrap gap-1.5">
              {team.data?.items.map((member) => {
                const selected = memberIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setMemberIds((current) => toggle(current, member.id))}
                    className={
                      selected
                        ? 'rounded-md border border-accent bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent'
                        : 'rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-soft hover:border-line-strong'
                    }
                  >
                    {member.fullName}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-ink-faint">
              The project manager is added automatically.
            </p>
          </fieldset>
        ) : null}

        <Field label="Description" htmlFor="projectDescription">
          <Textarea
            id="projectDescription"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is being built, and anything the team should know"
          />
        </Field>
      </div>
    </Modal>
  );
}
