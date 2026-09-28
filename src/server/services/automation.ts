import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { appointments, contacts, deals, events, invoices, messages, quotes, workflowRuns, workflows } from '@/db/schema';
import type { Condition, Step, Trigger, WorkflowDefinition } from '@/lib/automation/types';
import { addDaysKey, formatDateTime, todayKey, zonedTimeToUtc } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { renderTemplate } from '@/lib/template';
import { Scope, ValidationError, byTenant, emit, getBusiness, must, type Business } from './_common';
import { addTags, contactName, getContact, moveDealToStageNamed, removeTags, updateContact } from './crm';
import { queueMessage } from './comms';
import { notify } from './notifications';

export type Workflow = typeof workflows.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
type EventRow = typeof events.$inferSelect;
type Cursor = (number | string)[];

const MAX_STEPS_PER_ADVANCE = 50;

/* ------------------------------------------------------------------ */
/* Workflow CRUD                                                       */
/* ------------------------------------------------------------------ */

export async function saveWorkflow(tx: Tx, scope: Scope, input: { id?: string; name: string; description?: string | null } & WorkflowDefinition) {
  validateSteps(input.steps);
  const values = {
    name: input.name.trim() || 'Untitled automation',
    description: input.description ?? null,
    trigger: input.trigger as unknown as Record<string, unknown>,
    steps: input.steps as unknown[],
    settings: input.settings,
    updatedAt: new Date(),
  };
  if (input.id) {
    const [row] = await tx.update(workflows).set(values).where(byTenant(workflows, scope, input.id)).returning();
    return must(row, 'Automation');
  }
  const [row] = await tx.insert(workflows).values({ ...values, subAccountId: scope.subAccountId }).returning();
  return row;
}

export async function setWorkflowStatus(tx: Tx, scope: Scope, id: string, status: Workflow['status']) {
  const [row] = await tx.update(workflows).set({ status, updatedAt: new Date() }).where(byTenant(workflows, scope, id)).returning();
  return must(row, 'Automation');
}

