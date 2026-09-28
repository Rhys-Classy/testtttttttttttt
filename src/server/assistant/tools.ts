import 'server-only';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { pgArray } from '@/db/sql';
import { activities, contacts, invoices, leads, messages } from '@/db/schema';
import { addDaysKey, dayRange, formatDate, formatDateTime, monthRange, todayKey, zonedTimeToUtc } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, inBusiness, readScope, type AppContext } from '@/server/context';
import { getAttention, getBusinessSummaries, getMoney, getToday } from '@/server/queries/dashboard';
import { globalSearch } from '@/server/queries/search';
import { getReport } from '@/server/queries/reports';
import { contactName } from '@/server/services/crm';
import { createInvoice, createQuote } from '@/server/services/finance';
import { createAppointment, createTask } from '@/server/services/work';
import { queueMessage } from '@/server/services/comms';
import { ValidationError } from '@/server/services/_common';

/**
 * The assistant never touches the database directly. It can only call these tools,
 * each of which runs as the logged-in user inside their current business scope,
 * so row level security applies exactly as it does in the UI.
 *
 *  - read tools run immediately
 *  - create_task runs immediately (low risk, easy to undo)
 *  - anything customer-facing or financial returns a PENDING action that the
 *    user must confirm in the UI before it runs
 */

export type PendingAction = { id: string; tool: WriteTool; input: Record<string, unknown>; summary: string; business: string };
type WriteTool = 'create_invoice_draft' | 'create_quote_draft' | 'book_appointment' | 'send_message';
export const CONFIRM_TOOLS: WriteTool[] = ['create_invoice_draft', 'create_quote_draft', 'book_appointment', 'send_message'];

const businessParam = { type: 'string', description: 'Business name (or id). Optional when one business is selected.' } as const;

export const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
  { name: 'get_attention', description: 'Everything that needs a human now: overdue invoices, failed payments, overdue tasks, unanswered messages, new leads, stale quotes, jobs tomorrow, appointments soon. Each item names its business.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_today', description: "Today's tasks, appointments, jobs and follow-ups across the businesses in scope.", input_schema: { type: 'object', properties: {} } },
  { name: 'get_money', description: 'Money summary: paid today, this month, outstanding, overdue, due in 7 days. Returns totals plus one row per business.', input_schema: { type: 'object', properties: { business: businessParam } } },
  {
    name: 'list_invoices', description: 'List invoices by status with customer, amount, balance and due date.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['overdue', 'outstanding', 'paid', 'draft', 'all'] }, business: businessParam, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
  },
  { name: 'search', description: 'Find contacts, companies, leads, deals, jobs, quotes, invoices, tasks or messages by name, number, email or phone.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'get_contact', description: 'Full picture of one contact: details, recent timeline, open invoices and the latest messages. Use to summarise a conversation.', input_schema: { type: 'object', properties: { contact_id: { type: 'string' } }, required: ['contact_id'] } },
  {
    name: 'list_leads', description: 'Leads, optionally only those not contacted for N days, from a source, or with a status.',
    input_schema: { type: 'object', properties: { not_contacted_days: { type: 'integer', minimum: 0 }, source: { type: 'string' }, status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'open'] }, business: businessParam } },
  },
  {
    name: 'get_report', description: 'Sales, revenue, marketing and customer numbers for a date range (YYYY-MM-DD, end exclusive). Defaults to this month.',
    input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, business: businessParam } },
  },
  {
    name: 'create_task', description: 'Create a task (runs immediately). due_date is YYYY-MM-DD in the business timezone; due_time HH:MM optional.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, due_date: { type: 'string' }, due_time: { type: 'string' }, contact_id: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, business: businessParam }, required: ['title'] },
  },
  {
    name: 'create_invoice_draft', description: 'Propose a DRAFT invoice. The user must confirm. amount_dollars is per the gst mode: "plus" = ex GST, "inc" = GST inclusive, "free" = GST free. Look up the contact_id with search first.',
    input_schema: { type: 'object', properties: { contact_id: { type: 'string' }, description: { type: 'string' }, amount_dollars: { type: 'number' }, gst: { type: 'string', enum: ['plus', 'inc', 'free'] } }, required: ['contact_id', 'description', 'amount_dollars', 'gst'] },
  },
  {
    name: 'create_quote_draft', description: 'Propose a DRAFT quote. The user must confirm. Same fields as create_invoice_draft.',
    input_schema: { type: 'object', properties: { contact_id: { type: 'string' }, description: { type: 'string' }, amount_dollars: { type: 'number' }, gst: { type: 'string', enum: ['plus', 'inc', 'free'] } }, required: ['contact_id', 'description', 'amount_dollars', 'gst'] },
  },
  {
    name: 'book_appointment', description: 'Propose an appointment. The user must confirm. start is local time YYYY-MM-DDTHH:MM in the business timezone.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, start: { type: 'string' }, duration_minutes: { type: 'integer', minimum: 5, maximum: 720 }, contact_id: { type: 'string' }, location: { type: 'string' }, business: businessParam }, required: ['title', 'start'] },
  },
  {
    name: 'send_message', description: 'Propose an email or SMS to a contact. The user must confirm before it is sent.',
    input_schema: { type: 'object', properties: { contact_id: { type: 'string' }, channel: { type: 'string', enum: ['email', 'sms'] }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['contact_id', 'channel', 'body'] },
  },
];

