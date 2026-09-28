'use client';

import { useActionState, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { RecoveryCodes } from '@/components/security/mfa-setup';
import { disableMfaAction, regenerateRecoveryCodesAction, revokeSessionAction } from '@/server/actions/security';

export function RevokeButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return <Button size="sm" disabled={pending} onClick={() => start(() => revokeSessionAction(id))}>{pending ? '…' : label}</Button>;
}

export function MfaManage({ codesLeft, required }: { codesLeft: number; required: boolean }) {
  const [mode, setMode] = useState<'idle' | 'codes' | 'off'>('idle');
  const [regen, regenAction, regenPending] = useActionState(regenerateRecoveryCodesAction, undefined);
  const [off, offAction, offPending] = useActionState(disableMfaAction, undefined);
  if (regen?.recoveryCodes) return <RecoveryCodes codes={regen.recoveryCodes} />;
  if (off?.ok) return <p className="text-sm">Two-step verification is off.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">You’ll be asked for a code from your authenticator app when you log in. {codesLeft} recovery code{codesLeft === 1 ? '' : 's'} left.</p>
      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode('codes')}>New recovery codes</Button>
          {!required ? <Button size="sm" variant="ghost" onClick={() => setMode('off')}>Turn off</Button> : null}
        </div>
      ) : null}
      {mode === 'codes' ? (
        <form action={regenAction} className="max-w-sm space-y-3">
          <FormError error={regen?.error} />
          <Field label="Current code from your app"><Input name="code" inputMode="numeric" required maxLength={7} /></Field>
          <div className="flex gap-2"><Button type="submit" variant="primary" disabled={regenPending}>Create new codes</Button><Button type="button" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button></div>
        </form>
      ) : null}
      {mode === 'off' ? (
        <form action={offAction} className="max-w-sm space-y-3">
          <FormError error={off?.error} />
          <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
          <Field label="Code from your app (or a recovery code)"><Input name="code" required maxLength={20} /></Field>
          <div className="flex gap-2"><Button type="submit" variant="danger" disabled={offPending}>Turn off</Button><Button type="button" variant="ghost" onClick={() => setMode('idle')}>Cancel</Button></div>
        </form>
      ) : null}
    </div>
  );
}
