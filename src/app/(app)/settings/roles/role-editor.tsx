'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Plus } from 'lucide-react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/form';
import { toast } from '@/components/toast';
import { deleteRoleAction, saveRoleAction } from '@/server/actions/team';

type Group = { key: string; label: string; perms: { key: string; label: string }[] };
type Role = { id: string; name: string; description: string; dataScope: 'all' | 'assigned'; permissions: string[]; system: boolean };

export function RoleEditor({ role, groups, usedBy }: { role: Role | null; groups: Group[]; usedBy: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const have = new Set(role?.permissions ?? []);
  if (!open) {
    return (
      <Card>
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 p-4 text-left">
          {role ? (
            <div className="min-w-0 flex-1">
              <p className="font-medium">{role.name} {role.system ? null : <Badge className="ml-1">Custom</Badge>} {role.dataScope === 'assigned' ? <Badge tone="warn" className="ml-1">Assigned only</Badge> : null}</p>
              <p className="text-sm text-muted">{role.description} · {role.permissions.length} permissions · {usedBy} {usedBy === 1 ? 'person' : 'people'}</p>
            </div>
          ) : <p className="flex flex-1 items-center gap-2 font-medium text-accent"><Plus className="size-4" />New custom role</p>}
          <ChevronDown className="size-4 text-muted" />
        </button>
      </Card>
    );
  }
  return (
    <Card>
      <CardBody>
        <ActionForm action={async (fd) => { const r = await saveRoleAction(fd); if (r.ok) setOpen(false); return r; }} className="space-y-4">
          <input type="hidden" name="id" value={role?.id ?? ''} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name"><Input name="name" defaultValue={role?.name} required maxLength={60} /></Field>
            <Field label="Which records" hint="Assigned only = customers, jobs, tasks and appointments assigned to them.">
              <Select name="dataScope" defaultValue={role?.dataScope ?? 'all'}>
                <option value="all">Everything in the business</option>
                <option value="assigned">Only what’s assigned to them</option>
              </Select>
            </Field>
          </div>
          <Field label="Description"><Input name="description" defaultValue={role?.description} maxLength={300} /></Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {groups.map((g) => (
              <fieldset key={g.key} className="rounded-xl border border-border p-3">
                <legend className="px-1 text-sm font-medium">{g.label}</legend>
                <div className="space-y-1.5">
                  {g.perms.map((p) => (
                    <label key={p.key} className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="permissions" value={p.key} defaultChecked={have.has(p.key)} className="mt-0.5 size-4 accent-(--accent)" />
                      <span>{p.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">Save role</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {role && !role.system ? (
              <Button type="button" variant="danger" className="ml-auto" disabled={pending} onClick={() => {
                if (!confirm(`Delete the ${role.name} role?`)) return;
                start(async () => { const r = await deleteRoleAction(role.id); toast(r.ok ? (r.message ?? 'Deleted') : r.error); router.refresh(); });
              }}>Delete role</Button>
            ) : null}
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
