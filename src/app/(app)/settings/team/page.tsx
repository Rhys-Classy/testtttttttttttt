import { eq } from 'drizzle-orm';
import { accountMembers, subAccountMembers, users } from '@/db/schema';
import { readScope, requireContext } from '@/server/context';
import { inviteTeamMemberAction } from '@/server/actions/settings';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { ActionForm } from '@/components/action-form';

export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const ctx = await requireContext();
  const data = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, async (tx) => ({
    members: await tx.select({ u: users, role: accountMembers.role }).from(accountMembers).innerJoin(users, eq(users.id, accountMembers.userId)).where(eq(accountMembers.accountId, ctx.account.id)),
    access: await tx.select().from(subAccountMembers),
  }));
  return (
    <div className="space-y-5">
      <PageHeader title="Team" subtitle="Owners see every business. Everyone else only sees the businesses you give them — enforced by the database." />
      <Card><CardHeader title="People" /><CardBody className="divide-y divide-border">
        {data.members.map(({ u, role }) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="font-medium">{u.name}</p><p className="text-xs text-muted">{u.email}</p></div>
            {role === 'owner' || role === 'admin' ? <Badge tone="accent">{role} · all businesses</Badge> : (
              <div className="flex flex-wrap gap-2">
                {data.access.filter((a) => a.userId === u.id).map((a) => <span key={a.subAccountId} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"><BusinessBadge business={ctx.businesses.find((b) => b.id === a.subAccountId)} /><span className="text-xs text-muted">{a.role}</span></span>)}
                {!data.access.some((a) => a.userId === u.id) ? <span className="text-xs text-muted">No business access yet</span> : null}
              </div>
            )}
          </div>
        ))}
      </CardBody></Card>
      {ctx.isAccountAdmin ? (
        <Card><CardHeader title="Add a team member" subtitle="e.g. a head installer who only needs Classy Kitchen Facelifts" /><CardBody>
          <ActionForm action={inviteTeamMemberAction} resetOnSuccess className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name"><Input name="name" required /></Field>
              <Field label="Email"><Input name="email" type="email" required /></Field>
              <Field label="Temporary password" hint="They should change it after first login."><Input name="password" type="text" required minLength={10} /></Field>
              <Field label="Role"><Select name="role" defaultValue="staff"><option value="staff">Staff — can view and edit</option><option value="viewer">Viewer — read only</option><option value="admin">Admin — can change settings</option></Select></Field>
            </div>
            <fieldset><legend className="mb-2 text-sm font-medium">Businesses they can open</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{ctx.businesses.map((b) => <label key={b.id} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"><input type="checkbox" name="businesses" value={b.id} /><BusinessBadge business={b} full /></label>)}</div>
            </fieldset>
            <Button type="submit" variant="primary">Add team member</Button>
          </ActionForm>
        </CardBody></Card>
      ) : null}
    </div>
  );
}