const uuid = z.string().uuid();
const schemas = {
  get_attention: z.object({}).passthrough(),
  get_today: z.object({}).passthrough(),
  get_money: z.object({ business: z.string().optional() }),
  list_invoices: z.object({ status: z.enum(['overdue', 'outstanding', 'paid', 'draft', 'all']).optional(), business: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }),
  search: z.object({ query: z.string().min(1) }),
  get_contact: z.object({ contact_id: uuid }),
  list_leads: z.object({ not_contacted_days: z.number().int().min(0).optional(), source: z.string().optional(), status: z.string().optional(), business: z.string().optional() }),
  get_report: z.object({ from: z.string().optional(), to: z.string().optional(), business: z.string().optional() }),
  create_task: z.object({ title: z.string().min(1), due_date: z.string().optional(), due_time: z.string().optional(), contact_id: uuid.optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), business: z.string().optional() }),
  create_invoice_draft: z.object({ contact_id: uuid, description: z.string().min(1), amount_dollars: z.number().positive(), gst: z.enum(['plus', 'inc', 'free']) }),
  create_quote_draft: z.object({ contact_id: uuid, description: z.string().min(1), amount_dollars: z.number().positive(), gst: z.enum(['plus', 'inc', 'free']) }),
  book_appointment: z.object({ title: z.string().min(1), start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/), duration_minutes: z.number().int().min(5).max(720).optional(), contact_id: uuid.optional(), location: z.string().optional(), business: z.string().optional() }),
  send_message: z.object({ contact_id: uuid, channel: z.enum(['email', 'sms']), subject: z.string().optional(), body: z.string().min(1) }),
} as const;

export type ToolName = keyof typeof schemas;

/** Resolve a business name/id to one the user can see in this context. */
function resolveBusiness(ctx: AppContext, ref: string | undefined, required = false) {
  if (!ref) {
    if (ctx.current) return ctx.current;
    if (required) throw new ValidationError('Which business? Ask the user to pick one.');
    return null;
  }
  const r = ref.toLowerCase().trim();
  const inScope = ctx.current ? [ctx.current] : ctx.businesses;
  const match = inScope.find((b) => b.id === ref || b.name.toLowerCase() === r || (b.shortName ?? '').toLowerCase() === r)
    ?? inScope.find((b) => b.name.toLowerCase().includes(r));
  if (!match) throw new ValidationError(`No business matching "${ref}" in the current view.`);
  return match;
}

const idsFor = (ctx: AppContext, business: string | undefined) => {
  const b = resolveBusiness(ctx, business);
  return b ? [b.id] : ctx.scopeIds;
};
const bizName = (ctx: AppContext, id: string) => businessById(ctx, id)?.name ?? 'Unknown business';
const money = (c: number) => formatMoney(c);

async function contactBusiness(ctx: AppContext, contactId: string) {
  const [c] = await readScope(ctx, (tx) => tx.select().from(contacts).where(eq(contacts.id, contactId)));
  if (!c) throw new ValidationError('Contact not found in the current view. Search for them first.');
  return c;
}

