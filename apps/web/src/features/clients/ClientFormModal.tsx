import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ClientStatus, Currency } from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { useUsers } from '@/features/users/api';
import { toFieldErrors, toMessage } from '@/lib/api';
import { humanise } from '@/lib/utils';
import { useCreateClient, useUpdateClient, type ClientFormBody } from './api';
import type { Client } from './types';

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => value === '' || /^https?:\/\/\S+$/i.test(value), {
    message: 'Start the address with http:// or https://',
  });

const clientSchema = z.object({
  companyName: z.string().trim().min(1, 'Enter the company name.').max(191),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || z.string().email().safeParse(value).success, {
      message: 'That is not a valid email address.',
    }),
  phone: z.string().trim().max(32),
  whatsapp: z.string().trim().max(32),
  website: optionalUrl,
  linkedin: optionalUrl,
  industry: z.string().trim().max(120),
  city: z.string().trim().max(80),
  country: z.string().trim().max(80),
  addressLine: z.string().trim().max(255),
  postalCode: z.string().trim().max(20),
  taxId: z.string().trim().max(64),
  status: z.nativeEnum(ClientStatus),
  defaultCurrency: z.nativeEnum(Currency),
  accountManagerId: z.string(),
  notes: z.string().trim().max(5000),
});

type ClientValues = z.infer<typeof clientSchema>;

const EMPTY: ClientValues = {
  companyName: '',
  email: '',
  phone: '',
  whatsapp: '',
  website: '',
  linkedin: '',
  industry: '',
  city: '',
  country: 'India',
  addressLine: '',
  postalCode: '',
  taxId: '',
  status: ClientStatus.ACTIVE,
  defaultCurrency: Currency.INR,
  accountManagerId: '',
  notes: '',
};

export function ClientFormModal({
  open,
  onClose,
  client,
}: {
  open: boolean;
  onClose: () => void;
  client?: Client | null;
}) {
  const isEdit = Boolean(client);
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const team = useUsers({ page: 1, pageSize: 100 });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClientValues>({ resolver: zodResolver(clientSchema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    reset(
      client
        ? {
            companyName: client.companyName,
            email: client.email ?? '',
            phone: client.phone ?? '',
            whatsapp: client.whatsapp ?? '',
            website: client.website ?? '',
            linkedin: client.linkedin ?? '',
            industry: client.industry ?? '',
            city: client.city ?? '',
            country: client.country ?? '',
            addressLine: client.addressLine ?? '',
            postalCode: client.postalCode ?? '',
            taxId: client.taxId ?? '',
            status: client.status,
            defaultCurrency: client.defaultCurrency,
            accountManagerId: client.accountManager?.id ?? '',
            notes: client.notes ?? '',
          }
        : EMPTY,
    );
  }, [open, client, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const body: ClientFormBody = {
      ...values,
      accountManagerId: values.accountManagerId || null,
    };

    try {
      if (isEdit && client) {
        await updateClient.mutateAsync({ id: client.id, ...body });
        toast.success(`Saved ${values.companyName}`);
      } else {
        const created = await createClient.mutateAsync(body);
        toast.success(`Added ${created.reference} — ${created.companyName}`);
      }
      onClose();
    } catch (error) {
      const fields = toFieldErrors(error);
      for (const field of fields) {
        setError(field.field as keyof ClientValues, { message: field.message });
      }
      if (fields.length === 0) toast.error(toMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit ${client?.reference}` : 'Add client'}
      description={
        isEdit ? undefined : 'For a client Probild already works with. Won leads convert instead.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={isSubmitting}>
            {isEdit ? 'Save client' : 'Add client'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field
          label="Company name"
          htmlFor="clientCompany"
          error={errors.companyName?.message}
          required
          className="sm:col-span-2"
        >
          <Input id="clientCompany" {...register('companyName')} />
        </Field>

        <Field label="Email" htmlFor="clientEmail" error={errors.email?.message}>
          <Input id="clientEmail" type="email" {...register('email')} />
        </Field>
        <Field label="Phone" htmlFor="clientPhone" error={errors.phone?.message}>
          <Input id="clientPhone" {...register('phone')} />
        </Field>
        <Field label="WhatsApp" htmlFor="clientWhatsapp">
          <Input id="clientWhatsapp" {...register('whatsapp')} />
        </Field>
        <Field label="Industry" htmlFor="clientIndustry">
          <Input id="clientIndustry" {...register('industry')} />
        </Field>
        <Field label="Website" htmlFor="clientWebsite" error={errors.website?.message}>
          <Input id="clientWebsite" placeholder="https://" {...register('website')} />
        </Field>
        <Field label="LinkedIn" htmlFor="clientLinkedin" error={errors.linkedin?.message}>
          <Input id="clientLinkedin" placeholder="https://" {...register('linkedin')} />
        </Field>

        <Field label="Address" htmlFor="clientAddress" className="sm:col-span-2">
          <Input id="clientAddress" {...register('addressLine')} />
        </Field>
        <Field label="City" htmlFor="clientCity">
          <Input id="clientCity" {...register('city')} />
        </Field>
        <Field label="Country" htmlFor="clientCountry">
          <Input id="clientCountry" {...register('country')} />
        </Field>
        <Field label="Postal code" htmlFor="clientPostal">
          <Input id="clientPostal" {...register('postalCode')} />
        </Field>
        <Field label="GST / Tax number" htmlFor="clientTax">
          <Input id="clientTax" {...register('taxId')} />
        </Field>

        <Field label="Status" htmlFor="clientStatus">
          <Select id="clientStatus" {...register('status')}>
            {Object.values(ClientStatus).map((value) => (
              <option key={value} value={value}>
                {humanise(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Bills in"
          htmlFor="clientCurrency"
          hint="Used as the default on new quotations."
        >
          <Select id="clientCurrency" {...register('defaultCurrency')}>
            {Object.values(Currency).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Account manager" htmlFor="clientManager" className="sm:col-span-2">
          <Select id="clientManager" {...register('accountManagerId')}>
            <option value="">Nobody yet</option>
            {team.data?.items.map((member) => (
              <option key={member.id} value={member.id}>
                {member.fullName}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Notes" htmlFor="clientNotes" className="sm:col-span-2">
          <Textarea id="clientNotes" {...register('notes')} />
        </Field>
      </form>
    </Modal>
  );
}