function validateSteps(steps: Step[], depth = 0) {
  if (depth > 10) throw new ValidationError('Branches are nested too deeply.');
  for (const s of steps) {
    if (s.type === 'wait' && !(s.config.amount > 0)) throw new ValidationError('Wait steps need a positive duration.');
    if ((s.type === 'webhook' || s.type === 'http_request') && !/^https?:\/\//i.test(s.config.url)) throw new ValidationError('Webhook URL must start with http(s)://');
    if (s.type === 'condition') {
      validateSteps(s.yes ?? [], depth + 1);
      validateSteps(s.no ?? [], depth + 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Trigger matching                                                    */
/* ------------------------------------------------------------------ */

export function triggerMatches(trigger: Trigger, event: Pick<EventRow, 'type' | 'payload'>): boolean {
  if (trigger.type !== event.type) return false;
  const c = trigger.config ?? {};
  const p = event.payload as Record<string, unknown>;
  if (c.source && p.source && String(p.source).toLowerCase() !== c.source.toLowerCase()) return false;
  if (c.source && !p.source && (event.type === 'lead.created' || event.type === 'contact.created')) return false;
  if (c.tag && String(p.tag ?? '').toLowerCase() !== c.tag.toLowerCase()) return false;
  if (c.formId && p.formId !== c.formId) return false;
  if (c.stageId && p.toStageId !== c.stageId) return false;
  if (c.stageName && String(p.stageName ?? '').toLowerCase() !== c.stageName.toLowerCase()) return false;
  if (c.channel && p.channel !== c.channel) return false;
  if (c.jobStatus && p.to !== c.jobStatus) return false;
  return true;
}

/** Worker entry point for one outbox event (already claimed, running pinned to its business). */
export async function processEvent(tx: Tx, scope: Scope, seq: number) {
  const [event] = await tx.select().from(events).where(and(eq(events.subAccountId, scope.subAccountId), eq(events.seq, seq)));
  if (!event || event.processedAt) return { started: 0 };

  // Stop-on-reply: a reply ends nurture sequences for that contact.
  if (event.type === 'message.received' && event.contactId) {
    await tx.execute(sql`
      update workflow_runs r set status = 'stopped', finished_at = now(), next_run_at = null
      from workflows w
      where r.workflow_id = w.id and r.sub_account_id = ${scope.subAccountId} and w.sub_account_id = r.sub_account_id
        and r.contact_id = ${event.contactId} and r.status in ('running', 'waiting')
        and coalesce((w.settings ->> 'stopOnReply')::boolean, false)
        and w.trigger ->> 'type' <> 'message.received'`);
  }

  const candidates = await tx.select().from(workflows).where(and(
    eq(workflows.subAccountId, scope.subAccountId), eq(workflows.status, 'active'),
    sql`${workflows.trigger} ->> 'type' = ${event.type}`,
  ));
  let started = 0;
  for (const wf of candidates) {
    if (!triggerMatches(wf.trigger as unknown as Trigger, event)) continue;
    const run = await startRun(tx, scope, wf, {
      contactId: event.contactId,
      event: { type: event.type, entityType: event.entityType, entityId: event.entityId, payload: event.payload },
    });
    if (run) started++;
  }
  await tx.update(events).set({ processedAt: new Date(), error: null }).where(and(eq(events.subAccountId, scope.subAccountId), eq(events.seq, seq)));
  return { started };
}

export async function startRun(tx: Tx, scope: Scope, wf: Workflow, input: { contactId: string | null; event: Record<string, unknown> }) {
  const settings = wf.settings ?? {};
  if (input.contactId && !settings.allowReentry) {
    const [active] = await tx.select({ id: workflowRuns.id }).from(workflowRuns).where(and(
      eq(workflowRuns.subAccountId, scope.subAccountId), eq(workflowRuns.workflowId, wf.id),
      eq(workflowRuns.contactId, input.contactId), inArray(workflowRuns.status, ['running', 'waiting']),
    )).limit(1);
    if (active) return null;
  }
  const [run] = await tx.insert(workflowRuns).values({
    subAccountId: scope.subAccountId,
    workflowId: wf.id,
    contactId: input.contactId,
    status: 'running',
    context: { event: input.event },
    cursor: [0],
    nextRunAt: new Date(),
  }).returning();
  await tx.update(workflows).set({ runCount: sql`${workflows.runCount} + 1`, lastRunAt: new Date() }).where(byTenant(workflows, scope, wf.id));
  return run;
}

export async function startManualRun(tx: Tx, scope: Scope, workflowId: string, contactId: string | null) {
  const [wf] = await tx.select().from(workflows).where(byTenant(workflows, scope, workflowId));
  must(wf, 'Automation');
  const run = await startRun(tx, scope, { ...wf, settings: { ...wf.settings, allowReentry: true } }, { contactId, event: { type: 'manual', payload: {} } });
  return run;
}

/** Fire date/time-triggered automations whose slot has passed since their last run. */
export async function runScheduledTriggers(tx: Tx, scope: Scope, now = new Date()) {
  const b = await getBusiness(tx, scope.subAccountId);
  const wfs = await tx.select().from(workflows).where(and(
    eq(workflows.subAccountId, scope.subAccountId), eq(workflows.status, 'active'), sql`${workflows.trigger} ->> 'type' = 'schedule'`,
  ));
  let started = 0;
  for (const wf of wfs) {
    const c = (wf.trigger as unknown as Trigger).config ?? {};
    const [hh, mm] = (c.at ?? '09:00').split(':').map(Number);
    const today = todayKey(b.timezone, now);
    const [y, m, d] = today.split('-').map(Number);
    const slot = zonedTimeToUtc(y, m, d, hh || 0, mm || 0, b.timezone);
    const dow = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1; // 1 = Monday
    if (c.every === 'weekday' && dow > 5) continue;
    if (c.every === 'week' && dow !== (c.weekday ?? 1)) continue;
    if (now < slot) continue;
    if (wf.lastRunAt && wf.lastRunAt >= slot) continue;
    await startRun(tx, scope, wf, { contactId: null, event: { type: 'schedule', payload: { slot: slot.toISOString() } } });
    started++;
  }
  return started;
}

/* ------------------------------------------------------------------ */
/* Cursor helpers                                                      */
/* ------------------------------------------------------------------ */

export function stepAt(steps: Step[], cursor: Cursor): Step | undefined {
  let list: Step[] = steps;
  let step: Step | undefined;
  for (const part of cursor) {
    if (typeof part === 'number') {
      step = list[part];
      if (!step) return undefined;
    } else {
      if (!step || step.type !== 'condition') return undefined;
      list = (part === 'yes' ? step.yes : step.no) ?? [];
    }
  }
  return step;
}

/** Walk up out of finished branches until we land on a real step, or null at the end. */
export function normalizeCursor(steps: Step[], cursor: Cursor): Cursor | null {
  const c = [...cursor];
  while (!stepAt(steps, c)) {
    if (c.length <= 1) return null;
    c.splice(-2);
    (c[c.length - 1] as number)++;
  }
  return c;
}

export function advanceCursor(steps: Step[], cursor: Cursor): Cursor | null {
  const c = [...cursor];
  (c[c.length - 1] as number)++;
  return normalizeCursor(steps, c);
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

type RunData = {
  business: Business;
  contact: typeof contacts.$inferSelect | null;
  invoice: typeof invoices.$inferSelect | null;
  deal: typeof deals.$inferSelect | null;
  appointment: typeof appointments.$inferSelect | null;
  quote: typeof quotes.$inferSelect | null;
  event: { type?: string; entityType?: string; entityId?: string; payload?: Record<string, unknown> };
};

async function loadRunData(tx: Tx, scope: Scope, run: WorkflowRun): Promise<RunData> {
  const business = await getBusiness(tx, scope.subAccountId);
  const event = ((run.context as Record<string, unknown>).event ?? {}) as RunData['event'];
  const contact = run.contactId ? (await tx.select().from(contacts).where(byTenant(contacts, scope, run.contactId)))[0] ?? null : null;
  const load = async <T>(entityType: string, fn: (id: string) => Promise<T | undefined>) =>
    event.entityType === entityType && event.entityId ? (await fn(event.entityId)) ?? null : null;
  const invoice = await load('invoice', async (id) => (await tx.select().from(invoices).where(byTenant(invoices, scope, id)))[0]);
  let deal = await load('deal', async (id) => (await tx.select().from(deals).where(byTenant(deals, scope, id)))[0]);
  if (!deal && contact) {
    deal = (await tx.select().from(deals).where(and(eq(deals.subAccountId, scope.subAccountId), eq(deals.contactId, contact.id), eq(deals.status, 'open')))
      .orderBy(sql`${deals.updatedAt} desc`).limit(1))[0] ?? null;
  }
  const appointment = await load('appointment', async (id) => (await tx.select().from(appointments).where(byTenant(appointments, scope, id)))[0]);
  const quote = await load('quote', async (id) => (await tx.select().from(quotes).where(byTenant(quotes, scope, id)))[0]);
  return { business, contact, invoice, deal, appointment, quote, event };
}

function templateVars(d: RunData) {
  const b = d.business;
  return {
    contact: d.contact ? {
      first_name: d.contact.firstName, last_name: d.contact.lastName, name: contactName(d.contact), email: d.contact.email, phone: d.contact.phone,
    } : {},
    business: { name: b.tradingName ?? b.name, phone: b.phone, email: b.email, website: b.website },
    invoice: d.invoice ? {
      number: d.invoice.number, total: formatMoney(d.invoice.totalCents, d.invoice.currency),
      balance: formatMoney(d.invoice.totalCents - d.invoice.amountPaidCents, d.invoice.currency), due_date: d.invoice.dueDate,
      link: `${process.env.APP_URL ?? ''}/i/${d.invoice.publicToken}`,
    } : {},
    appointment: d.appointment ? { title: d.appointment.title, when: formatDateTime(d.appointment.startsAt, b.timezone) } : {},
    quote: d.quote ? { number: d.quote.number, total: formatMoney(d.quote.totalCents, d.quote.currency), link: `${process.env.APP_URL ?? ''}/q/${d.quote.publicToken}` } : {},
    deal: d.deal ? { title: d.deal.title, value: formatMoney(d.deal.valueCents, b.currency) } : {},
  };
}

async function fieldValue(tx: Tx, scope: Scope, run: WorkflowRun, d: RunData, field: string): Promise<unknown> {
  switch (field) {
    case 'contact.tags': return d.contact?.tags ?? [];
    case 'contact.source': return d.contact?.source;
    case 'contact.status': return d.contact?.status;
    case 'contact.email': return d.contact?.email;
    case 'contact.phone': return d.contact?.phone;
    case 'invoice.total': return d.invoice ? d.invoice.totalCents / 100 : undefined;
    case 'invoice.status': {
      if (!d.invoice) return undefined;
      const [i] = await tx.select({ status: invoices.status }).from(invoices).where(byTenant(invoices, scope, d.invoice.id));
      return i?.status;
    }
    case 'deal.value': return d.deal ? d.deal.valueCents / 100 : undefined;
    case 'appointment.status': return d.appointment?.status;
    case 'quote.status': {
      if (!d.quote) return undefined;
      // Re-read: the quote may have been accepted while the run was waiting.
      const [q] = await tx.select({ status: quotes.status }).from(quotes).where(byTenant(quotes, scope, d.quote.id));
      return q?.status;
    }
    case 'event.amount': {
      const p = d.event.payload ?? {};
      const cents = (p.amountCents ?? p.totalCents ?? p.valueCents ?? p.balanceCents) as number | undefined;
      return cents !== undefined ? cents / 100 : undefined;
    }
    case 'contact.replied': {
      if (!run.contactId) return 'no';
      const [m] = await tx.select({ id: messages.id }).from(messages).where(and(
        eq(messages.subAccountId, scope.subAccountId), eq(messages.contactId, run.contactId), eq(messages.direction, 'inbound'), gt(messages.createdAt, run.startedAt),
      )).limit(1);
      return m ? 'yes' : 'no';
    }
    default:
      if (field.startsWith('custom.')) return d.contact?.customFields?.[field.slice(7)];
      return undefined;
  }
}

export function evaluateCondition(value: unknown, c: Condition): boolean {
  const cmp = c.value;
  switch (c.op) {
    case 'has_tag': return Array.isArray(value) && value.some((t) => String(t).toLowerCase() === String(cmp ?? '').toLowerCase());
    case 'not_has_tag': return !(Array.isArray(value) && value.some((t) => String(t).toLowerCase() === String(cmp ?? '').toLowerCase()));
    case 'is_set': return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
    case 'not_set': return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
    case 'contains': return String(value ?? '').toLowerCase().includes(String(cmp ?? '').toLowerCase());
    case 'eq': return String(value ?? '').toLowerCase() === String(cmp ?? '').toLowerCase();
    case 'neq': return String(value ?? '').toLowerCase() !== String(cmp ?? '').toLowerCase();
    case 'gt': return Number(value) > Number(cmp);
    case 'gte': return Number(value) >= Number(cmp);
    case 'lt': return Number(value) < Number(cmp);
    case 'lte': return Number(value) <= Number(cmp);
  }
}

const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|metadata\.google\.internal)/i;

async function safeFetch(url: string, init: RequestInit) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol) || BLOCKED_HOSTS.test(u.hostname)) throw new Error('That URL is not allowed from automations.');
  const res = await fetch(u, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

type StepOutcome = { kind: 'next' } | { kind: 'wait'; until: Date } | { kind: 'branch'; branch: 'yes' | 'no' } | { kind: 'stop' };

async function executeStep(tx: Tx, scope: Scope, run: WorkflowRun, step: Step, d: RunData, now: Date): Promise<StepOutcome> {
  const vars = templateVars(d);
  const needContact = () => {
    if (!d.contact) throw new Error('This step needs a contact but the automation has none.');
    return d.contact;
  };
  switch (step.type) {
    case 'wait': {
      const mult = step.config.unit === 'minutes' ? 60_000 : step.config.unit === 'hours' ? 3_600_000 : 86_400_000;
      return { kind: 'wait', until: new Date(now.getTime() + step.config.amount * mult) };
    }
    case 'send_email': {
      const c = needContact();
      if (!c.email) throw new Error(`${contactName(c)} has no email address.`);
      await queueMessage(tx, scope, { contactId: c.id, channel: 'email', subject: renderTemplate(step.config.subject, vars), body: renderTemplate(step.config.body, vars), workflowRunId: run.id });
      return { kind: 'next' };
    }
    case 'send_sms': {
      const c = needContact();
      if (!c.phone) throw new Error(`${contactName(c)} has no mobile number.`);
      await queueMessage(tx, scope, { contactId: c.id, channel: 'sms', body: renderTemplate(step.config.body, vars), workflowRunId: run.id });
      return { kind: 'next' };
    }
    case 'create_task': {
      const { createTask } = await import('./work');
      const dueKey = addDaysKey(todayKey(d.business.timezone, now), step.config.dueInDays ?? 0);
      const [y, m, dd] = dueKey.split('-').map(Number);
      await createTask(tx, scope, {
        title: renderTemplate(step.config.title, vars),
        priority: step.config.priority ?? 'normal',
        dueAt: zonedTimeToUtc(y, m, dd, 9, 0, d.business.timezone),
        contactId: d.contact?.id ?? null,
        dealId: d.deal?.id ?? null,
        invoiceId: d.invoice?.id ?? null,
        source: 'automation',
      });
      return { kind: 'next' };
    }
    case 'add_tag': d.contact = await addTags(tx, scope, needContact().id, [step.config.tag]); return { kind: 'next' };
    case 'remove_tag': d.contact = await removeTags(tx, scope, needContact().id, [step.config.tag]); return { kind: 'next' };
    case 'update_field': {
      const c = needContact();
      const value = renderTemplate(step.config.value, vars);
      const f = step.config.field;
      if (f.startsWith('custom.')) d.contact = await updateContact(tx, scope, c.id, { customFields: { [f.slice(7)]: value } });
      else if (f === 'status') d.contact = await updateContact(tx, scope, c.id, { status: value as 'lead' | 'customer' | 'inactive' });
      else if (f === 'source') d.contact = await updateContact(tx, scope, c.id, { source: value as never });
      else if (f === 'lead_score') await tx.update(contacts).set({ leadScore: Number(value) || 0 }).where(byTenant(contacts, scope, c.id));
      else throw new Error(`Unknown field ${f}`);
      return { kind: 'next' };
    }
    case 'move_deal': {
      if (!d.deal) throw new Error('No open deal for this contact.');
      d.deal = await moveDealToStageNamed(tx, scope, d.deal.id, step.config.stageName);
      return { kind: 'next' };
    }
    case 'create_invoice': {
      const c = needContact();
      const { createInvoice, sendInvoice } = await import('./finance');
      const inv = await createInvoice(tx, scope, { contactId: c.id, dealId: d.deal?.id, lines: [{ description: renderTemplate(step.config.description, vars), quantity: 1, unitPriceCents: step.config.amountCents, taxCode: step.config.taxCode }] });
      if (step.config.send) await sendInvoice(tx, scope, inv.id);
      d.invoice = inv;
      return { kind: 'next' };
    }
    case 'create_quote': {
      const c = needContact();
      const { createQuote, sendQuote } = await import('./finance');
      const q = await createQuote(tx, scope, { contactId: c.id, dealId: d.deal?.id, lines: [{ description: renderTemplate(step.config.description, vars), quantity: 1, unitPriceCents: step.config.amountCents, taxCode: step.config.taxCode }] });
      if (step.config.send) await sendQuote(tx, scope, q.id);
      return { kind: 'next' };
    }
    case 'create_appointment': {
      const { createAppointment } = await import('./work');
      const key = addDaysKey(todayKey(d.business.timezone, now), step.config.inDays);
      const [y, m, dd] = key.split('-').map(Number);
      await createAppointment(tx, scope, {
        title: renderTemplate(step.config.title, vars),
        startsAt: zonedTimeToUtc(y, m, dd, step.config.hour, 0, d.business.timezone),
        durationMinutes: step.config.durationMinutes ?? 60,
        contactId: d.contact?.id ?? null,
        dealId: d.deal?.id ?? null,
      });
      return { kind: 'next' };
    }
    case 'notify':
      await notify(tx, scope, { type: 'automation', title: renderTemplate(step.config.title, vars), body: step.config.body ? renderTemplate(step.config.body, vars) : undefined, link: d.contact ? `/contacts/${d.contact.id}` : undefined });
      return { kind: 'next' };
    case 'webhook':
      await safeFetch(step.config.url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflowRunId: run.id, event: d.event, contact: d.contact ? { id: d.contact.id, ...vars.contact } : null, business: vars.business }),
      });
      return { kind: 'next' };
    case 'http_request':
      await safeFetch(renderTemplate(step.config.url, vars), {
        method: step.config.method, headers: { 'content-type': 'application/json', ...(step.config.headers ?? {}) },
        body: step.config.method === 'GET' || step.config.method === 'DELETE' ? undefined : renderTemplate(step.config.body ?? '', vars),
      });
      return { kind: 'next' };
    case 'condition': {
      const results: boolean[] = [];
      for (const c of step.config.conditions) results.push(evaluateCondition(await fieldValue(tx, scope, run, d, c.field), c));
      const ok = step.config.match === 'any' ? results.some(Boolean) : results.every(Boolean);
      return { kind: 'branch', branch: ok ? 'yes' : 'no' };
    }
    case 'stop':
      return { kind: 'stop' };
  }
}

/** Execute a run from its cursor until it waits, finishes or fails. */
export async function advanceRun(tx: Tx, scope: Scope, runId: string, now = new Date()) {
  const [run] = await tx.select().from(workflowRuns).where(byTenant(workflowRuns, scope, runId));
  if (!run || !['running', 'waiting'].includes(run.status)) return run;
  const [wf] = await tx.select().from(workflows).where(byTenant(workflows, scope, run.workflowId));
  if (!wf || wf.status !== 'active') {
    const [r] = await tx.update(workflowRuns).set({ status: 'stopped', finishedAt: now, nextRunAt: null, lockedUntil: null })
      .where(byTenant(workflowRuns, scope, runId)).returning();
    return r;
  }
  const steps = (wf.steps ?? []) as Step[];
  const data = await loadRunData(tx, scope, run);
  const log = [...(run.log ?? [])];
  let cursor: Cursor | null = normalizeCursor(steps, run.cursor);
  let status: WorkflowRun['status'] = 'running';
  let nextRunAt: Date | null = null;
  let error: string | null = null;

  for (let i = 0; cursor && i < MAX_STEPS_PER_ADVANCE; i++) {
    const step = stepAt(steps, cursor)!;
    try {
      const outcome = await executeStep(tx, scope, run, step, data, now);
      log.push({ at: now.toISOString(), stepId: step.id, type: step.type, ok: true, message: outcome.kind === 'branch' ? outcome.branch : undefined });
      if (outcome.kind === 'stop') { cursor = null; status = 'stopped'; break; }
      if (outcome.kind === 'branch') { cursor = normalizeCursor(steps, [...cursor, outcome.branch, 0]) ?? null; continue; }
      cursor = advanceCursor(steps, cursor);
      if (outcome.kind === 'wait') {
        if (cursor) { status = 'waiting'; nextRunAt = outcome.until; }
        break;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.push({ at: now.toISOString(), stepId: step.id, type: step.type, ok: false, message });
      status = 'failed';
      error = message;
      await notify(tx, scope, { type: 'automation.error', severity: 'warning', title: `Automation "${wf.name}" failed`, body: message, link: `/automations/${wf.id}` });
      await emit(tx, scope, 'automation.error', { entityType: 'workflow', entityId: wf.id, contactId: run.contactId, payload: { message } });
      break;
    }
  }
  if (status === 'running') {
    status = cursor ? 'running' : 'completed';
    nextRunAt = cursor ? now : null;
  }
  const finished = ['completed', 'stopped', 'failed'].includes(status);
  const [updated] = await tx.update(workflowRuns).set({
    status, cursor: cursor ?? run.cursor, nextRunAt, lockedUntil: null, log: log.slice(-200), error,
    finishedAt: finished ? now : null,
  }).where(byTenant(workflowRuns, scope, runId)).returning();
  return updated;
}

/** For the builder preview and tests: turn a trigger + steps into a readable outline. */
export function outline(def: Pick<WorkflowDefinition, 'steps'>, depth = 0): string[] {
  const lines: string[] = [];
  const pad = '  '.repeat(depth);
  for (const s of def.steps) {
    lines.push(`${pad}- ${s.type}`);
    if (s.type === 'condition') {
      lines.push(`${pad}  yes:`, ...outline({ steps: s.yes }, depth + 2));
      lines.push(`${pad}  no:`, ...outline({ steps: s.no }, depth + 2));
    }
  }
  return lines;
}

