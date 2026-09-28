'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { toast } from '@/components/toast';
import { inviteTeamMemberAction, removeMemberAction, updateMemberAccessAction } from '@/server/actions/team';

type RoleOpt = { id: string; name: string; description: string };
type Biz = { id: string; name: string; color: string; shortName: string | null; canManage: boolean };

function RoleSelect({ name, value, roles, allowNone, disabled }: { name: string; value?: string | null; roles: RoleOpt[]; allowNone: string; disabled?: boolean }) {
  return (
    <Select name={name} defaultValue={value ?? ''} disabled={disabled} className="h-9">
      <option value="">{allowNone}</option>
      {roles.map((r) => <option key={r.id} value={r.id} title={r.description}>{r.name}</option>)}
    </Select>
  );
}

function BusinessRoles({ roles, businesses, perBusiness }: { roles: RoleOpt[]; businesses: Biz[]; perBusiness: Record<string, string> }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {businesses.map((b) => (
        <label key={b.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-sm">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
          <span className="min-w-0 flex-1 truncate">{b.name}</span>
          <span className="w-36 shrink-0"><RoleSelect name={`role_${b.id}`} value={perBusiness[b.id]} roles={roles} allowNone="No access" disabled={!b.canManage} /></span>
        </label>
      ))}
    </div>
  );
}

export function MemberAccess({ userId, isOwner, allRoleId, perBusiness, roles, businesses }: {
  userId: string; isOwner: boolean; allRoleId: string | null; perBusiness: Record<string, string>; roles: RoleOpt[]; businesses: Biz[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const summary = [
    allRoleId ? `${roles.find((r) => r.id === allRoleId)?.name ?? 'Role'} in every business` : null,
    ...businesses.filter((b) => perBusiness[b.id]).map((b) => `${roles.find((r) => r.id === perBusiness[b.id])?.name} · ${b.shortName ?? b.name}`),
  ].filter(Boolean);
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted">{summary.length ? summary.join(' · ') : 'No business access'}</p>
        <Button size="sm" onClick={() => setOpen(true)}>Change access</Button>
      </div>
    );
  }
  return (
    <ActionForm action={async (fd) => { const r = await updateMemberAccessAction(userId, fd); if (r.ok) setOpen(false); return r; }} className="space-y-3 rounded-xl bg-surface-2 p-3">
      {isOwner ? (
        <Field label="Every business (including ones you add later)" hint="A business-specific role below overrides this.">
          <RoleSelect name="allRoleId" value={allRoleId} roles={roles} allowNone="Not across all businesses" />
        </Field>
      ) : null}
      <BusinessRoles roles={roles} businesses={businesses} perBusiness={perBusiness} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm">Save access</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        {isOwner ? (
          <Button type="button" variant="danger" size="sm" className="ml-auto" disabled={pending} onClick={() => {
            if (!confirm('Remove this person from the account? They will no longer be able to log in here.')) return;
            start(async () => { const r = await removeMemberAction(userId); toast(r.ok ? (r.message ?? 'Removed') : r.error); router.refresh(); });
          }}>Remove person</Button>
        ) : null}
      </div>
    </ActionForm>
  );
}

export function InviteForm({ isOwner, roles, businesses }: { isOwner: boolean; roles: RoleOpt[]; businesses: Biz[] }) {
  return (
    <ActionForm action={inviteTeamMemberAction} resetOnSuccess className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Name"><Input name="name" required maxLength={120} /></Field>
        <Field label="Email"><Input name="email" type="email" required maxLength={200} /></Field>
        <Field label="Temporary password" hint="10+ characters. They change it after logging in."><Input name="password" type="text" required minLength={10} maxLength={200} autoComplete="off" /></Field>
      </div>
      {isOwner ? (
        <Field label="Role in every business" hint="Leave empty to choose per business below.">
          <RoleSelect name="allRoleId" roles={roles} allowNone="Choose per business" />
        </Field>
      ) : null}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Role per business</legend>
        <BusinessRoles roles={roles} businesses={businesses} perBusiness={{}} />
      </fieldset>
      <details className="text-sm text-muted">
        <summary className="cursor-pointer">What can each role do?</summary>
        <ul className="mt-2 space-y-1">{roles.map((r) => <li key={r.id}><span className="font-medium text-text">{r.name}</span> — {r.description}</li>)}</ul>
      </details>
      <Button type="submit" variant="primary">Add team member</Button>
    </ActionForm>
  );
}