export async function runTool(ctx: AppContext, name: string, rawInput: unknown): Promise<{ result: unknown; pending?: PendingAction }> {
  if (!(name in schemas)) throw new ValidationError(`Unknown tool ${name}`);
  const tool = name as ToolName;
  const parsed = schemas[tool].safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = parsed.data as Record<string, any>;
  const tz = ctx.tz;

  switch (tool) {
    case 'get_attention': {
      const items = await readScope(ctx, (tx) => getAttention(tx, ctx.scopeIds, tz));
      return { result: items.slice(0, 30).map((i) => ({ business: bizName(ctx, i.subAccountId), severity: i.severity, title: i.title, detail: i.subtitle, link: i.href })) };
    }
    case 'get_today': {
      const t = await readScope(ctx, (tx) => getToday(tx, ctx.scopeIds, tz));
      return {
        result: {
          date: todayKey(tz),
          tasks: t.tasks.filter((x) => x.task.status !== 'done').map((x) => ({ business: bizName(ctx, x.task.subAccountId), title: x.task.title, due: x.task.dueAt ? formatDateTime(x.task.dueAt, tz) : null, priority: x.task.priority, contact: x.c ? contactName(x.c) : null })),
          appointments: t.appointments.map((x) => ({ business: bizName(ctx, x.appt.subAccountId), title: x.appt.title, starts: formatDateTime(x.appt.startsAt, tz), contact: x.c ? contactName(x.c) : null, location: x.appt.location })),
          jobs: t.jobs.map((x) => ({ business: bizName(ctx, x.job.subAccountId), job: `${x.job.number} ${x.job.title}`, status: x.job.status })),
          followUps: t.followUps.map((x) => ({ business: bizName(ctx, x.lead.subAccountId), contact: contactName(x.c), nextAction: x.lead.nextAction })),
        },
      };
    }
    case 'get_money': {
      const ids = idsFor(ctx, input.business);
      const [totals, per] = await readScope(ctx, async (tx) => [await getMoney(tx, ids, tz), await getBusinessSummaries(tx, ids, tz)] as const);
      return {
        result: {
          totals: { paidToday: money(totals.paidTodayCents), thisMonth: money(totals.thisMonthCents), outstanding: money(totals.outstandingCents), overdue: `${money(totals.overdueCents)} (${totals.overdueCount} invoices)`, dueNext7Days: money(totals.upcomingCents) },
          byBusiness: per.map((p) => ({ business: bizName(ctx, p.subAccountId), revenueThisMonth: money(p.revenueMonthCents), outstanding: money(p.outstandingCents), overdue: money(p.overdueCents), overdueCount: p.overdueCount })),
        },
      };
    }
    case 'list_invoices': {
      const ids = idsFor(ctx, input.business);
      const status = (input.status as string | undefined) ?? 'outstanding';
      const statuses = status === 'outstanding' ? ['sent', 'viewed', 'partially_paid', 'overdue'] : status === 'all' ? null : [status];
      const rows = await readScope(ctx, (tx) => tx.select({ inv: invoices, c: contacts }).from(invoices)
        .leftJoin(contacts, and(eq(contacts.id, invoices.contactId), eq(contacts.subAccountId, invoices.subAccountId)))
        .where(and(sql`${invoices.subAccountId} = any(${pgArray(ids)})`, statuses ? inArray(invoices.status, statuses as never[]) : undefined))
        .orderBy(asc(invoices.dueDate)).limit((input.limit as number | undefined) ?? 20));
      return { result: rows.map(({ inv, c }) => ({ business: bizName(ctx, inv.subAccountId), number: inv.number, customer: c ? contactName(c) : null, contact_id: inv.contactId, total: money(inv.totalCents), balance: money(inv.totalCents - inv.amountPaidCents), status: inv.status, due: inv.dueDate, link: `/invoices/${inv.id}` })) };
    }
    case 'search': {
      const hits = await readScope(ctx, (tx) => globalSearch(tx, ctx.scopeIds, input.query as string, 5));
      return { result: hits.map((h) => ({ business: bizName(ctx, h.subAccountId), type: h.type, id: h.id, title: h.title, detail: h.subtitle })) };
    }
    case 'get_contact': {
      const c = await contactBusiness(ctx, input.contact_id as string);
      const data = await readScope(ctx, async (tx) => ({
        timeline: await tx.select().from(activities).where(and(eq(activities.subAccountId, c.subAccountId), eq(activities.contactId, c.id))).orderBy(desc(activities.createdAt)).limit(15),
        invoices: await tx.select().from(invoices).where(and(eq(invoices.subAccountId, c.subAccountId), eq(invoices.contactId, c.id))).orderBy(desc(invoices.createdAt)).limit(10),
        messages: await tx.select().from(messages).where(and(eq(messages.subAccountId, c.subAccountId), eq(messages.contactId, c.id), eq(messages.isInternalNote, false))).orderBy(desc(messages.createdAt)).limit(20),
      }));
      return {
        result: {
          business: bizName(ctx, c.subAccountId), name: contactName(c), email: c.email, phone: c.phone, status: c.status, source: c.source, tags: c.tags, customFields: c.customFields,
          lastContacted: c.lastContactedAt ? formatDateTime(c.lastContactedAt, tz) : null,
          timeline: data.timeline.map((a) => `${formatDate(a.createdAt, tz)}: ${a.summary}`),
          invoices: data.invoices.map((i) => ({ number: i.number, total: money(i.totalCents), balance: money(i.totalCents - i.amountPaidCents), status: i.status })),
          messages: data.messages.reverse().map((m) => ({ at: formatDateTime(m.createdAt, tz), direction: m.direction, channel: m.channel, text: m.body.slice(0, 600) })),
        },
      };
    }
    case 'list_leads': {
      const ids = idsFor(ctx, input.business);
      const conds = [sql`${leads.subAccountId} = any(${pgArray(ids)})`];
      const status = input.status as string | undefined;
      if (status === 'open' || !status) conds.push(inArray(leads.status, ['new', 'contacted', 'qualified']));
      else conds.push(eq(leads.status, status as never));
      if (input.source) conds.push(eq(leads.source, String(input.source).toLowerCase() as never));
      if (input.not_contacted_days !== undefined) {
        const cutoff = new Date(Date.now() - (input.not_contacted_days as number) * 86_400_000);
        conds.push(or(lt(contacts.lastContactedAt, cutoff), and(isNull(contacts.lastContactedAt), lt(leads.createdAt, cutoff)))!);
      }
      const rows = await readScope(ctx, (tx) => tx.select({ l: leads, c: contacts }).from(leads)
        .innerJoin(contacts, and(eq(contacts.id, leads.contactId), eq(contacts.subAccountId, leads.subAccountId)))
        .where(and(...conds)).orderBy(asc(leads.createdAt)).limit(30));
      return { result: rows.map(({ l, c }) => ({ business: bizName(ctx, l.subAccountId), contact: contactName(c), contact_id: c.id, phone: c.phone, email: c.email, source: l.source, status: l.status, created: formatDate(l.createdAt, tz), lastContacted: c.lastContactedAt ? formatDate(c.lastContactedAt, tz) : 'never', notes: l.notes })) };
    }
    case 'get_report': {
      const ids = idsFor(ctx, input.business);
      const month = monthRange(todayKey(tz), tz);
      const from = input.from ? dayRange(input.from as string, tz).start : month.start;
      const to = input.to ? dayRange(input.to as string, tz).start : month.end;
      const r = await readScope(ctx, (tx) => getReport(tx, ids, { from, to }, tz));
      return { result: { scope: ids.map((id) => bizName(ctx, id)), from: from.toISOString(), to: to.toISOString(), ...r } };
    }
    case 'create_task': {
      const b = input.contact_id ? businessById(ctx, (await contactBusiness(ctx, input.contact_id as string)).subAccountId) : resolveBusiness(ctx, input.business as string | undefined, true)!;
      const dueKey = (input.due_date as string | undefined) ?? todayKey(b!.timezone);
      const [y, m, d] = dueKey.split('-').map(Number);
      const [hh, mm] = ((input.due_time as string | undefined) ?? '09:00').split(':').map(Number);
      const task = await inBusiness(ctx, b!.id, (tx, s) => createTask(tx, s, {
        title: input.title as string, dueAt: zonedTimeToUtc(y, m, d, hh, mm || 0, b!.timezone), allDay: !input.due_time,
        contactId: (input.contact_id as string | undefined) ?? null, priority: (input.priority as never) ?? 'normal', source: 'assistant',
      }));
      return { result: { created: true, business: b!.name, task: task.title, due: dueKey } };
    }
    case 'create_invoice_draft':
    case 'create_quote_draft':
    case 'send_message': {
      const c = await contactBusiness(ctx, input.contact_id as string);
      const b = businessById(ctx, c.subAccountId)!;
      const summary = tool === 'send_message'
        ? `Send ${input.channel === 'sms' ? 'SMS' : 'email'} to ${contactName(c)}: "${String(input.body).slice(0, 120)}"`
        : `Draft ${tool === 'create_invoice_draft' ? 'invoice' : 'quote'} for ${contactName(c)}: ${money(Math.round((input.amount_dollars as number) * 100))}${input.gst === 'plus' ? ' + GST' : input.gst === 'inc' ? ' inc GST' : ' GST free'} — ${input.description}`;
      const pending: PendingAction = { id: crypto.randomUUID(), tool, input, summary, business: b.name };
      return { result: { status: 'awaiting_user_confirmation', summary, business: b.name }, pending };
    }
    case 'book_appointment': {
      const b = input.contact_id ? businessById(ctx, (await contactBusiness(ctx, input.contact_id as string)).subAccountId)! : resolveBusiness(ctx, input.business as string | undefined, true)!;
      const summary = `Book "${input.title}" on ${String(input.start).replace('T', ' at ')} (${input.duration_minutes ?? 60} min)`;
      const pending: PendingAction = { id: crypto.randomUUID(), tool, input: { ...input, business: b.id }, summary, business: b.name };
      return { result: { status: 'awaiting_user_confirmation', summary, business: b.name }, pending };
    }
  }
}

