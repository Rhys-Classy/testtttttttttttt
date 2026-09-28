'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/form';
import { confirmMfaSetupAction, finishMfaSetupAction, startMfaSetupAction } from '@/server/actions/security';

/** Scan → confirm with a code → save recovery codes. */
export function MfaSetup({ email, onDoneHref }: { email: string; onDoneHref?: string }) {
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [starting, start] = useTransition();
  const [state, formAction, pending] = useActionState(confirmMfaSetupAction, undefined);

  if (state?.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} doneHref={onDoneHref} />;

  if (!setup) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">Adds a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy) each time you log in on a new device.</p>
        <Button variant="primary" disabled={starting} onClick={() => start(async () => setSetup(await startMfaSetupAction(email)))}>
          <ShieldCheck className="size-4" />{starting ? 'Preparing…' : 'Set up two-step verification'}
        </Button>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      <FormError error={state?.error} />
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Open your authenticator app and scan this code.</li>
        <li>Type the 6-digit code it shows.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {/* QR is generated server-side from our own otpauth URI. */}
        <div className="size-40 shrink-0 overflow-hidden rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
        <div className="min-w-0 text-sm">
          <p className="text-muted">Can’t scan? Enter this key:</p>
          <p className="mt-1 break-all font-mono text-xs">{setup.secret.match(/.{1,4}/g)?.join(' ')}</p>
        </div>
      </div>
      <Field label="Code from the app">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" required placeholder="123 456" maxLength={7} className="max-w-40 text-center tracking-[0.3em]" />
      </Field>
      <Button type="submit" variant="primary" disabled={pending}>{pending ? 'Checking…' : 'Turn on'}</Button>
    </form>
  );
}

export function RecoveryCodes({ codes, doneHref }: { codes: string[]; doneHref?: string }) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  useEffect(() => { if (copied) { const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); } }, [copied]);
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-ok">Two-step verification is on.</p>
      <p className="text-sm text-muted">Save these recovery codes somewhere safe (password manager). Each one gets you in once if you lose your phone. They won’t be shown again.</p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-3 font-mono text-sm">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); setCopied(true); }}><Copy className="size-4" />{copied ? 'Copied' : 'Copy codes'}</Button>
        <Button variant="primary" onClick={async () => { await finishMfaSetupAction(); if (doneHref) window.location.href = doneHref; else router.refresh(); }}>
          {doneHref ? 'I’ve saved them — continue' : 'I’ve saved them'}
        </Button>
      </div>
    </div>
  );
}
