import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Currency, LeadSource, Priority } from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useUsers } from '@/features/users/api';
import { toFieldErrors, toMessage } from '@/lib/api';
import { fromDateInput, humanise, toDateInput, toDateTimeInput } from '@/lib/utils';
import { useCreateLead, useServices, useUpdateLead, type LeadFormBody } from './api';
import type { Lead } from './types';

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => value === '' || /^https?:\/\/\S+$/i.test(value), {
    message: 'Start the address with http:// or https://',
  });

const leadFormSchema = z.object({
  companyName: z.string().trim().min(1, 'Enter the company name.').max(191),
  contactPerson: z.string().trim().max(150),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || z.string().email().safeParse(value).success, {
      message: 'That is not a valid email address.',
    }),
  phone: z.string().trim().max(32),
  whatsapp: z.string().trim().max(32),
  country: z.string().trim().max(80),
  city: z.string().trim().max(80),
  industry: z.string().trim().max(120),
  website: optionalUrl,
  linkedin: optionalUrl,
  source: z.nativeEnum(LeadSource),
  priority: z.nativeEnum(Priority),
  interestedServiceId: z.string(),
  expectedValue: z.string(),
  currency: z.nativeEnum(Currency),
  expectedCloseDate: z.string(),
  nextFollowUpAt: z.string(),
  assignedToId: z.string(),
  notes: z.string().max(5000),
});

type LeadFormValues = z.infer<typeof leadFormSchema>;

const EMPTY: LeadFormValues = {
  companyName: '',
  contactPerson: '',
  email: '',
  phone: '',
  whatsapp: '',
  country: 'India',
  city: '',
  industry: '',
  website: '',
  linkedin: '',
  source: LeadSource.WEBSITE,
  priority: Priority.MEDIUM,
  interestedServiceId: '',
  expectedValue: '',
  currency: Currency.INR,
  expectedCloseDate: '',
  nextFollowUpAt: '',
  assignedToId: '',
  notes: '',
};

