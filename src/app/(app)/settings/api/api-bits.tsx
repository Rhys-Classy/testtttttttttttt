'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/form';
import { toast } from '@/components/toast';
import { createApiKeyAction, revokeApiKeyAction } from '@/server/actions/team';

type Group = { label: string; perms: { key: string; label: string }[] };

export function RevokeKey({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
    if (!confirm('Revoke this key? Anything using it stops working immediately.')) return;
    start(async () => { const r = await revokeApiKeyAction(id); toast(r.ok ? 'Key revoked' : r.error); router.refresh(); });
  }}>Revoke</Button>;
}

export function CreateKeyForm({ businesses, groups, allowedByBusiness }: { businesses: { id: string; name: string }[]; groups: Group[]; allowedByBusiness: Record<string, string[]> }) {
  const [biz, setBiz] = useState(businesses[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const allowed = new Set(allowedByBusiness[biz] ?? []);
  if (key) {
    return (
      <div className="space-y-3">
        <p className="text-sm">Copy this key now. For security it’s stored scrambled and can’t be shown again.</p>
        <p className="break-all rounded-xl bg-surface-2 p-3 font-mono text-sm">{key}</p>
        <div className="flex gap-2">
          <Button onClick={() => { navigator.clipboard?.writeText(key); toast('Copied'); }}><Copy className="size-4" />Copy</Button>
          <Button variant="ghost" onClick={() => setKey(null)}>Done</Button>
        </div>
      </div>
    );
  }
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        setError(null);
        const r = await createApiKeyAction(fd);
        if (!r.ok) { setError(r.error); return; }
        setKey(r.data?.key ?? null);
        router.refresh();
      });
    }}>
      <FormError error={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Business"><Select name="subAccountId" value={biz} onChange={(e) => setBiz(e.target.value)}>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Name"><Input name="name" required maxLength={60} placeholder="Zapier" /></Field>
        <Field label="Expires"><Select name="expiresInDays" defaultValue="365"><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option><option value="0">Never</option></Select></Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <fieldset key={g.label} className="rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-medium">{g.label}</legend>
            {g.perms.filter((p) => allowed.has(p.key)).map((p) => (
              <label key={p.key} className="flex items-start gap-2 py-0.5 text-sm">
                <input type="checkbox" name="permissions" value={p.key} defaultChecked={p.key.endsWith('.view') && ['contacts.view', 'sales.view'].includes(p.key)} className="mt-0.5 size-4 accent-(--accent)" />
                <span>{p.label}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <Button type="submit" variant="primary" disabled={pending}>{pending ? 'Creating…' : 'Create key'}</Button>
    </form>
  );
}
