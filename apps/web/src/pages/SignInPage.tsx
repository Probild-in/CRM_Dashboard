import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/features/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { toMessage } from '@/lib/api';

const signInSchema = z.object({
  email: z.string().min(1, 'Enter your work email.').email('That is not a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type SignInValues = z.infer<typeof signInSchema>;

export default function SignInPage() {
  const { user, ready, signIn } = useAuth();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  if (ready && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/sign-in' ? from : '/'} replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
    } catch (error) {
      setFormError(toMessage(error, 'Could not sign you in. Try again.'));
    }
  });

  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[1.1fr_1fr]">
      {/*
        The left panel states what the tool is for. The bars are the same
        marker used throughout the app, here at poster scale.
      */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink px-12 py-14 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 items-end gap-1" aria-hidden>
            <span className="h-6 w-1.5 bg-accent" />
            <span className="h-4 w-1.5 bg-accent/60" />
            <span className="h-2.5 w-1.5 bg-warning" />
          </div>
          <span className="font-display text-sm font-semibold tracking-tight text-white">Probild</span>
        </div>

        <div className="max-w-md">
          <p className="eyebrow mb-4 text-white/45">Internal operations</p>
          <h1 className="font-display text-[2.6rem] leading-[1.08] font-semibold tracking-tight text-white">
            Every lead, project and payment in one place.
          </h1>
          <p className="mt-5 text-[0.9375rem] leading-relaxed text-white/60">
            Enter the details once. Probild tracks the follow-ups, deadlines and dues, and tells you
            each morning what needs your attention.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-8 border-t border-white/10 pt-7">
          {[
            ['Lead to client', 'One record, full history'],
            ['Deadlines', 'Reminders raised for you'],
            ['Payments', 'Outstanding always current'],
          ].map(([term, detail]) => (
            <div key={term}>
              <dt className="font-mono text-[0.6875rem] tracking-wide text-white/40 uppercase">
                {term}
              </dt>
              <dd className="mt-1.5 text-[0.8125rem] leading-snug text-white/70">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-6 items-end gap-1" aria-hidden>
              <span className="h-6 w-1.5 bg-accent" />
              <span className="h-4 w-1.5 bg-accent/60" />
              <span className="h-2.5 w-1.5 bg-warning" />
            </div>
            <span className="font-display text-sm font-semibold text-ink">Probild</span>
          </div>

          <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1.5 text-sm text-ink-faint">Use the account your administrator set up.</p>

          <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4" noValidate>
            <Field label="Work email" htmlFor="email" error={errors.email?.message} required>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@probild.com"
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
              />
            </Field>

            <Field label="Password" htmlFor="password" error={errors.password?.message} required>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
            </Field>

            {formError ? (
              <p
                role="alert"
                className="edge-marker rounded-r bg-danger-soft py-2.5 pr-3 pl-3.5 text-sm text-danger"
              >
                {formError}
              </p>
            ) : null}

            <Button type="submit" variant="primary" loading={isSubmitting} className="mt-1 w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-8 text-xs leading-relaxed text-ink-faint">
            Forgotten your password? A super admin can reset it from the Team page.
          </p>
        </div>
      </section>
    </main>
  );
}
