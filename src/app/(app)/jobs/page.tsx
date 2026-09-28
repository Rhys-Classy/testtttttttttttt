import Link from 'next/link';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { contacts, jobs } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, label, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { JOB_STATUSES } from '@/server/services/work';
import { moduleScope, qs, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { Tabs } from '@/components/ui/list';
import { BusinessBadge } from '@/components/business-badge';
import { BusinessFilter } from '@/components/business-filter';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { AddButton } from '@/components/add-button';

export const metadata = { title: 'Jobs' };

const ACTIVE = ['booked', 'scheduled', 'in_progress', 'waiting'];

export default async function JobsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const view = sp1(p.view) ?? 'active';
  const b = sp1(p.b);
  const scope = moduleScope(ctx, 'jobs', b);
  if (!scope.businesses.length) return <ModuleOff label="Jobs" business={ctx.current?.name} />;
  const all = !ctx.current;
  const statuses = view === 'active' ? ACTIVE : view === 'pipeline' ? ['enquiry', 'quoted'] : view === 'done' ? ['completed', 'cancelled'] : JOB_STATUSES.map((s) => s.key);
  const rows = await readScope(ctx, (tx) => tx.select({ j: jobs, c: contacts }).from(jobs)
    .leftJoin(contacts, and(eq(contacts.id, jobs.contactId), eq(contacts.subAccountId, jobs.subAccountId)))
    .where(and(sql`${jobs.subAccountId} = any(${pgArray(scope.ids)})`, inArray(jobs.status, statuses as never[])))
    .orderBy(sql`${jobs.scheduledStart} asc nulls last`, asc(jobs.createdAt)).limit(300));
  const base = { view: view === 'active' ? undefined : view, b };
  const cols = JOB_STATUSES.filter((s) => statuses.includes(s.key));
  return (
    <div>
      <PageHeader title={label(ctx, 'jobs', 'Jobs')} subtitle="Customer → quote → job → invoice → payment" actions={<AddButton kind="job" label="New job" />} />
      <Tabs active={view} tabs={[
        { key: 'active', label: 'Active', href: `/jobs${qs(base, { view: undefined })}` },
        { key: 'pipeline', label: 'Enquiry / quoted', href: `/jobs${qs(base, { view: 'pipeline' })}` },
        { key: 'done', label: 'Done', href: `/jobs${qs(base, { view: 'done' })}` },
      ]} />
      {all ? <BusinessFilter businesses={scope.businesses} active={b} hrefFor={(id) => `/jobs${qs(base, { b: id })}`} /> : null}
      {rows.length ? (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
          {cols.map((col) => {
            const items = rows.filter((r) => r.j.status === col.key);
            return (
              <div key={col.key} className="w-72 shrink-0 rounded-2xl bg-surface-2 p-2">
                <p className="px-2 pb-2 pt-1 text-sm font-semibold">{col.label} <span className="font-normal text-muted">· {items.length}</span></p>
                <div className="space-y-2">
                  {items.map(({ j, c }) => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-xl border border-border bg-surface p-3 hover:border-accent">
                      <p className="text-xs text-muted">{j.number}</p>
                      <p className="text-sm font-medium leading-snug">{j.title}</p>
                      <p className="mt-1 truncate text-xs text-muted">{c ? contactName(c) : 'No customer'}</p>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className={j.scheduledStart ? '' : 'text-muted'}>{j.scheduledStart ? formatDate(j.scheduledStart, ctx.tz, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Not scheduled'}</span>
                        {j.valueCents ? <span className="font-medium tabular-nums">{formatMoney(j.valueCents, 'AUD', 'en-AU', { compact: true })}</span> : null}
                      </div>
                      {all ? <div className="mt-2"><BusinessBadge business={businessById(ctx, j.subAccountId)} /></div> : null}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : <EmptyState title="No jobs here" body="Jobs are created when a customer accepts a quote, or add one with the + button." />}
    </div>
  );
}
