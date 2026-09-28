import { asc, sql } from 'drizzle-orm';
import { Package } from 'lucide-react';
import { products } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { formatMoney } from '@/lib/money';
import { AU_GST } from '@/lib/tax';
import { businessById, readScope, requireContext } from '@/server/context';
import { moduleScope, qs, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow } from '@/components/ui/list';
import { Badge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { ProductForm } from './product-form';

export const metadata = { title: 'Products & services' };

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const b = sp1(p.b);
  const scope = moduleScope(ctx, 'products', b);
  if (!scope.businesses.length) return <ModuleOff label="Products" business={ctx.current?.name} noAccess={scope.noAccess} />;
  const rows = await readScope(ctx, (tx) => tx.select().from(products).where(sql`${products.subAccountId} = any(${pgArray(scope.ids)})`).orderBy(asc(products.category), asc(products.name)));
  const bizOpts = scope.businesses.map((x) => ({ id: x.id, name: x.name }));
  const taxCodes = AU_GST.codes.map((c) => ({ code: c.code, label: c.label }));
  const all = !ctx.current;
  return (
    <div>
      <PageHeader title="Products & services" subtitle="Each business has its own catalogue. Use them on quotes and invoices." actions={<ProductForm businesses={bizOpts} taxCodes={taxCodes} />} />
      {all ? <BusinessFilter businesses={scope.businesses} active={b} hrefFor={(id) => `/products${qs({}, { b: id })}`} /> : null}
      {rows.length ? (
        <List asDiv>
          {rows.map((x) => (
            <ProductForm key={x.id} businesses={bizOpts} taxCodes={taxCodes}
              product={{ id: x.id, subAccountId: x.subAccountId, name: x.name, sku: x.sku, description: x.description, price: (x.priceCents / 100).toFixed(2), cost: x.costCents ? (x.costCents / 100).toFixed(2) : '', taxCode: x.taxCode, category: x.category, kind: x.kind, unit: x.unit, active: x.active }}
              trigger={<ListRow asDiv className="cursor-pointer hover:bg-surface-2" icon={<Package className="size-5" />} title={<>{x.name}{!x.active ? <Badge className="ml-2">Inactive</Badge> : null}</>}
                meta={<>{all ? <BusinessBadge business={businessById(ctx, x.subAccountId)} /> : null}{x.sku ? <span>{x.sku}</span> : null}{x.category ? <span>{x.category}</span> : null}<span>{x.taxCode.replace('_', ' ')}</span>{x.costCents ? <span>Margin {Math.round(((x.priceCents - x.costCents) / x.priceCents) * 100)}%</span> : null}</>}
                right={formatMoney(x.priceCents)} rightSub={x.unit ? `per ${x.unit}` : undefined} />} />
          ))}
        </List>
      ) : <EmptyState title="No products yet" body="Add the things you sell so quotes take seconds." />}
    </div>
  );
}
