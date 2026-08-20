import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { UserRole, UserStatus, type AuthUser } from '@probild/shared';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { humanise } from '@/lib/utils';
import { toFieldErrors, toMessage } from '@/lib/api';
import { useCreateUser, useUpdateUser } from './api';

const baseSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name.').max(80),
  lastName: z.string().trim().min(1, 'Enter a last name.').max(80),
  email: z.string().trim().email('That is not a valid email address.'),
  role: z.nativeEnum(UserRole),
  status: z.nativeEnum(UserStatus),
  designation: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(32).optional(),
});

const createSchema = baseSchema.extend({
  password: z
    .string()
    .min(8, 'Use at least 8 characters.')
    .regex(
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
      'Include a letter, a number and a symbol.',
    ),
});

type CreateValues = z.infer<typeof createSchema>;

export function UserFormModal({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when adding someone new. */
  user?: AuthUser | null;
}) {
  const isEdit = Boolean(user);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(isEdit ? (baseSchema as unknown as typeof createSchema) : createSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      role: UserRole.EMPLOYEE,
      status: UserStatus.ACTIVE,
      designation: '',
      phone: '',
      password: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      email: user?.email ?? '',
      role: user?.role ?? UserRole.EMPLOYEE,
      status: user?.status ?? UserStatus.ACTIVE,
      designation: user?.designation ?? '',
      phone: user?.phone ?? '',
      password: '',
    });
  }, [open, user, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isEdit && user) {
        const { password: _password, ...rest } = values;
        await updateUser.mutateAsync({ id: user.id, ...rest });
        toast.success(`Updated ${values.firstName} ${values.lastName}`);
      } else {
        await createUser.mutateAsync(values);
        toast.success(`Added ${values.firstName} ${values.lastName}`);
      }
      onClose();
    } catch (error) {
      // Surface server-side field errors on the inputs that caused them.
      const fields = toFieldErrors(error);
      for (const field of fields) {
        setError(field.field as keyof CreateValues, { message: field.message });
      }
      if (fields.length === 0) toast.error(toMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit team member' : 'Add team member'}
      description={
        isEdit
          ? 'Changes apply the next time they load the app.'
          : 'They can sign in as soon as you save. Share the password directly with them.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={isSubmitting}>
            {isEdit ? 'Save changes' : 'Add member'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="First name" htmlFor="firstName" error={errors.firstName?.message} required>
          <Input id="firstName" autoComplete="off" {...register('firstName')} />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={errors.lastName?.message} required>
          <Input id="lastName" autoComplete="off" {...register('lastName')} />
        </Field>

        <Field
          label="Work email"
          htmlFor="userEmail"
          error={errors.email?.message}
          required
          className="sm:col-span-2"
        >
          <Input id="userEmail" type="email" autoComplete="off" {...register('email')} />
        </Field>

        {!isEdit ? (
          <Field
            label="Temporary password"
            htmlFor="userPassword"
            error={errors.password?.message}
            hint="At least 8 characters with a letter, a number and a symbol."
            required
            className="sm:col-span-2"
          >
            <Input id="userPassword" type="text" autoComplete="off" {...register('password')} />
          </Field>
        ) : null}

        <Field label="Role" htmlFor="role" error={errors.role?.message} required>
          <Select id="role" {...register('role')}>
            {Object.values(UserRole).map((role) => (
              <option key={role} value={role}>
                {humanise(role)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" htmlFor="status" error={errors.status?.message} required>
          <Select id="status" {...register('status')}>
            {Object.values(UserStatus).map((status) => (
              <option key={status} value={status}>
                {humanise(status)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Job title" htmlFor="designation" error={errors.designation?.message}>
          <Input id="designation" placeholder="Account Manager" {...register('designation')} />
        </Field>

        <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" placeholder="+91 98765 43210" {...register('phone')} />
        </Field>
      </form>
    </Modal>
  );
}
