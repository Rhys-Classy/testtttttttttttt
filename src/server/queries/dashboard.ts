import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import {
  appointments, contacts, conversations, deals, invoices, jobs, leads, payments, pipelineStages, pipelines, quotes, tasks,
} from '@/db/schema';
import { addDaysKey, dayRange, monthRange, todayKey } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { contactName } from '@/server/services/crm';
import { sequential } from '@/db/sequential';
import { pgArray } from '@/db/sql';

export type AttentionItem = {
  id: string;
  kind: 'invoice_overdue' | 'payment_failed' | 'task_overdue' | 'reply_needed' | 'new_lead' | 'quote_followup' | 'job_tomorrow' | 'appointment_soon' | 'task_today';
  title: string;
  subtitle?: string;
  subAccountId: string;
  href: string;
  severity: 'urgent' | 'high' | 'normal';
  at?: Date | string | null;
  /** Inline one-click action. */
  action?: { type: 'complete_task' | 'call' | 'email' | 'send_reminder'; id: string; value?: string };
};

const sub = (col: unknown, ids: string[]) => sql`${col} = any(${pgArray(ids)})`;

/** NOW: everything that needs a human, most urgent first. */
export async function getAttention(tx: Tx, ids: string[], tz: string, now = new Date()): Promise<AttentionItem[]> {
  if (!ids.length) return [];
  const today = todayKey(tz, now);
  const { start: todayStart, end: todayEnd } = dayRange(today, tz);
  const tomorrow = dayRange(addDaysKey(today, 1), tz);
  const items: AttentionItem[] = [];

  const [overdue, failed, overdueTasks, replies, newLeads, staleQuotes, jobsTomorrow, apptsSoon] = await sequential([
    tx.select({ inv: invoices, c: contacts }).from(invoices)
      .leftJoin(contacts, and(eq(contacts.id, invoices.contactId), eq(contacts.subAccountId, invoices.subAccountId)))
      .where(and(sub(invoices.subAccountId, ids), eq(invoices.status, 'overdue'))).orderBy(asc(invoices.dueDate)).limit(10),
    tx.select({ p: payments, c: contacts }).from(payments)
      .leftJoin(contacts, and(eq(contacts.id, payments.contactId), eq(contacts.subAccountId, payments.subAccountId)))
      .where(and(sub(payments.subAccountId, ids), eq(payments.status, 'failed'), gte(payments.createdAt, new Date(now.getTime() - 7 * 86_400_000))))
      .orderBy(desc(payments.createdAt)).limit(5),
    tx.select().from(tasks).where(and(sub(tasks.subAccountId, ids), inArray(tasks.status, ['todo', 'in_progress']), lt(tasks.dueAt, todayStart)))
      .orderBy(asc(tasks.dueAt)).limit(10),
    tx.select({ conv: conversations, c: contacts }).from(conversations)
      .leftJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.subAccountId, conversations.subAccountId)))
      .where(and(sub(conversations.subAccountId, ids), eq(conversations.status, 'open'), eq(conversations.lastDirection, 'inbound')))
      .orderBy(asc(conversations.lastMessageAt)).limit(10),
    tx.select({ l: leads, c: contacts }).from(leads)
      .innerJoin(contacts, and(eq(contacts.id, leads.contactId), eq(contacts.subAccountId, leads.subAccountId)))
      .where(and(sub(leads.subAccountId, ids), eq(leads.status, 'new'))).orderBy(asc(leads.createdAt)).limit(10),
    tx.select({ q: quotes, c: contacts }).from(quotes)
      .leftJoin(contacts, and(eq(contacts.id, quotes.contactId), eq(contacts.subAccountId, quotes.subAccountId)))
      .where(and(sub(quotes.subAccountId, ids), inArray(quotes.status, ['sent', 'viewed']), lt(quotes.sentAt, new Date(now.getTime() - 3 * 86_400_000))))
      .orderBy(asc(quotes.sentAt)).limit(5),
    tx.select({ j: jobs, c: contacts }).from(jobs)
      .leftJoin(contacts, and(eq(contacts.id, jobs.contactId), eq(contacts.subAccountId, jobs.subAccountId)))
      .where(and(sub(jobs.subAccountId, ids), gte(jobs.scheduledStart, tomorrow.start), lt(jobs.scheduledStart, tomorrow.end), ne(jobs.status, 'cancelled'))).limit(5),
    tx.select({ a: appointments, c: contacts }).from(appointments)
      .leftJoin(contacts, and(eq(contacts.id, appointments.contactId), eq(contacts.subAccountId, appointments.subAccountId)))
      .where(and(sub(appointments.subAccountId, ids), gte(appointments.startsAt, now), lt(appointments.startsAt, new Date(now.getTime() + 2 * 3_600_000)), ne(appointments.status, 'cancelled'))).limit(5),
  ]);

  for (const { inv, c } of overdue) {
    items.push({
      id: `inv-${inv.id}`, kind: 'invoice_overdue', subAccountId: inv.subAccountId, href: `/invoices/${inv.id}`, severity: 'urgent', at: inv.dueDate,
      title: `Invoice ${inv.number} is overdue`, subtitle: `${c ? contactName(c) : 'Customer'} owes ${formatMoney(inv.totalCents - inv.amountPaidCents, inv.currency)}`,
      action: { type: 'send_reminder', id: inv.id },
    });
  }
  for (const { p, c } of failed) {
    items.push({ id: `pay-${p.id}`, kind: 'payment_failed', subAccountId: p.subAccountId, href: p.invoiceId ? `/invoices/${p.invoiceId}` : '/payments', severity: 'urgent', at: p.createdAt,
      title: `Payment failed: ${formatMoney(p.amountCents, p.currency)}`, subtitle: `${c ? contactName(c) : ''}${p.failureReason ? ` — ${p.failureReason}` : ''}` });
  }
  for (const { conv, c } of replies) {
    items.push({ id: `conv-${conv.id}`, kind: 'reply_needed', subAccountId: conv.subAccountId, href: `/inbox?c=${conv.id}`, severity: 'high', at: conv.lastMessageAt,
      title: `Reply to ${c ? contactName(c) : 'customer'}`, subtitle: conv.lastMessagePreview ?? undefined });
  }
  for (const t of overdueTasks) {
    items.push({ id: `task-${t.id}`, kind: 'task_overdue', subAccountId: t.subAccountId, href: `/tasks?t=${t.id}`, severity: t.priority === 'urgent' || t.priority === 'high' ? 'high' : 'normal', at: t.dueAt,
      title: t.title, subtitle: 'Overdue task', action: { type: 'complete_task', id: t.id } });
  }
  for (const { l, c } of newLeads) {
    items.push({ id: `lead-${l.id}`, kind: 'new_lead', subAccountId: l.subAccountId, href: `/contacts/${c.id}`, severity: 'high', at: l.createdAt,
      title: `Call ${contactName(c)}`, subtitle: `New lead from ${l.source}${l.notes ? ` — ${l.notes.slice(0, 80)}` : ''}`,
      action: c.phone ? { type: 'call', id: c.id, value: c.phone } : c.email ? { type: 'email', id: c.id, value: c.email } : undefined });
  }
  for (const { q, c } of staleQuotes) {
    items.push({ id: `quote-${q.id}`, kind: 'quote_followup', subAccountId: q.subAccountId, href: `/quotes/${q.id}`, severity: 'normal', at: q.sentAt,
      title: `Follow up quote ${q.number}`, subtitle: `${c ? contactName(c) : ''} — ${formatMoney(q.totalCents, q.currency)}${q.viewedAt ? ', viewed' : ', not opened yet'}` });
  }
  for (const { j, c } of jobsTomorrow) {
    items.push({ id: `job-${j.id}`, kind: 'job_tomorrow', subAccountId: j.subAccountId, href: `/jobs/${j.id}`, severity: 'normal', at: j.scheduledStart,
      title: `Job starts tomorrow: ${j.title}`, subtitle: c ? contactName(c) : undefined });
  }
  for (const { a, c } of apptsSoon) {
    items.push({ id: `appt-${a.id}`, kind: 'appointment_soon', subAccountId: a.subAccountId, href: `/calendar?d=${today}`, severity: 'high', at: a.startsAt,
      title: `Coming up: ${a.title}`, subtitle: c ? contactName(c) : a.location ?? undefined });
  }
  const rank = { urgent: 0, high: 1, normal: 2 };
  void todayEnd;
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || String(a.at ?? '').localeCompare(String(b.at ?? '')));
}

