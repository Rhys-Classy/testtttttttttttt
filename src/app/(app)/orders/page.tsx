import { and, desc, eq, sql } from 'drizzle-orm';
import { ShoppingBag } from 'lucide-react';
import { contacts, orders } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { moduleScope, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';

export const metadata = { title: 'Orders' };

export default async function OrdersPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const scope = moduleScope(ctx, 'orders', sp1(p.b));
  if (!scope.businesses.length) return <ModuleOff label="Orders" business={ctx.current?.name} />;
  const rows = await readScope(ctx, (tx) => tx.select({ o: orders, c: contacts }).from(orders)
    .leftJoin(contacts, and(eq(contacts.id, orders.contactId), eq(contacts.subAccountId, orders.subAccountId)))
    .where(sql`${orders.subAccountId} = any(${pgArray(scope.ids)})`).orderBy(desc(orders.createdAt)).limit(200));
  return (
    <div>
      <PageHeader title="Orders" subtitle="Product orders. Connect your online store to sync them automatically (Shopify / website webhook)." />
      {rows.length ? (
        <List>
          {rows.map(({ o, c }) => (
            <ListRow key={o.id} icon={<ShoppingBag className="size-5" />} title={<>{o.number} <span className="font-normal text-muted">· {c ? contactName(c) : 'Guest'}</span></>}
              meta={<>{!ctx.current ? <BusinessBadge business={businessById(ctx, o.subAccountId)} /> : null}<StatusBadge status={o.status} /><span>{formatDate(o.createdAt, ctx.tz)}</span><span>{o.items.reduce((a, i) => a + i.quantity, 0)} items</span><span>{o.source}</span></>}
              right={formatMoney(o.totalCents, o.currency)} />
          ))}
        </List>
      ) : <EmptyState title="No orders yet" body="Orders from your store or wholesale invoices will show here. Wholesale customers can be invoiced from Invoices." />}
    </div>
  );
}
