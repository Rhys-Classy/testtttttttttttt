import Link from 'next/link';
import { CalendarDays, ChevronRight, Hammer } from 'lucide-react';
import { readScope, requireContext, businessById } from '@/server/context';
import { getAttention, getBusinessSummaries, getMoney, getPipelineSummary, getToday } from '@/server/queries/dashboard';
import { contactName } from '@/server/services/crm';
import { formatDate, formatTime, todayKey, zonedParts } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Stat } from '@/components/ui/page';
import { AttentionList } from '@/components/dashboard/attention-list';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { PipelineBar } from '@/components/dashboard/pipeline-bar';
import { TaskRow } from '@/components/dashboard/task-row';
import { BusinessBadge, BusinessDot } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';

export const metadata = { title: 'Home' };

function greeting(tz: string) {
  const h = zonedParts(new Date(), tz).hour;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default async function HomePage() {
  const ctx = await requireContext();
  const tz = ctx.tz;
  const now = new Date();
  const ids = ctx.scopeIds;
  const all = !ctx.current;

  const data = await readScope(ctx, async (tx) => ({
    attention: await getAttention(tx, ids, tz, now),
    today: await getToday(tx, ids, tz, now),
    money: await getMoney(tx, ids, tz, now),
    pipeline: ctx.current ? await getPipelineSummary(tx, ctx.current.id) : null,
    cards: all ? await getBusinessSummaries(tx, ids, tz, now) : [],
  }));

  const bizList = ctx.businesses.map((b) => ({ id: b.id, name: b.name, shortName: b.shortName, color: b.color }));
  const today = todayKey(tz, now);
  const openTasks = data.today.tasks.filter((t) => t.task.status !== 'done');
  const doneTasks = data.today.tasks.filter((t) => t.task.status === 'done');
  const modules = [...new Set((ctx.current ? [ctx.current] : ctx.businesses).flatMap((b) => b.enabledModules))];
  const firstName = ctx.user.name.split(' ')[0];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">{formatDate(now, tz, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{greeting(tz)}{firstName && firstName !== 'Owner' ? `, ${firstName}` : ''}.</h1>
        <p className="mt-1 text-sm text-muted">
          {data.attention.length ? `${data.attention.length} thing${data.attention.length === 1 ? '' : 's'} need${data.attention.length === 1 ? 's' : ''} you` : 'Nothing urgent'}
          {' · '}{openTasks.length} task{openTasks.length === 1 ? '' : 's'} today
          {' · '}{data.today.appointments.length} appointment{data.today.appointments.length === 1 ? '' : 's'}
          {all ? ` · across ${ctx.businesses.length} businesses` : ''}
        </p>
      </div>

      <QuickActions modules={modules} />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><span className="size-2 rounded-full bg-danger" />Now</span>} subtitle="What needs your attention, most urgent first" />
            <CardBody><AttentionList items={data.attention} businesses={bizList} showBusiness={all} /></CardBody>
          </Card>

          <Card>
            <CardHeader title="Today" subtitle={`${openTasks.length} to do${doneTasks.length ? ` · ${doneTasks.length} done` : ''}`} action={<Link href="/tasks" className="text-sm font-medium text-accent">My Day</Link>} />
            <CardBody className="space-y-4">
              {data.today.appointments.length || data.today.jobs.length ? (
                <div className="space-y-2">
                  {data.today.appointments.map(({ appt, c }) => (
                    <Link key={appt.id} href={`/calendar?d=${today}`} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5">
                      <CalendarDays className="size-5 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{appt.title}</p>
                        <p className="flex items-center gap-2 text-xs text-muted">{all ? <BusinessBadge business={businessById(ctx, appt.subAccountId)} /> : null}{c ? contactName(c) : appt.location}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatTime(appt.startsAt, tz)}</span>
                    </Link>
                  ))}
                  {data.today.jobs.map(({ job, c }) => (
                    <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5">
                      <Hammer className="size-5 shrink-0 text-warn" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{job.title}</p>
                        <p className="flex items-center gap-2 text-xs text-muted">{all ? <BusinessBadge business={businessById(ctx, job.subAccountId)} /> : null}{job.number}{c ? ` · ${contactName(c)}` : ''}</p>
                      </div>
                      <ChevronRight className="size-4 text-muted" />
                    </Link>
                  ))}
                </div>
              ) : null}
              {data.today.tasks.length ? (
                <div className="-mx-2">
                  {data.today.tasks.slice(0, 12).map(({ task, c }) => (
                    <TaskRow key={task.id} showBusiness={all} task={{
                      id: task.id, subAccountId: task.subAccountId, title: task.title, done: task.status === 'done', priority: task.priority,
                      dueLabel: task.dueAt ? (todayKey(tz, task.dueAt) < today ? `Overdue · ${formatDate(task.dueAt, tz, { day: 'numeric', month: 'short' })}` : task.allDay ? 'Today' : formatTime(task.dueAt, tz)) : null,
                      overdue: !!task.dueAt && todayKey(tz, task.dueAt) < today,
                      contact: c ? contactName(c) : null,
                      business: businessById(ctx, task.subAccountId),
                    }} />
                  ))}
                </div>
              ) : !data.today.appointments.length ? <EmptyState title="Clear day" body="No tasks or appointments today." /> : null}
              {data.today.followUps.length ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Follow-ups</p>
                  {data.today.followUps.map(({ lead, c }) => (
                    <Link key={lead.id} href={`/contacts/${c.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="truncate">{lead.nextAction ?? 'Follow up'}: <span className="font-medium">{contactName(c)}</span></span>
                      {all ? <BusinessBadge business={businessById(ctx, lead.subAccountId)} /> : null}
                    </Link>
                  ))}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Money" subtitle={all ? 'All businesses combined' : ctx.current?.name} action={<Link href="/invoices?status=outstanding" className="text-sm font-medium text-accent">Invoices</Link>} />
            <CardBody className="grid grid-cols-2 gap-x-4 gap-y-5">
              <Stat label="Paid today" value={formatMoney(data.money.paidTodayCents)} tone={data.money.paidTodayCents ? 'ok' : undefined} />
              <Stat label="This month" value={formatMoney(data.money.thisMonthCents)} />
              <Stat label="Outstanding" value={formatMoney(data.money.outstandingCents)} />
              <Stat label="Overdue" value={formatMoney(data.money.overdueCents)} hint={data.money.overdueCount ? `${data.money.overdueCount} invoice${data.money.overdueCount === 1 ? '' : 's'}` : 'None'} tone={data.money.overdueCents ? 'danger' : undefined} />
              <Stat label="Due next 7 days" value={formatMoney(data.money.upcomingCents)} hint={`${data.money.upcomingCount} invoice${data.money.upcomingCount === 1 ? '' : 's'}`} />
            </CardBody>
          </Card>

          {data.pipeline ? (
            <Card>
              <CardHeader title="Pipeline" subtitle={data.pipeline.pipeline.name} action={<Link href="/pipeline" className="text-sm font-medium text-accent">Open</Link>} />
              <CardBody><PipelineBar stages={data.pipeline.stages} /></CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      {all ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Your businesses</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.cards.map((card) => {
              const b = businessById(ctx, card.subAccountId)!;
              return (
                <BusinessCard key={b.id} id={b.id} name={b.name} color={b.color} card={card} />
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BusinessCard({ id, name, color, card }: { id: string; name: string; color: string; card: Awaited<ReturnType<typeof getBusinessSummaries>>[number] }) {
  const row = (label: string, value: string, tone?: string) => (
    <div className="flex items-center justify-between py-1 text-sm"><span className="text-muted">{label}</span><span className={`font-medium tabular-nums ${tone ?? ''}`}>{value}</span></div>
  );
  return (
    <Card className="overflow-hidden">
      <div className="h-1" style={{ backgroundColor: color }} />
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <BusinessDot color={color} />
          <h3 className="min-w-0 flex-1 truncate font-semibold">{name}</h3>
          <form action={async () => { 'use server'; const { switchBusiness } = await import('@/server/actions/shell'); await switchBusiness(id); }}>
            <button className="rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft">Open</button>
          </form>
        </div>
        {row('Revenue this month', formatMoney(card.revenueMonthCents))}
        {row('Outstanding', formatMoney(card.outstandingCents))}
        {row('Overdue', card.overdueCents ? `${formatMoney(card.overdueCents)} (${card.overdueCount})` : '—', card.overdueCents ? 'text-danger' : undefined)}
        {row('Open leads', String(card.openLeads))}
        {row('Active jobs', String(card.activeJobs))}
        {row('Tasks today', String(card.tasksToday))}
        {row('Appointments today', String(card.appointmentsToday))}
      </div>
    </Card>
  );
}
