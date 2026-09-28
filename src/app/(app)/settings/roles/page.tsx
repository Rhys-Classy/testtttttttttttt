import { asc, eq, sql } from 'drizzle-orm';
import { withContext } from '@/db/context';
import { roles, subAccountMembers, accountMembers } from '@/db/schema';
import { PERMISSION_GROUPS } from '@/lib/permissions';
import { requireContext } from '@/server/context';
import { PageHeader } from '@/components/ui/page';
import { NoAccess } from '@/components/no-access';
import { RoleEditor } from './role-editor';

export const metadata = { title: 'Roles' };

export default async function RolesPage() {
  const ctx = await requireContext();
  if (!ctx.isOwner) return <NoAccess what="editing roles" />;
  const data = await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: ctx.businesses.map((b) => b.id) }, async (tx) => ({
    roles: await tx.select().from(roles).where(eq(roles.accountId, ctx.account.id)).orderBy(asc(roles.createdAt)),
    usage: await tx.select({ roleId: subAccountMembers.roleId, n: sql<number>`count(*)::int` }).from(subAccountMembers).groupBy(subAccountMembers.roleId),
    allUsage: await tx.select({ roleId: accountMembers.allBusinessesRoleId, n: sql<number>`count(*)::int` }).from(accountMembers).where(eq(accountMembers.accountId, ctx.account.id)).groupBy(accountMembers.allBusinessesRoleId),
  }));
  const groups = PERMISSION_GROUPS.map((g) => ({ key: g.key, label: g.label, perms: Object.entries(g.perms).map(([key, label]) => ({ key, label })) }));
  const used = (id: string) => (data.usage.find((u) => u.roleId === id)?.n ?? 0) + (data.allUsage.find((u) => u.roleId === id)?.n ?? 0);
  return (
    <div className="space-y-5">
      <PageHeader title="Roles" subtitle="What each role can see and do. Changes apply immediately to everyone with that role." />
      {data.roles.map((r) => (
        <RoleEditor key={r.id} groups={groups} usedBy={used(r.id)}
          role={{ id: r.id, name: r.name, description: r.description ?? '', dataScope: r.dataScope, permissions: r.permissions, system: !!r.key }} />
      ))}
      <RoleEditor groups={groups} usedBy={0} role={null} />
    </div>
  );
}