/** TODAY: tasks, appointments, jobs, follow-ups for today. */
export async function getToday(tx: Tx, ids: string[], tz: string, now = new Date()) {
  const today = todayKey(tz, now);
  const { start, end } = dayRange(today, tz);
  if (!ids.length) return { tasks: [], appointments: [], jobs: [], followUps: [] };
  const [t, a, j, f] = await sequential([
    tx.select({ task: tasks, c: contacts }).from(tasks)
      .leftJoin(contacts, and(eq(contacts.id, tasks.contactId), eq(contacts.subAccountId, tasks.subAccountId)))
      .where(and(sub(tasks.subAccountId, ids), or(
        and(inArray(tasks.status, ['todo', 'in_progress']), lt(tasks.dueAt, end)),
        and(eq(tasks.status, 'done'), gte(tasks.completedAt, start)),
      ))).orderBy(sql`${tasks.status} = 'done'`, sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`, asc(tasks.dueAt)).limit(50),
    tx.select({ appt: appointments, c: contacts }).from(appointments)
      .leftJoin(contacts, and(eq(contacts.id, appointments.contactId), eq(contacts.subAccountId, appointments.subAccountId)))
      .where(and(sub(appointments.subAccountId, ids), gte(appointments.startsAt, start), lt(appointments.startsAt, end), ne(appointments.status, 'cancelled')))
      .orderBy(asc(appointments.startsAt)),
    tx.select({ job: jobs, c: contacts }).from(jobs)
      .leftJoin(contacts, and(eq(contacts.id, jobs.contactId), eq(contacts.subAccountId, jobs.subAccountId)))
      .where(and(sub(jobs.subAccountId, ids), lt(jobs.scheduledStart, end), or(gte(jobs.scheduledEnd, start), and(isNull(jobs.scheduledEnd), gte(jobs.scheduledStart, start))), inArray(jobs.status, ['scheduled', 'in_progress', 'booked'])))
      .orderBy(asc(jobs.scheduledStart)),
    tx.select({ lead: leads, c: contacts }).from(leads)
      .innerJoin(contacts, and(eq(contacts.id, leads.contactId), eq(contacts.subAccountId, leads.subAccountId)))
      .where(and(sub(leads.subAccountId, ids), inArray(leads.status, ['contacted', 'qualified']), lt(leads.nextActionAt, end)))
      .orderBy(asc(leads.nextActionAt)).limit(20),
  ]);
  return { tasks: t, appointments: a, jobs: j, followUps: f };
}

export type MoneySummary = {
  paidTodayCents: number;
  thisMonthCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  upcomingCents: number;
  upcomingCount: number;
  currency: string;
};

/** MONEY: what came in, what's owed, what's late. */
export async function getMoney(tx: Tx, ids: string[], tz: string, now = new Date()): Promise<MoneySummary> {
  const today = todayKey(tz, now);
  const { start, end } = dayRange(today, tz);
  const month = monthRange(today, tz);
  const in7 = addDaysKey(today, 7);
  const empty = { paidTodayCents: 0, thisMonthCents: 0, outstandingCents: 0, overdueCents: 0, overdueCount: 0, upcomingCents: 0, upcomingCount: 0, currency: 'AUD' };
  if (!ids.length) return empty;
  const net = sql<number>`coalesce(sum(${payments.amountCents} - ${payments.refundedCents}), 0)`;
  const [[p], [inv]] = await sequential([
    tx.select({
      today: sql<number>`coalesce(sum(${payments.amountCents} - ${payments.refundedCents}) filter (where ${payments.paidAt} >= ${start} and ${payments.paidAt} < ${end}), 0)`,
      month: net,
    }).from(payments).where(and(sub(payments.subAccountId, ids), inArray(payments.status, ['succeeded', 'partially_refunded']), gte(payments.paidAt, month.start), lt(payments.paidAt, month.end))),
    tx.select({
      outstanding: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.amountPaidCents}) filter (where ${invoices.status} in ('sent','viewed','partially_paid','overdue')), 0)`,
      overdue: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.amountPaidCents}) filter (where ${invoices.status} = 'overdue'), 0)`,
      overdueCount: sql<number>`count(*) filter (where ${invoices.status} = 'overdue')`,
      upcoming: sql<number>`coalesce(sum(${invoices.totalCents} - ${invoices.amountPaidCents}) filter (where ${invoices.status} in ('sent','viewed','partially_paid') and ${invoices.dueDate} >= ${today} and ${invoices.dueDate} <= ${in7}), 0)`,
      upcomingCount: sql<number>`count(*) filter (where ${invoices.status} in ('sent','viewed','partially_paid') and ${invoices.dueDate} >= ${today} and ${invoices.dueDate} <= ${in7})`,
    }).from(invoices).where(sub(invoices.subAccountId, ids)),
  ]);
  return {
    paidTodayCents: Number(p?.today ?? 0), thisMonthCents: Number(p?.month ?? 0),
    outstandingCents: Number(inv?.outstanding ?? 0), overdueCents: Number(inv?.overdue ?? 0), overdueCount: Number(inv?.overdueCount ?? 0),
    upcomingCents: Number(inv?.upcoming ?? 0), upcomingCount: Number(inv?.upcomingCount ?? 0), currency: 'AUD',
  };
}

/** PIPELINE: stages of the default pipeline with deal counts + value (one business). */
export async function getPipelineSummary(tx: Tx, subAccountId: string) {
  const [pipeline] = await tx.select().from(pipelines).where(eq(pipelines.subAccountId, subAccountId))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.sortOrder)).limit(1);
  if (!pipeline) return null;
  const stages = await tx.select({
    id: pipelineStages.id, name: pipelineStages.name, kind: pipelineStages.kind,
    count: sql<number>`count(${deals.id})`, valueCents: sql<number>`coalesce(sum(${deals.valueCents}), 0)`,
  }).from(pipelineStages)
    .leftJoin(deals, and(eq(deals.stageId, pipelineStages.id), eq(deals.subAccountId, pipelineStages.subAccountId)))
    .where(and(eq(pipelineStages.subAccountId, subAccountId), eq(pipelineStages.pipelineId, pipeline.id)))
    .groupBy(pipelineStages.id).orderBy(asc(pipelineStages.sortOrder));
  return { pipeline, stages: stages.map((s) => ({ ...s, count: Number(s.count), valueCents: Number(s.valueCents) })) };
}

export type BusinessSummary = {
  subAccountId: string;
  revenueMonthCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdueCount: number;
  openLeads: number;
  activeJobs: number;
  tasksToday: number;
  appointmentsToday: number;
  openDealsValueCents: number;
};

/** One card per business for the All Businesses dashboard. */
export async function getBusinessSummaries(tx: Tx, ids: string[], tz: string, now = new Date()): Promise<BusinessSummary[]> {
  if (!ids.length) return [];
  const today = todayKey(tz, now);
  const { start, end } = dayRange(today, tz);
  const month = monthRange(today, tz);
  const res = await tx.execute<Record<string, number | string>>(sql`
    with ids as (select unnest(${pgArray(ids)}) as id)
    select ids.id as sub_account_id,
      (select coalesce(sum(amount_cents - refunded_cents), 0) from payments p where p.sub_account_id = ids.id and p.status in ('succeeded','partially_refunded') and p.paid_at >= ${month.start} and p.paid_at < ${month.end}) as revenue_month,
      (select coalesce(sum(total_cents - amount_paid_cents), 0) from invoices i where i.sub_account_id = ids.id and i.status in ('sent','viewed','partially_paid','overdue')) as outstanding,
      (select coalesce(sum(total_cents - amount_paid_cents), 0) from invoices i where i.sub_account_id = ids.id and i.status = 'overdue') as overdue,
      (select count(*) from invoices i where i.sub_account_id = ids.id and i.status = 'overdue') as overdue_count,
      (select count(*) from leads l where l.sub_account_id = ids.id and l.status in ('new','contacted','qualified')) as open_leads,
      (select count(*) from jobs j where j.sub_account_id = ids.id and j.status in ('booked','scheduled','in_progress','waiting')) as active_jobs,
      (select count(*) from tasks t where t.sub_account_id = ids.id and t.status in ('todo','in_progress') and t.due_at < ${end}) as tasks_today,
      (select count(*) from appointments a where a.sub_account_id = ids.id and a.status <> 'cancelled' and a.starts_at >= ${start} and a.starts_at < ${end}) as appointments_today,
      (select coalesce(sum(value_cents), 0) from deals d where d.sub_account_id = ids.id and d.status = 'open') as open_deals_value
    from ids`);
  return res.rows.map((r) => ({
    subAccountId: String(r.sub_account_id),
    revenueMonthCents: Number(r.revenue_month), outstandingCents: Number(r.outstanding), overdueCents: Number(r.overdue),
    overdueCount: Number(r.overdue_count), openLeads: Number(r.open_leads), activeJobs: Number(r.active_jobs),
    tasksToday: Number(r.tasks_today), appointmentsToday: Number(r.appointments_today), openDealsValueCents: Number(r.open_deals_value),
  }));
}

export async function getUpcomingAppointments(tx: Tx, ids: string[], now = new Date(), days = 7) {
  if (!ids.length) return [];
  return tx.select({ appt: appointments, c: contacts }).from(appointments)
    .leftJoin(contacts, and(eq(contacts.id, appointments.contactId), eq(contacts.subAccountId, appointments.subAccountId)))
    .where(and(sub(appointments.subAccountId, ids), gte(appointments.startsAt, now), lte(appointments.startsAt, new Date(now.getTime() + days * 86_400_000)), ne(appointments.status, 'cancelled')))
    .orderBy(asc(appointments.startsAt)).limit(20);
}
