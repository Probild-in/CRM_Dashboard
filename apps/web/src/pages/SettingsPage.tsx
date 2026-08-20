import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { ROLE_TONES } from '@/components/ui/tones';
import { useAuth } from '@/features/auth/AuthContext';
import { useChangeOwnPassword, useUpdateOwnProfile } from '@/features/users/api';
import { GoogleCalendarPanel } from '@/features/meetings/GoogleCalendarPanel';
import { toMessage } from '@/lib/api';
import { formatDateTime, humanise } from '@/lib/utils';

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(80),
  lastName: z.string().trim().min(1, 'Enter your last name.').max(80),
  designation: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(32).optional(),
  timezone: z.string().trim().min(1).max(64),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .regex(
        /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/,
        'Include a letter, a number and a symbol.',
      ),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'These passwords do not match.',
  });

type ProfileValues = z.infer<typeof profileSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

/** The timezones Probild actually works across. */
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC'];

export default function SettingsPage() {
  const { user, refreshUser, signOut } = useAuth();
  const updateProfile = useUpdateOwnProfile();
  const changePassword = useChangeOwnPassword();

  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      designation: user?.designation ?? '',
      phone: user?.phone ?? '',
      timezone: user?.timezone ?? 'Asia/Kolkata',
    },
  });

  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (!user) return;
    profileForm.reset({
      firstName: user.firstName,
      lastName: user.lastName,
      designation: user.designation ?? '',
      phone: user.phone ?? '',
      timezone: user.timezone,
    });
  }, [user, profileForm]);

  if (!user) return null;

  const onSaveProfile = profileForm.handleSubmit(async (values) => {
    try {
      await updateProfile.mutateAsync(values);
      await refreshUser();
      toast.success('Profile saved');
    } catch (error) {
      toast.error(toMessage(error));
    }
  });

  const onChangePassword = passwordForm.handleSubmit(async (values) => {
    try {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success('Password changed. Sign in again with your new password.');
      await signOut();
    } catch (error) {
      toast.error(toMessage(error));
    }
  });

  return (
    <>
      <PageHeader
        eyebrow="Your account"
        title="Settings"
        description="Your details, your calendar and your sign-in credentials."
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr] lg:items-start">
        <Panel>
          <PanelHeader title="Your profile" eyebrow="Details" />
          <PanelBody>
            <form onSubmit={onSaveProfile} className="grid gap-4 sm:grid-cols-2" noValidate>
              <Field
                label="First name"
                htmlFor="profileFirstName"
                error={profileForm.formState.errors.firstName?.message}
                required
              >
                <Input id="profileFirstName" {...profileForm.register('firstName')} />
              </Field>
              <Field
                label="Last name"
                htmlFor="profileLastName"
                error={profileForm.formState.errors.lastName?.message}
                required
              >
                <Input id="profileLastName" {...profileForm.register('lastName')} />
              </Field>
              <Field label="Job title" htmlFor="profileDesignation">
                <Input id="profileDesignation" {...profileForm.register('designation')} />
              </Field>
              <Field label="Phone" htmlFor="profilePhone">
                <Input id="profilePhone" {...profileForm.register('phone')} />
              </Field>
              <Field
                label="Time zone"
                htmlFor="profileTimezone"
                hint="Dates and deadlines are shown in this zone."
                className="sm:col-span-2"
              >
                <Select id="profileTimezone" {...profileForm.register('timezone')}>
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="sm:col-span-2">
                <Button type="submit" variant="primary" loading={profileForm.formState.isSubmitting}>
                  Save profile
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>

        <div className="flex flex-col gap-5">
          <GoogleCalendarPanel />

          <Panel>
            <PanelHeader title="Account" eyebrow="Read only" />
            <PanelBody className="flex flex-col gap-3.5">
              <Row label="Email">{user.email}</Row>
              <Row label="Role">
                <Badge tone={ROLE_TONES[user.role] ?? 'neutral'}>{humanise(user.role)}</Badge>
              </Row>
              <Row label="Last signed in">
                <span className="tabular font-mono text-xs">
                  {user.lastLoginAt ? formatDateTime(user.lastLoginAt, user.timezone) : 'Never'}
                </span>
              </Row>
              <p className="mt-1 text-xs text-ink-faint">
                Only a super admin can change your email or role.
              </p>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Password" eyebrow="Security" />
            <PanelBody>
              <form onSubmit={onChangePassword} className="flex flex-col gap-4" noValidate>
                <Field
                  label="Current password"
                  htmlFor="currentPassword"
                  error={passwordForm.formState.errors.currentPassword?.message}
                  required
                >
                  <Input
                    id="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    {...passwordForm.register('currentPassword')}
                  />
                </Field>
                <Field
                  label="New password"
                  htmlFor="newPassword"
                  error={passwordForm.formState.errors.newPassword?.message}
                  hint="At least 8 characters with a letter, a number and a symbol."
                  required
                >
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    {...passwordForm.register('newPassword')}
                  />
                </Field>
                <Field
                  label="Confirm new password"
                  htmlFor="confirmPassword"
                  error={passwordForm.formState.errors.confirmPassword?.message}
                  required
                >
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    {...passwordForm.register('confirmPassword')}
                  />
                </Field>
                <p className="text-xs text-ink-faint">
                  Changing your password signs you out of every device.
                </p>
                <Button type="submit" variant="primary" loading={passwordForm.formState.isSubmitting}>
                  Change password
                </Button>
              </form>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[0.8125rem] text-ink-faint">{label}</span>
      <span className="truncate text-[0.8125rem] font-medium text-ink">{children}</span>
    </div>
  );
}
