import Link from 'next/link';
import { addDaysKey, dayRange, formatDate, todayKey } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext, can } from '@/server/context';
import { getReport } from '@/server/queries/reports';
import { getBusinessSummaries } from '@/server/queries/dashboard';
import { moduleScope, qs, sp1, type SP } from '@/server/page-helpers';
import { PageHeader, Stat } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { BusinessFilter } from '@/components/business-filter';
import { BusinessDot } from '@/components/business-badge';
import { ModuleOff } from '@/components/module-off';
import { HorizontalBars, MonthlyColumns } from '@/components/charts';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Reports' };

/** Australian financial year starts 1 July. */
function fyStart(today: string, back = 0) {
  const [y, m] = today.split('-').map(Number);
  const start = (m >= 7 ? y : y - 1) - back;
  return `${start}-07-01`;
}

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const b = sp1(p.b);
  const scope = moduleScope(ctx, 'reports', b);
  // Money figures need reports.financial in every business being reported on.
  const financial = scope.ids.length > 0 && scope.ids.every((id) => can(ctx, 'reports.financial', id));
  if (!scope.businesses.length) return <ModuleOff label="Reports" business={ctx.current?.name} noAccess={scope.noAccess} />;
  const tz = ctx.tz;
  const today = todayKey(tz);
  const range = sp1(p.range) ?? 'month';
  const thisMonth = `${today.slice(0, 8)}01`;
  const lastMonth = `${addDaysKey(thisMonth, -1).slice(0, 8)}01`;
  const presets: Record<string, { label: string; from: string; to: string }> = {
    month: { label: 'This month', from: thisMonth, to: addDaysKey(today, 1) },
    last_month: { label: 'Last month', from: lastMonth, to: thisMonth },
    '90d': { label: 'Last 90 days', from: addDaysKey(today, -89), to: addDaysKey(today, 1) },
    fy: { label: 'This financial year', from: fyStart(today), to: addDaysKey(today, 1) },
    last_fy: { label: 'Last financial year', from: fyStart(today, 1), to: fyStart(today) },
  };
  const custom = sp1(p.from) && sp1(p.to) ? { label: 'Custom', from: sp1(p.from)!, to: addDaysKey(sp1(p.to)!, 1) } : null;
  const sel = (range === 'custom' && custom) || presets[range] || presets.month;
  const from = dayRange(sel.from, tz).start;
  const to = dayRange(sel.to, tz).start;

  const { r, cards } = await readScope(ctx, async (tx) => ({
    r: await getReport(tx, scope.ids, { from, to }, tz),
    cards: !ctx.current && !b ? await getBusinessSummaries(tx, scope.ids, tz) : [],
  }));

  // Last 12 months, zero-filled.
  const months: string[] = [];
  let k = thisMonth;
  for (let i = 0; i < 12; i++) { months.unshift(k.slice(0, 7)); k = `${addDaysKey(k, -1).slice(0, 8)}01`; }
  const monthly = months.map((m) => ({ month: m, cents: r.revenue.monthly.find((x) => x.month === m)?.cents ?? 0 }));
  const base = { range: range === 'month' ? undefined : range, b, from: sp1(p.from), to: sp1(p.to) };
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle={`${sel.label}: ${formatDate(sel.from, tz)} – ${formatDate(addDaysKey(sel.to, -1), tz)}`} />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        {Object.entries(presets).map(([key, v]) => (
          <Link key={key} href={`/reports${qs(base, { range: key === 'month' ? undefined : key, from: undefined, to: undefined })}`} className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm', range === key ? 'border-text font-medium' : 'border-border text-muted')}>{v.label}</Link>
        ))}
        <form className="flex shrink-0 items-center gap-1 text-sm">
          <input type="hidden" name="range" value="custom" />{b ? <input type="hidden" name="b" value={b} /> : null}
          <input type="date" name="from" defaultValue={sp1(p.from)} className="h-9 rounded-lg border border-border bg-surface px-2" aria-label="From" />
          <input type="date" name="to" defaultValue={sp1(p.to)} className="h-9 rounded-lg border border-border bg-surface px-2" aria-label="To" />
          <button className="h-9 rounded-lg border border-border px-3">Go</button>
        </form>
      </div>
      {!ctx.current ? <BusinessFilter businesses={scope.businesses} active={b} hrefFor={(id) => `/reports${qs(base, { b: id })}`} /> : null}

      {financial ? (
      <Card>
        <CardHeader title="Revenue" subtitle="Money received (net of refunds)" />
        <CardBody className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Paid" value={formatMoney(r.revenue.paidCents)} />
            <Stat label="Invoiced" value={formatMoney(r.revenue.invoicedCents)} hint={`${r.revenue.invoiceCount} invoices`} />
            <Stat label="GST on invoices" value={formatMoney(r.revenue.gstCents)} />
            <Stat label="Average invoice" value={formatMoney(r.revenue.averageInvoiceCents)} />
            <Stat label="Outstanding now" value={formatMoney(r.revenue.outstandingCents)} />
            <Stat label="Overdue now" value={formatMoney(r.revenue.overdueCents)} tone={r.revenue.overdueCents ? 'danger' : undefined} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Monthly revenue, last 12 months</p>
            <MonthlyColumns data={monthly} label="Monthly revenue" />
          </div>
        </CardBody>
      </Card>
      ) : null}

      {financial && cards.length ? (
        <Card>
          <CardHeader title="By business" subtitle="This month" />
          <CardBody className="divide-y divide-border">
            {cards.sort((a, c) => c.revenueMonthCents - a.revenueMonthCents).map((c) => {
              const biz = businessById(ctx, c.subAccountId)!;
              return (
                <div key={c.subAccountId} className="flex flex-wrap items-center gap-x-6 gap-y-1 py-2.5 text-sm">
                  <span className="flex min-w-48 flex-1 items-center gap-2 font-medium"><BusinessDot color={biz.color} />{biz.name}</span>
                  <span className="tabular-nums">{formatMoney(c.revenueMonthCents)} <span className="text-muted">revenue</span></span>
                  <span className="tabular-nums">{formatMoney(c.outstandingCents)} <span className="text-muted">owed</span></span>
                  <span className={cn('tabular-nums', c.overdueCents && 'text-danger')}>{formatMoney(c.overdueCents)} <span className="text-muted">overdue</span></span>
                  <span className="tabular-nums">{formatMoney(c.openDealsValueCents)} <span className="text-muted">pipeline</span></span>
                </div>
              );
            })}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sales" />
          <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="New leads" value={r.sales.leads} />
            <Stat label="Lead conversion" value={pct(r.sales.conversionRate)} hint={`${r.sales.converted} converted`} />
            <Stat label="Open pipeline" value={formatMoney(r.sales.pipelineValueCents)} />
            <Stat label="Deals won" value={r.sales.won} hint={formatMoney(r.sales.wonValueCents)} tone={r.sales.won ? 'ok' : undefined} />
            <Stat label="Deals lost" value={r.sales.lost} />
            <Stat label="Quotes accepted" value={`${r.sales.quotesAccepted} / ${r.sales.quotesSent}`} hint={r.sales.quotesSent ? `${pct(r.sales.quotesAccepted / r.sales.quotesSent)} win rate` : undefined} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Customers" />
          <CardBody className="grid grid-cols-2 gap-4">
            <Stat label="New customers" value={r.customers.newCustomers} />
            <Stat label="Repeat customers" value={r.customers.repeatCustomers} hint={`of ${r.customers.payingCustomers} paying`} />
            <Stat label="Average customer value" value={formatMoney(r.customers.averageCustomerValueCents)} hint="Lifetime paid invoices" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leads by source" subtitle="New leads in this period · converted" />
          <CardBody>
            {r.marketing.bySource.length ? <HorizontalBars rows={r.marketing.bySource.map((s) => ({ label: s.source, value: s.leads, sub: `${s.converted} won` }))} /> : <p className="text-sm text-muted">No leads in this period.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Messages & campaigns" />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Emails sent" value={r.marketing.emailsSent} />
              <Stat label="SMS sent" value={r.marketing.smsSent} />
              <Stat label="Replies in" value={r.marketing.inbound} />
              <Stat label="Failed" value={r.marketing.failed} tone={r.marketing.failed ? 'danger' : undefined} />
            </div>
            {r.marketing.campaigns.map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="flex justify-between text-sm"><span>{c.name} <span className="text-muted">({c.channel})</span></span><span className="tabular-nums">{c.stats?.sent ?? 0} sent</span></Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