/** Runs a confirmed action. Re-validated here; the browser can't make it do anything the user couldn't do directly. */
export async function executeConfirmedAction(ctx: AppContext, tool: WriteTool, rawInput: unknown): Promise<{ message: string; href?: string }> {
  const parsed = schemas[tool].safeParse(rawInput);
  if (!parsed.success) throw new ValidationError('That action is no longer valid.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input = parsed.data as Record<string, any>;
  switch (tool) {
    case 'create_invoice_draft':
    case 'create_quote_draft': {
      const c = await contactBusiness(ctx, input.contact_id);
      const line = { description: input.description as string, quantity: 1, unitPriceCents: Math.round((input.amount_dollars as number) * 100), taxCode: input.gst === 'free' ? 'GST_FREE' : 'GST' };
      const pricesIncludeTax = input.gst === 'inc';
      if (tool === 'create_invoice_draft') {
        const inv = await inBusiness(ctx, c.subAccountId, (tx, s) => createInvoice(tx, s, { contactId: c.id, lines: [line], pricesIncludeTax }));
        return { message: `Draft invoice ${inv.number} created (${money(inv.totalCents)}).`, href: `/invoices/${inv.id}` };
      }
      const q = await inBusiness(ctx, c.subAccountId, (tx, s) => createQuote(tx, s, { contactId: c.id, lines: [line], pricesIncludeTax }));
      return { message: `Draft quote ${q.number} created (${money(q.totalCents)}).`, href: `/quotes/${q.id}` };
    }
    case 'book_appointment': {
      const b = input.contact_id ? businessById(ctx, (await contactBusiness(ctx, input.contact_id)).subAccountId)! : resolveBusiness(ctx, input.business, true)!;
      const [date, time] = String(input.start).split('T');
      const [y, m, d] = date.split('-').map(Number);
      const [hh, mm] = time.split(':').map(Number);
      await inBusiness(ctx, b.id, (tx, s) => createAppointment(tx, s, {
        title: input.title as string, startsAt: zonedTimeToUtc(y, m, d, hh, mm, b.timezone), durationMinutes: (input.duration_minutes as number | undefined) ?? 60,
        contactId: (input.contact_id as string | undefined) ?? null, location: (input.location as string | undefined) ?? null,
      }));
      return { message: `Booked in ${b.name}.`, href: `/calendar?d=${date}` };
    }
    case 'send_message': {
      const c = await contactBusiness(ctx, input.contact_id);
      await inBusiness(ctx, c.subAccountId, (tx, s) => queueMessage(tx, s, { contactId: c.id, channel: input.channel, subject: (input.subject as string | undefined) ?? null, body: input.body as string }));
      return { message: `${input.channel === 'sms' ? 'SMS' : 'Email'} queued to ${contactName(c)}.`, href: `/contacts/${c.id}` };
    }
  }
}

export function dateContext(ctx: AppContext) {
  const today = todayKey(ctx.tz);
  return { today, tomorrow: addDaysKey(today, 1), weekday: new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: ctx.tz }).format(new Date()) };
}


