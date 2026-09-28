import Link from 'next/link';
import { and, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { appointments, contacts, jobs, tasks } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { addDaysKey, dayRange, formatDate, formatTime, monthRange, toDateKey, todayKey, weekRange } from '@/lib/dates';
import { can, businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { qs, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { AddButton } from '@/components/add-button';
import { BusinessFilter } from '@/components/business-filter';
import { cn } from '@/lib/cn';
import { EventChip, type CalEvent } from './event-chip';

import { NoAccess } from '@/components/no-access';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  if (!can(ctx, 'calendar.view')) return <NoAccess what="the calendar" />;
  const p = await searchParams;
  const tz = ctx.tz;
  const today = todayKey(tz);
  const view = (sp1(p.view) as 'day' | 'week' | 'month') ?? 'week';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(sp1(p.d) ?? '') ? sp1(p.d)! : today;
  const b = sp1(p.b);
  const ids = b && ctx.scopeIds.includes(b) ? [b] : ctx.scopeIds;

  let startKey: string;
  let days: number;
  if (view === 'day') { startKey = d; days = 1; }
  else if (view === 'week') { startKey = weekRange(d, tz).startKey; days = 7; }
  else {
    const first = `${d.slice(0, 8)}01`;
    startKey = weekRange(first, tz).startKey;
    const monthEnd = toDateKey(new Date(monthRange(d, tz).end.getTime() - 1), tz);
    const endWeek = weekRange(monthEnd, tz).startKey;
    days = Math.round((Date.parse(endWeek) - Date.parse(startKey)) / 86_400_000) + 7;
  }
  const from = dayRange(startKey, tz).start;
  const to = dayRange(addDaysKey(startKey, days), tz).start;

  const data = await readScope(ctx, async (tx) => ({
    appts: await tx.select({ a: appointments, c: contacts }).from(appointments)
      .leftJoin(contacts, and(eq(contacts.id, appointments.contactId), eq(contacts.subAccountId, appointments.subAccountId)))
      .where(and(sql`${appointments.subAccountId} = any(${pgArray(ids)})`, gte(appointments.startsAt, from), lt(appointments.startsAt, to))),
    jobs: await tx.select({ j: jobs, c: contacts }).from(jobs)
      .leftJoin(contacts, and(eq(contacts.id, jobs.contactId), eq(contacts.subAccountId, jobs.subAccountId)))
      .where(and(sql`${jobs.subAccountId} = any(${pgArray(ids)})`, lt(jobs.scheduledStart, to), gte(sql`coalesce(${jobs.scheduledEnd}, ${jobs.scheduledStart})`, from), ne(jobs.status, 'cancelled'))),
    tasks: await tx.select().from(tasks).where(and(sql`${tasks.subAccountId} = any(${pgArray(ids)})`, eq(tasks.allDay, false), inArray(tasks.status, ['todo', 'in_progress']), gte(tasks.dueAt, from), lt(tasks.dueAt, to))),
  }));

  const byDay = new Map<string, CalEvent[]>();
  const push = (key: string, e: CalEvent) => { if (!byDay.has(key)) byDay.set(key, []); byDay.get(key)!.push(e); };
  for (const { a, c } of data.appts) {
    const biz = businessById(ctx, a.subAccountId);
    push(toDateKey(a.startsAt, tz), { id: a.id, kind: 'appointment', subAccountId: a.subAccountId, title: a.title, time: formatTime(a.startsAt, tz), endTime: formatTime(a.endsAt, tz), sub: c ? contactName(c) : a.location, color: biz?.color ?? '#888', href: c ? `/contacts/${c.id}` : undefined, status: a.status, business: biz?.shortName ?? biz?.name, at: a.startsAt.getTime() });
  }
  for (const { j, c } of data.jobs) {
    const biz = businessById(ctx, j.subAccountId);
    const s = toDateKey(j.scheduledStart!, tz);
    const e = j.scheduledEnd ? toDateKey(j.scheduledEnd, tz) : s;
    for (let k = s; k <= e; k = addDaysKey(k, 1)) push(k, { id: `${j.id}-${k}`, kind: 'job', subAccountId: j.subAccountId, title: `Job: ${j.title}`, time: k === s ? formatTime(j.scheduledStart!, tz) : null, sub: c ? contactName(c) : null, color: biz?.color ?? '#888', href: `/jobs/${j.id}`, at: k === s ? j.scheduledStart!.getTime() : 0 });
  }
  for (const t of data.tasks) {
    const biz = businessById(ctx, t.subAccountId);
    push(toDateKey(t.dueAt!, tz), { id: t.id, kind: 'task', subAccountId: t.subAccountId, title: `☐ ${t.title}`, time: formatTime(t.dueAt!, tz), color: biz?.color ?? '#888', href: '/tasks', at: t.dueAt!.getTime() });
  }
  for (const list of byDay.values()) list.sort((x, y) => x.at - y.at);

  const shift = view === 'day' ? 1 : view === 'week' ? 7 : 0;
  const prev = view === 'month' ? `${addDaysKey(`${d.slice(0, 8)}01`, -1).slice(0, 8)}01` : addDaysKey(d, -shift);
  const next = view === 'month' ? toDateKey(monthRange(d, tz).end, tz) : addDaysKey(d, shift);
  const base = { view, d, b };
  const title = view === 'day' ? formatDate(d, tz, { weekday: 'long', day: 'numeric', month: 'long' }) : view === 'week' ? `Week of ${formatDate(startKey, tz, { day: 'numeric', month: 'short' })}` : formatDate(`${d.slice(0, 8)}01`, tz, { month: 'long', year: 'numeric' });
  const dayKeys = Array.from({ length: days }, (_, i) => addDaysKey(startKey, i));

  return (
    <div>
      <PageHeader title="Calendar" actions={<AddButton kind="appointment" label="Book" />} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={`/calendar${qs(base, { d: prev })}`} className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface" aria-label="Previous"><ChevronLeft className="size-4" /></Link>
          <Link href={`/calendar${qs(base, { d: today })}`} className="flex h-10 items-center rounded-xl border border-border bg-surface px-3 text-sm">Today</Link>
          <Link href={`/calendar${qs(base, { d: next })}`} className="flex size-10 items-center justify-center rounded-xl border border-border bg-surface" aria-label="Next"><ChevronRight className="size-4" /></Link>
        </div>
        <h2 className="flex-1 text-lg font-semibold">{title}</h2>
        <div className="flex rounded-xl border border-border bg-surface p-1 text-sm">
          {(['day', 'week', 'month'] as const).map((v) => <Link key={v} href={`/calendar${qs(base, { view: v })}`} className={cn('rounded-lg px-3 py-1.5 capitalize', view === v ? 'bg-surface-2 font-medium' : 'text-muted')}>{v}</Link>)}
        </div>
      </div>
      {!ctx.current ? <BusinessFilter businesses={ctx.businesses} active={b} hrefFor={(id) => `/calendar${qs(base, { b: id })}`} /> : null}

      {view === 'month' ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="grid grid-cols-7 border-b border-border text-center text-xs font-medium text-muted">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => <div key={x} className="py-2">{x}</div>)}</div>
          <div className="grid grid-cols-7">
            {dayKeys.map((k) => {
              const items = byDay.get(k) ?? [];
              const inMonth = k.slice(0, 7) === d.slice(0, 7);
              return (
                <div key={k} className={cn('min-h-24 border-b border-r border-border p-1 sm:min-h-28', !inMonth && 'bg-surface-2/50')}>
                  <Link href={`/calendar${qs(base, { view: 'day', d: k })}`} className={cn('mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs', k === today ? 'bg-accent font-bold text-accent-fg' : inMonth ? '' : 'text-muted')}>{Number(k.slice(8))}</Link>
                  <div className="space-y-1">
                    {items.slice(0, 3).map((e) => <EventChip key={e.id} e={e} compact />)}
                    {items.length > 3 ? <Link href={`/calendar${qs(base, { view: 'day', d: k })}`} className="block px-1 text-xs text-muted">+{items.length - 3} more</Link> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={cn('grid grid-cols-1 gap-3', view === 'week' ? 'md:grid-cols-7' : '')}>
          {dayKeys.map((k) => {
            const items = byDay.get(k) ?? [];
            return (
              <div key={k} className={cn('rounded-2xl border border-border bg-surface p-2', k === today && 'ring-2 ring-accent')}>
                <Link href={`/calendar${qs(base, { view: 'day', d: k })}`} className="mb-2 flex items-baseline gap-2 px-1">
                  <span className={cn('text-sm font-semibold', k === today && 'text-accent')}>{formatDate(k, tz, { weekday: 'short' })}</span>
                  <span className="text-xs text-muted">{formatDate(k, tz, { day: 'numeric', month: 'short' })}</span>
                </Link>
                <div className="space-y-1.5">
                  {items.length ? items.map((e) => <EventChip key={e.id} e={e} />) : <p className="px-1 text-xs text-muted">{view === 'day' ? 'Nothing booked.' : '—'}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Google / Microsoft calendar sync: connect it per business in Settings → Integrations.</p>
    </div>
  );
}