export function LeadFormModal({
  open,
  onClose,
  lead,
}: {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
}) {
  const isEdit = Boolean(lead);
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const services = useServices();
  const team = useUsers({ page: 1, pageSize: 100 });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues>({ resolver: zodResolver(leadFormSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    reset(
      lead
        ? {
            companyName: lead.companyName,
            contactPerson: lead.contactPerson ?? '',
            email: lead.email ?? '',
            phone: lead.phone ?? '',
            whatsapp: lead.whatsapp ?? '',
            country: lead.country ?? '',
            city: lead.city ?? '',
            industry: lead.industry ?? '',
            website: lead.website ?? '',
            linkedin: lead.linkedin ?? '',
            source: lead.source,
            priority: lead.priority,
            interestedServiceId: lead.interestedService?.id ?? '',
            expectedValue: lead.expectedValue === null ? '' : String(lead.expectedValue),
            currency: lead.currency,
            expectedCloseDate: toDateInput(lead.expectedCloseDate),
            nextFollowUpAt: toDateTimeInput(lead.nextFollowUpAt),
            assignedToId: lead.assignedTo?.id ?? '',
            notes: lead.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, lead, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const body: LeadFormBody = {
      companyName: values.companyName,
      contactPerson: values.contactPerson,
      email: values.email,
      phone: values.phone,
      whatsapp: values.whatsapp,
      country: values.country,
      city: values.city,
      industry: values.industry,
      website: values.website,
      linkedin: values.linkedin,
      source: values.source,
      priority: values.priority,
      interestedServiceId: values.interestedServiceId || null,
      expectedValue: values.expectedValue === '' ? null : Number(values.expectedValue),
      currency: values.currency,
      expectedCloseDate: fromDateInput(values.expectedCloseDate),
      nextFollowUpAt: fromDateInput(values.nextFollowUpAt),
      assignedToId: values.assignedToId || null,
      notes: values.notes,
    };

    try {
      if (isEdit && lead) {
        await updateLead.mutateAsync({ id: lead.id, ...body });
        toast.success(`Saved ${values.companyName}`);
      } else {
        const created = await createLead.mutateAsync(body);
        toast.success(`Added ${created.reference} — ${created.companyName}`);
      }
      onClose();
    } catch (error) {
      const fields = toFieldErrors(error);
      for (const field of fields) {
        setError(field.field as keyof LeadFormValues, { message: field.message });
      }
      if (fields.length === 0) toast.error(toMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit ${lead?.reference}` : 'Add lead'}
      description={
        isEdit
          ? 'Use the pipeline actions to move the stage, so the change is recorded.'
          : 'Set the next follow-up now and Probild will chase it for you.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={isSubmitting}>
            {isEdit ? 'Save lead' : 'Add lead'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="eyebrow mb-2">Company</legend>

          <Field label="Company name" htmlFor="companyName" error={errors.companyName?.message} required>
            <Input id="companyName" {...register('companyName')} />
          </Field>
          <Field label="Contact person" htmlFor="contactPerson" error={errors.contactPerson?.message}>
            <Input id="contactPerson" {...register('contactPerson')} />
          </Field>
          <Field label="Email" htmlFor="leadEmail" error={errors.email?.message}>
            <Input id="leadEmail" type="email" {...register('email')} />
          </Field>
          <Field label="Phone" htmlFor="leadPhone" error={errors.phone?.message}>
            <Input id="leadPhone" {...register('phone')} />
          </Field>
          <Field label="WhatsApp" htmlFor="whatsapp" error={errors.whatsapp?.message}>
            <Input id="whatsapp" {...register('whatsapp')} />
          </Field>
          <Field label="Industry" htmlFor="industry" error={errors.industry?.message}>
            <Input id="industry" {...register('industry')} />
          </Field>
          <Field label="City" htmlFor="city" error={errors.city?.message}>
            <Input id="city" {...register('city')} />
          </Field>
          <Field label="Country" htmlFor="country" error={errors.country?.message}>
            <Input id="country" {...register('country')} />
          </Field>
          <Field label="Website" htmlFor="website" error={errors.website?.message}>
            <Input id="website" placeholder="https://" {...register('website')} />
          </Field>
          <Field label="LinkedIn" htmlFor="linkedin" error={errors.linkedin?.message}>
            <Input id="linkedin" placeholder="https://" {...register('linkedin')} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="eyebrow mb-2">Opportunity</legend>

          <Field label="Where it came from" htmlFor="source" error={errors.source?.message}>
            <Select id="source" {...register('source')}>
              {Object.values(LeadSource).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service of interest" htmlFor="interestedServiceId">
            <Select id="interestedServiceId" {...register('interestedServiceId')}>
              <option value="">Not decided yet</option>
              {services.data?.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expected value" htmlFor="expectedValue" error={errors.expectedValue?.message}>
            <Input id="expectedValue" type="number" min="0" step="1000" {...register('expectedValue')} />
          </Field>
          <Field label="Currency" htmlFor="currency">
            <Select id="currency" {...register('currency')}>
              {Object.values(Currency).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="priority">
            <Select id="priority" {...register('priority')}>
              {Object.values(Priority).map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expected close date" htmlFor="expectedCloseDate">
            <Input id="expectedCloseDate" type="date" {...register('expectedCloseDate')} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="eyebrow mb-2">Ownership and follow-up</legend>

          <Field label="Owner" htmlFor="assignedToId" hint="Reminders go to whoever owns the lead.">
            <Select id="assignedToId" {...register('assignedToId')}>
              <option value="">Assign to me</option>
              {team.data?.items.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next follow-up" htmlFor="nextFollowUpAt" hint="Date and time in your zone.">
            <Input id="nextFollowUpAt" type="datetime-local" {...register('nextFollowUpAt')} />
          </Field>
          <Field label="Notes" htmlFor="notes" className="sm:col-span-2" error={errors.notes?.message}>
            <Textarea id="notes" placeholder="Anything worth remembering about this lead" {...register('notes')} />
          </Field>
        </fieldset>
      </form>
    </Modal>
  );
}
