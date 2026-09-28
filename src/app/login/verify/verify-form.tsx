'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { verifyMfaAction } from '@/server/actions/security';

export function VerifyForm() {
  const [state, formAction, pending] = useActionState(verifyMfaAction, undefined);
  const [recovery, setRecovery] = useState(false);
  return (
    <form action={formAction} className="space-y-4 rounded-3xl border border-border bg-surface p-6">
      <FormError error={state?.error} />
      {recovery ? (
        <Field label="Recovery code" hint="One of the codes you saved when you set this up. Each works once.">
          <Input name="code" autoComplete="off" required autoFocus placeholder="abcde-12345" maxLength={20} />
        </Field>
      ) : (
        <Field label="6-digit code">
          <Input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required autoFocus placeholder="123 456" maxLength={7} className="text-center text-lg tracking-[0.3em]" />
        </Field>
      )}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>{pending ? 'Checking…' : 'Continue'}</Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-accent hover:underline" onClick={() => setRecovery(!recovery)}>{recovery ? 'Use the app code' : 'Lost your phone?'}</button>
        <Link href="/login" className="text-muted hover:underline">Start again</Link>
      </div>
    </form>
  );
}
