import { and, asc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { contacts, tasks } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { addDaysKey, dayRange, formatDate, formatTime, todayKey } from '@/lib/dates';
import { can, businessById, readScope, requireContext } from '@/server/context';
import { contactName } from '@/server/services/crm';
import { qs, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { Tabs } from '@/components/ui/list';
import { BusinessFilter } from '@/components/business-filter';
import { TaskRow, type TaskRowData } from '@/components/dashboard/task-row';
import { EmptyState } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { AddTaskInline } from './add-task-inline';

import { NoAccess } from '@/components/no-access';

export const metadata = { title: 'My Day' };

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  if (!can(ctx, 'tasks.view')) return <NoAccess what="tasks" />;
  const p = await searchParams;
  const view = sp1(p.view) ?? 'today';
  const b = sp1(p.b);
  const priority = sp1(p.priority);
  const ids = b && ctx.scopeIds.includes(b) ? [b] : ctx.scopeIds;
  const tz = ctx.tz;
  const today = todayKey(tz);
  const { start: todayStart, end: todayEnd } = dayRange(today, tz);
  const weekEnd = dayRange(addDaysKey(today, 7), tz).start;
  const all = !ctx.current;

  const rows = await readScope(ctx, async (tx) => {
    const base = [sql`${tasks.subAccountId} = any(${pgArray(ids)})`];
    if (priority) base.push(eq(tasks.priority, priority as never));
    return tx.select({ t: tasks, c: contacts }).from(tasks)
      .leftJoin(contacts, and(eq(contacts.id, tasks.contactId), eq(contacts.subAccountId, tasks.subAccountId)))
      .where(and(...base, or(
        inArray(tasks.status, ['todo', 'in_progress', 'snoozed']),
        and(eq(tasks.status, 'done'), gte(tasks.completedAt, todayStart)),
      )))
      .orderBy(sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`, asc(tasks.dueAt)).limit(300);
  });

  const open = rows.filter((r) => r.t.status !== 'done' && r.t.status !== 'snoozed');
  const groups = {
    overdue: open.filter((r) => r.t.dueAt && r.t.dueAt < todayStart),
    today: open.filter((r) => r.t.dueAt && r.t.dueAt >= todayStart && r.t.dueAt < todayEnd),
    upcoming: open.filter((r) => r.t.dueAt && r.t.dueAt >= todayEnd && r.t.dueAt < weekEnd),
    later: open.filter((r) => r.t.dueAt && r.t.dueAt >= weekEnd),
    someday: open.filter((r) => !r.t.dueAt),
    snoozed: rows.filter((r) => r.t.status === 'snoozed'),
    done: rows.filter((r) => r.t.status === 'done'),
  };

  const toRow = (r: (typeof rows)[number]): TaskRowData => ({
    id: r.t.id, subAccountId: r.t.subAccountId, title: r.t.title, done: r.t.status === 'done', priority: r.t.priority,
    dueLabel: r.t.status === 'snoozed' && r.t.snoozedUntil ? `Snoozed until ${formatDate(r.t.snoozedUntil, tz, { weekday: 'short', day: 'numeric', month: 'short' })} ${formatTime(r.t.snoozedUntil, tz)}`
      : r.t.dueAt ? (todayKey(tz, r.t.dueAt) === today ? (r.t.allDay ? 'Today' : formatTime(r.t.dueAt, tz)) : formatDate(r.t.dueAt, tz, { weekday: 'short', day: 'numeric', month: 'short' }) + (r.t.allDay ? '' : ` ${formatTime(r.t.dueAt, tz)}`)) : null,
    overdue: !!r.t.dueAt && r.t.dueAt < todayStart,
    contact: r.c ? contactName(r.c) : null,
    business: businessById(ctx, r.t.subAccountId),
  });

  const base = { view, b, priority };
  const tabs = [
    { key: 'today', label: 'My Day', href: `/tasks${qs(base, { view: undefined })}`, count: groups.overdue.length + groups.today.length },
    { key: 'week', label: 'Next 7 days', href: `/tasks${qs(base, { view: 'week' })}`, count: groups.upcoming.length },
    { key: 'all', label: 'Everything', href: `/tasks${qs(base, { view: 'all' })}`, count: open.length },
    { key: 'snoozed', label: 'Snoozed', href: `/tasks${qs(base, { view: 'snoozed' })}`, count: groups.snoozed.length },
  ];

  const sections: { title: string; items: typeof rows; tone?: string }[] =
    view === 'week' ? [{ title: 'Next 7 days', items: groups.upcoming }]
    : view === 'snoozed' ? [{ title: 'Snoozed', items: groups.snoozed }]
    : view === 'all' ? [{ title: 'Overdue', items: groups.overdue, tone: 'text-danger' }, { title: 'Today', items: groups.today }, { title: 'Next 7 days', items: groups.upcoming }, { title: 'Later', items: groups.later }, { title: 'No date', items: groups.someday }]
    : [{ title: 'Overdue', items: groups.overdue, tone: 'text-danger' }, { title: 'Today', items: groups.today }, { title: 'Done today', items: groups.done }];

  const hasAny = sections.some((s) => s.items.length);
  return (
    <div>
      <PageHeader title="My Day" subtitle={all ? 'Tasks across all your businesses' : `Tasks for ${ctx.current!.name}`} />
      <AddTaskInline businesses={(ctx.current ? [ctx.current] : ctx.businesses).map((x) => ({ id: x.id, name: x.name }))} />
      <Tabs tabs={tabs} active={view} />
      {all ? <BusinessFilter businesses={ctx.businesses} active={b} hrefFor={(id) => `/tasks${qs(base, { b: id })}`} /> : null}
      <div className="mb-4 flex gap-2 text-xs">
        {['urgent', 'high', 'normal', 'low'].map((pr) => (
          <a key={pr} href={`/tasks${qs(base, { priority: priority === pr ? undefined : pr })}`} className={`rounded-full border px-3 py-1.5 ${priority === pr ? 'border-text font-medium' : 'border-border text-muted'}`}>{pr[0].toUpperCase() + pr.slice(1)}</a>
        ))}
      </div>
      {!hasAny ? <EmptyState title="Nothing here" body="Enjoy the quiet. Add a task with the + button or press ⌘K." action={<Button variant="soft">All clear</Button>} /> : null}
      <div className="space-y-6">
        {sections.filter((s) => s.items.length).map((s) => (
          <section key={s.title}>
            <h2 className={`mb-1 px-2 text-xs font-semibold uppercase tracking-wider ${s.tone ?? 'text-muted'}`}>{s.title} · {s.items.length}</h2>
            <div className="rounded-2xl border border-border bg-surface p-1">
              {s.items.map((r) => <TaskRow key={r.t.id} task={toRow(r)} showBusiness={all} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}


