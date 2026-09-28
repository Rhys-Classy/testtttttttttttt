import { asc, sql } from 'drizzle-orm';
import { UserCog } from 'lucide-react';
import { appointments, staffMembers } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { businessById, readScope, requireContext } from '@/server/context';
import { moduleScope, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow } from '@/components/ui/list';
import { Badge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { AddStaff, StaffToggle } from './staff-client';

export const metadata = { title: 'Staff' };

export default async function StaffPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const scope = moduleScope(ctx, 'staff', sp1(p.b));
  if (!scope.businesses.length) return <ModuleOff label="Staff" business={ctx.current?.name} noAccess={scope.noAccess} />;
  const rows = await readScope(ctx, (tx) => tx.select({
    s: staffMembers,
    upcoming: sql<number>`(select count(*) from ${appointments} a where a.staff_id = ${staffMembers.id} and a.sub_account_id = ${staffMembers.subAccountId} and a.starts_at >= now() and a.status <> 'cancelled')`,
  }).from(staffMembers).where(sql`${staffMembers.subAccountId} = any(${pgArray(scope.ids)})`).orderBy(sql`${staffMembers.active} desc`, asc(staffMembers.name)));
  return (
    <div>
      <PageHeader title="Staff" subtitle="Team members and support workers. Assign them to appointments." />
      <AddStaff businesses={scope.businesses.map((b) => ({ id: b.id, name: b.name }))} />
      {rows.length ? (
        <List>
          {rows.map(({ s, upcoming }) => (
            <ListRow key={s.id} icon={<UserCog className="size-5" />} title={<>{s.name}{!s.active ? <Badge className="ml-2">Inactive</Badge> : null}</>}
              meta={<>{!ctx.current ? <BusinessBadge business={businessById(ctx, s.subAccountId)} /> : null}{s.role ? <span>{s.role}</span> : null}{s.phone ? <a href={`tel:${s.phone}`} className="text-accent">{s.phone}</a> : null}<span>{Number(upcoming)} upcoming shifts</span></>}
              right={<StaffToggle subAccountId={s.subAccountId} id={s.id} active={s.active} />} />
          ))}
        </List>
      ) : <EmptyState title="No staff yet" body="Add the people who deliver your services." />}
    </div>
  );
}
