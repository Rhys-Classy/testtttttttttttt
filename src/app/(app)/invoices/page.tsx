import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Receipt } from 'lucide-react';
import { contacts, invoices } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { formatDate, todayKey } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { moduleScope, qs, sp1, type SP, pageOf, splitPage } from '@/server/page-helpers';
import { Pager } from '@/components/ui/pager';
import { PageHeader, Stat } from '@/components/ui/page';
import { List, ListRow, Tabs } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { LinkButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const metadata = { title: 'Invoices' };

const FILTERS: Record<string, string[] | null> = {
  outstanding: ['sent', 'viewed', 'partially_paid', 'overdue'], overdue: ['overdue'], draft: ['draft'], paid: ['paid'], sent: ['sent', 'viewed'], all: null, cancelled: ['cancelled'],
};

export default async function InvoicesPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const status = sp1(p.status) && sp1(p.status)! in FILTERS ? sp1(p.status)! : 'outstanding';
  const b = sp1(p.b);
  const scope = moduleScope(ctx, 'invoices', b);
  if (!scope.businesses.length) return <ModuleOff label="Invoices" business={ctx.current?.name} noAccess={scope.noAccess} />;
  const all = !ctx.current;
  const today = todayKey(ctx.tz);

  const pg = pageOf(p);
  const { rows: fetched, sums } = await readScope(ctx, async (tx) => {
    const base = sql`${invoices.subAccountId} = any(${pgArray(scope.ids)})`;
    const filter = FILTERS[status];
    return {
      rows: await tx.select({ i: invoices, c: contacts }).from(invoices)
        .leftJoin(contacts, and(eq(contacts.id, invoices.contactId), eq(contacts.subAccountId, invoices.subAccountId)))
        .where(and(base, filter ? inArray(invoices.status, filter as never[]) : undefined))
        .orderBy(status === 'paid' ? desc(invoices.paidAt) : status === 'outstanding' || status === 'overdue' ? invoices.dueDate : desc(invoices.createdAt), desc(invoices.id)).limit(pg.limit).offset(pg.offset),
      sums: await tx.select({ s: invoices.status, n: sql<number>`count(*)`, bal: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.amountPaidCents}), 0)` }).from(invoices).where(base).groupBy(invoices.status),
    };
  });
  const { rows, hasNext } = splitPage(fetched);
  const cnt = (keys: string[]) => sums.filter((x) => keys.includes(x.s)).reduce((a, x) => a + Number(x.n), 0);
  const bal = (keys: string[]) => sums.filter((x) => keys.includes(x.s)).reduce((a, x) => a + Number(x.bal), 0);
  const base = { status: status === 'outstanding' ? undefined : status, b };
  const tabs = [
    { key: 'outstanding', label: 'Unpaid', href: `/invoices${qs(base, { status: undefined })}`, count: cnt(FILTERS.outstanding!) },
    { key: 'overdue', label: 'Overdue', href: `/invoices${qs(base, { status: 'overdue' })}`, count: cnt(['overdue']) },
    { key: 'draft', label: 'Drafts', href: `/invoices${qs(base, { status: 'draft' })}`, count: cnt(['draft']) },
    { key: 'paid', label: 'Paid', href: `/invoices${qs(base, { status: 'paid' })}`, count: cnt(['paid']) },
    { key: 'all', label: 'All', href: `/invoices${qs(base, { status: 'all' })}` },
  ];

  return (
    <div>
      <PageHeader title="Invoices" actions={<LinkButton href="/invoices/new" variant="primary">New invoice</LinkButton>} />
      <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
        <Stat label="Outstanding" value={formatMoney(bal(FILTERS.outstanding!))} />
        <Stat label="Overdue" value={formatMoney(bal(['overdue']))} tone={bal(['overdue']) ? 'danger' : undefined} hint={`${cnt(['overdue'])} invoices`} />
        <Stat label="Drafts to send" value={cnt(['draft'])} />
      </Card>
      <Tabs tabs={tabs} active={status} />
      {all ? <BusinessFilter businesses={scope.businesses} active={b} hrefFor={(id) => `/invoices${qs(base, { b: id })}`} /> : null}
      {rows.length ? (
        <List>
          {rows.map(({ i, c }) => {
            const balance = i.totalCents - i.amountPaidCents;
            const late = i.status === 'overdue' ? Math.floor((Date.parse(today) - Date.parse(i.dueDate)) / 86_400_000) : 0;
            return (
              <ListRow key={i.id} href={`/invoices/${i.id}`} icon={<Receipt className="size-5" />}
                title={<>{c ? contactName(c) : 'No customer'} <span className="font-normal text-muted">· {i.number}</span></>}
                meta={<>{all ? <BusinessBadge business={businessById(ctx, i.subAccountId)} /> : null}<StatusBadge status={i.status} /><span>{late ? <span className="text-danger">{late} days late</span> : `Due ${formatDate(i.dueDate)}`}</span>{i.title ? <span className="truncate">{i.title}</span> : null}</>}
                right={formatMoney(['paid', 'draft', 'cancelled'].includes(i.status) ? i.totalCents : balance)}
                rightSub={i.amountPaidCents && i.status !== 'paid' ? `of ${formatMoney(i.totalCents)}` : undefined} />
            );
          })}
        </List>
      ) : <EmptyState title="Nothing here" body={status === 'overdue' ? 'No overdue invoices. Nice.' : 'Create an invoice with the + button or type “invoice John $500 plus GST” in ⌘K.'} />}
      <Pager path="/invoices" params={p} page={pg.page} hasNext={hasNext} shown={rows.length} />
    </div>
  );
}
