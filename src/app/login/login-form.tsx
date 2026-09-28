'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { loginAction } from '@/server/actions/security';

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);
  return (
    <form action={formAction} className="space-y-4 rounded-3xl border border-border bg-surface p-6">
      <FormError error={state?.error} />
      <Field label="Email"><Input name="email" type="email" autoComplete="email" required autoFocus maxLength={200} /></Field>
      <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required maxLength={200} /></Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>{pending ? 'Logging in…' : 'Log in'}</Button>
    </form>
  );
}
