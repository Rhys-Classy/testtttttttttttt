'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Copy, TriangleAlert } from 'lucide-react';
import { connectIntegrationAction, disconnectIntegrationAction } from '@/server/actions/settings';
import { toast } from '@/components/toast';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';

type Def = { id: string; label: string; description: string; status: string; auth: string; fields: { key: string; label: string; secret?: boolean; required?: boolean; placeholder?: string; help?: string }[]; docsUrl?: string };
type Conn = { id: string; status: string; config: Record<string, unknown>; secretHints: Record<string, string>; lastError: string | null } | null;

export function IntegrationCard({ def, conn, scope, subAccountId, webhookUrl }: { def: Def; conn: Conn; scope: 'global' | 'sub_account'; subAccountId?: string; webhookUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const connected = conn?.status === 'connected';
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium">{def.label}
            {connected ? <Badge tone="ok"><CheckCircle2 className="mr-1 size-3" />Connected</Badge> : conn?.status === 'error' ? <Badge tone="danger">Error</Badge> : def.status === 'planned' ? <Badge>Coming soon</Badge> : def.status === 'oauth_app_required' ? <Badge tone="warn">Needs Google app</Badge> : null}
          </p>
          <p className="mt-0.5 text-sm text-muted">{def.description}</p>
          {conn?.lastError ? <p className="mt-1 flex items-center gap-1 text-xs text-danger"><TriangleAlert className="size-3" />{conn.lastError}</p> : null}
        </div>
        {def.status === 'ready' && def.fields.length ? <Button size="sm" variant={connected ? 'secondary' : 'primary'} onClick={() => setOpen((o) => !o)}>{connected ? 'Edit' : 'Connect'}</Button> : null}
        {connected ? <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Disconnect ${def.label}? Stored keys will be deleted.`)) start(async () => { const r = await disconnectIntegrationAction(conn!.id, scope === 'global' ? null : subAccountId!); toast(r.ok ? 'Disconnected' : r.error, r.ok ? 'ok' : 'error'); router.refresh(); }); }}>Disconnect</Button> : null}
      </div>
      {connected && webhookUrl ? (
        <div className="mt-3 rounded-xl bg-surface-2 p-3 text-xs">
          <p className="mb-1 font-medium">{def.id === 'stripe' ? 'Stripe webhook URL (events: checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed, charge.refunded)' : def.id === 'twilio' ? 'Set this as the “A message comes in” webhook on your Twilio number' : 'POST your website form here'}</p>
          <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate">{webhookUrl}</code><button onClick={() => { navigator.clipboard.writeText(webhookUrl); toast('Copied'); }} className="text-accent"><Copy className="size-4" /></button></div>
        </div>
      ) : null}
      {open ? (
        <ActionForm action={async (fd) => { const r = await connectIntegrationAction(fd); if (r.ok) setOpen(false); return r; }} className="mt-4 space-y-3 border-t border-border pt-4">
          <input type="hidden" name="provider" value={def.id} />
          <input type="hidden" name="scope" value={scope} />
          {subAccountId ? <input type="hidden" name="subAccountId" value={subAccountId} /> : null}
          {def.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? '' : ' (optional)'}`} hint={f.secret && conn?.secretHints[f.key] ? `Saved (${conn.secretHints[f.key]}). Leave blank to keep it.` : f.help}>
              <Input name={f.key} type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.placeholder} defaultValue={f.secret ? '' : String(conn?.config[f.key] ?? '')} required={f.required && !(f.secret && conn?.secretHints[f.key])} />
            </Field>
          ))}
          <p className="text-xs text-muted">Secrets are encrypted before they are stored and are never sent back to the browser.</p>
          <Button type="submit" variant="primary">Save</Button>
        </ActionForm>
      ) : null}
    </div>
  );
}
