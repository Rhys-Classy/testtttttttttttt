import { asc, eq } from 'drizzle-orm';
import { withContext } from '@/db/context';
import { accountMembers, publicUserColumns, roles, subAccountMembers, users } from '@/db/schema';
import { grantAllows } from '@/lib/permissions';
import { relativeTime } from '@/lib/dates';
import { requireContext } from '@/server/context';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty';
import { NoAccess } from '@/components/no-access';
import { InviteForm, MemberAccess } from './team-bits';

export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const ctx = await requireContext();
  const manageable = ctx.businesses.filter((b) => grantAllows(ctx.grants[b.id], 'team.manage'));
  if (!ctx.isOwner && !manageable.length) return <NoAccess what="the team" />;
  const data = await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: ctx.businesses.map((b) => b.id) }, async (tx) => ({
    members: await tx.select({ u: publicUserColumns, role: accountMembers.role, allRoleId: accountMembers.allBusinessesRoleId })
      .from(accountMembers).innerJoin(users, eq(users.id, accountMembers.userId))
      .where(eq(accountMembers.accountId, ctx.account.id)).orderBy(asc(users.name)),
    access: await tx.select().from(subAccountMembers),
    roles: await tx.select().from(roles).where(eq(roles.accountId, ctx.account.id)).orderBy(asc(roles.createdAt)),
  }));
  const roleOptions = data.roles.map((r) => ({ id: r.id, name: r.name, description: r.description ?? '' }));
  const businesses = ctx.businesses.map((b) => ({ id: b.id, name: b.name, color: b.color, shortName: b.shortName, canManage: ctx.isOwner || grantAllows(ctx.grants[b.id], 'team.manage') }));

  return (
    <div className="space-y-5">
      <PageHeader title="Team" subtitle="Give each person a role in the businesses they work in. The database enforces it on every request." />
      <Card><CardHeader title="People" subtitle={`${data.members.length} with a login`} /><CardBody className="divide-y divide-border">
        {data.members.length ? data.members.map(({ u, role, allRoleId }) => {
          const perBusiness = Object.fromEntries(data.access.filter((a) => a.userId === u.id).map((a) => [a.subAccountId, a.roleId]));
          return (
            <div key={u.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{u.name} {u.id === ctx.user.id ? <span className="text-xs text-muted">(you)</span> : null}</p>
                  <p className="text-xs text-muted">{u.email} · {u.lastLoginAt ? `last login ${relativeTime(u.lastLoginAt)}` : 'never logged in'}</p>
                </div>
                {u.mfaEnabledAt ? <Badge tone="ok">2-step on</Badge> : <Badge>2-step off</Badge>}
                {role === 'owner' ? <Badge tone="accent">Owner · everything</Badge> : null}
              </div>
              {role !== 'owner' && u.id !== ctx.user.id ? (
                <MemberAccess userId={u.id} isOwner={ctx.isOwner} allRoleId={allRoleId} perBusiness={perBusiness} roles={roleOptions} businesses={businesses} />
              ) : null}
            </div>
          );
        }) : <EmptyState title="Just you so far" body="Add your first team member below." />}
      </CardBody></Card>
      <Card><CardHeader title="Add a team member" subtitle="e.g. a Head Installer who is Staff in Classy Kitchen Facelifts only" /><CardBody>
        <InviteForm isOwner={ctx.isOwner} roles={roleOptions} businesses={businesses} />
      </CardBody></Card>
    </div>
  );
}
