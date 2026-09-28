import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { contacts, leads } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { relativeTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { moduleScope, qs, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { Tabs } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { AddButton } from '@/components/add-button';
import { LeadActions } from './lead-actions';

export const metadata = { title: 'Leads' };

const SOURCES = ['website', 'facebook', 'instagram', 'google', 'referral', 'phone', 'sms', 'manual', 'other'];

export default async function LeadsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const status = sp1(p.status) ?? 'open';
  const source = sp1(p.source);
  const b = sp1(p.b);
  const scope = moduleScope(ctx, 'leads', b);
  if (!scope.businesses.length) return <ModuleOff label="Leads" business={ctx.current?.name} />;
  const all = !ctx.current;

  const { rows, counts } = await readScope(ctx, async (tx) => {
    const base = [sql`${leads.subAccountId} = any(${pgArray(scope.ids)})`];
    if (source) base.push(eq(leads.source, source as never));
    const statusCond = status === 'open' ? inArray(leads.status, ['new', 'contacted', 'qualified']) : eq(leads.status, status as never);
    return {
      rows: await tx.select({ l: leads, c: contacts }).from(leads)
        .innerJoin(contacts, and(eq(contacts.id, leads.contactId), eq(contacts.subAccountId, leads.subAccountId)))
        .where(and(...base, statusCond)).orderBy(sql`case ${leads.status} when 'new' then 0 when 'contacted' then 1 else 2 end`, desc(leads.createdAt)).limit(200),
      counts: await tx.select({ s: leads.status, n: sql<number>`count(*)` }).from(leads).where(and(...base)).groupBy(leads.status),
    };
  });
  const n = (s: string) => Number(counts.find((c) => c.s === s)?.n ?? 0);
  const base = { status: status === 'open' ? undefined : status, source, b };
  const tabs = [
    { key: 'open', label: 'Open', href: `/leads${qs(base, { status: undefined })}`, count: n('new') + n('contacted') + n('qualified') },
    { key: 'new', label: 'New', href: `/leads${qs(base, { status: 'new' })}`, count: n('new') },
    { key: 'contacted', label: 'Contacted', href: `/leads${qs(base, { status: 'contacted' })}`, count: n('contacted') },
    { key: 'qualified', label: 'Qualified', href: `/leads${qs(base, { status: 'qualified' })}`, count: n('qualified') },
    { key: 'converted', label: 'Converted', href: `/leads${qs(base, { status: 'converted' })}`, count: n('converted') },
    { key: 'unqualified', label: 'Not a fit', href: `/leads${qs(base, { status: 'unqualified' })}`, count: n('unqualified') },
  ];

  return (
    <div>
      <PageHeader title="Leads" subtitle="New enquiries. Call the new ones first." actions={<AddButton kind="lead" label="Add lead" />} />
      <Tabs tabs={tabs} active={status} />
      {all ? <BusinessFilter businesses={scope.businesses} active={b} hrefFor={(id) => `/leads${qs(base, { b: id })}`} /> : null}
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 text-xs md:mx-0 md:px-0">
        {SOURCES.map((s) => <Link key={s} href={`/leads${qs(base, { source: source === s ? undefined : s })}`} className={`shrink-0 rounded-full border px-3 py-1.5 ${source === s ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted'}`}>{s[0].toUpperCase() + s.slice(1)}</Link>)}
      </div>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map(({ l, c }) => (
            <li key={l.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">{contactName(c)}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {all ? <BusinessBadge business={businessById(ctx, l.subAccountId)} /> : null}
                    <StatusBadge status={l.status} />
                    <span>{l.source}</span>
                    <span>{relativeTime(l.createdAt)}</span>
                    {c.phone ? <span>{c.phone}</span> : null}
                    {l.valueCents ? <span className="font-medium text-text">{formatMoney(l.valueCents)}</span> : null}
                  </div>
                  {l.notes ? <p className="mt-2 line-clamp-2 text-sm text-muted">{l.notes}</p> : null}
                  {l.nextAction && l.status !== 'converted' ? <p className="mt-1 text-xs"><span className="text-muted">Next:</span> {l.nextAction}</p> : null}
                </div>
                <LeadActions subAccountId={l.subAccountId} leadId={l.id} status={l.status} phone={c.phone} />
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No leads here" body="New enquiries from forms, ads, calls and messages land here automatically." />}
    </div>
  );
}
