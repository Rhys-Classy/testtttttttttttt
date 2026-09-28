import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { CreditCard } from 'lucide-react';
import { contacts, invoices, payments } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { dayRange, formatDateTime, monthRange, todayKey, weekRange } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { moduleScope, qs, sp1, type SP, pageOf, splitPage } from '@/server/page-helpers';
import { Pager } from '@/components/ui/pager';
import { PageHeader, Stat } from '@/components/ui/page';
import { Card } from '@/components/ui/card';
import { List, ListRow, Tabs } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';

export const metadata = { title: 'Payments' };

export default async function PaymentsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const status = sp1(p.status);
  const b = sp1(p.b);
  const scope = moduleScope(ctx, 'payments', b);
  if (!scope.businesses.length) return <ModuleOff label="Payments" business={ctx.current?.name} noAccess={scope.noAccess} />;
  const tz = ctx.tz;
  const today = todayKey(tz);
  const d = dayRange(today, tz);
  const w = weekRange(today, tz);
  const m = monthRange(today, tz);
  const all = !ctx.current;

  const pg = pageOf(p);
  const { stats, rows: fetched } = await readScope(ctx, async (tx) => {
    const base = sql`${payments.subAccountId} = any(${pgArray(scope.ids)})`;
    const ok = sql`${payments.status} in ('succeeded','partially_refunded','refunded')`;
    const net = (from: Date) => sql<number>`coalesce(sum(${payments.amountCents} - ${payments.refundedCents}) filter (where ${ok} and ${payments.paidAt} >= ${from}), 0)`;
    const [s] = await tx.select({
      today: net(d.start), week: net(w.start), month: net(m.start),
      total: sql<number>`coalesce(sum(${payments.amountCents} - ${payments.refundedCents}) filter (where ${ok}), 0)`,
      refunds: sql<number>`coalesce(sum(${payments.refundedCents}), 0)`,
      failed: sql<number>`count(*) filter (where ${payments.status} = 'failed')`,
      pending: sql<number>`count(*) filter (where ${payments.status} = 'pending')`,
    }).from(payments).where(base);
    const rows = await tx.select({ p: payments, c: contacts, i: invoices }).from(payments)
      .leftJoin(contacts, and(eq(contacts.id, payments.contactId), eq(contacts.subAccountId, payments.subAccountId)))
      .leftJoin(invoices, and(eq(invoices.id, payments.invoiceId), eq(invoices.subAccountId, payments.subAccountId)))
      .where(and(base, status ? (status === 'refunds' ? gte(payments.refundedCents, 1) : eq(payments.status, status as never)) : undefined))
      .orderBy(desc(sql`coalesce(${payments.paidAt}, ${payments.createdAt})`), desc(payments.id)).limit(pg.limit).offset(pg.offset);
    return { stats: s, rows };
  });
  const { rows, hasNext } = splitPage(fetched);
  const base = { status, b };
  const tabs = [
    { key: 'all', label: 'All', href: `/payments${qs(base, { status: undefined })}` },
    { key: 'succeeded', label: 'Received', href: `/payments${qs(base, { status: 'succeeded' })}` },
    { key: 'failed', label: 'Failed', href: `/payments${qs(base, { status: 'failed' })}`, count: Number(stats.failed) },
    { key: 'pending', label: 'Pending', href: `/payments${qs(base, { status: 'pending' })}`, count: Number(stats.pending) },
    { key: 'refunds', label: 'Refunds', href: `/payments${qs(base, { status: 'refunds' })}` },
  ];
  return (
    <div>
      <PageHeader title="Payments" subtitle="Every payment links business → customer → invoice → transaction" />
      <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="Today" value={formatMoney(Number(stats.today))} tone={Number(stats.today) ? 'ok' : undefined} />
        <Stat label="This week" value={formatMoney(Number(stats.week))} />
        <Stat label="This month" value={formatMoney(Number(stats.month))} />
        <Stat label="All time" value={formatMoney(Number(stats.total))} hint={Number(stats.refunds) ? `${formatMoney(Number(stats.refunds))} refunded` : undefined} />
      </Card>
      <Tabs tabs={tabs} active={status ?? 'all'} />
      {all ? <BusinessFilter businesses={scope.businesses} active={b} hrefFor={(id) => `/payments${qs(base, { b: id })}`} /> : null}
      {rows.length ? (
        <List>
          {rows.map(({ p: pay, c, i }) => (
            <ListRow key={pay.id} href={i ? `/invoices/${i.id}` : undefined} icon={<CreditCard className="size-5" />}
              title={<>{c ? contactName(c) : 'Unknown payer'}{i ? <span className="font-normal text-muted"> · {i.number}</span> : null}</>}
              meta={<>{all ? <BusinessBadge business={businessById(ctx, pay.subAccountId)} /> : null}<StatusBadge status={pay.status} /><span>{formatDateTime(pay.paidAt ?? pay.createdAt, tz)}</span>
                <span>{pay.provider === 'stripe' ? `Stripe${pay.cardBrand ? ` · ${pay.cardBrand} ····${pay.cardLast4}` : ''}` : pay.method.replace('_', ' ')}</span>{pay.failureReason ? <span className="text-danger">{pay.failureReason}</span> : null}</>}
              right={formatMoney(pay.amountCents, pay.currency)} rightSub={pay.refundedCents ? `−${formatMoney(pay.refundedCents)} refunded` : undefined} />
          ))}
        </List>
      ) : <EmptyState title="No payments yet" body="Payments appear here when customers pay online or you record one on an invoice." />}
      <Pager path="/payments" params={p} page={pg.page} hasNext={hasNext} shown={rows.length} />
    </div>
  );
}
