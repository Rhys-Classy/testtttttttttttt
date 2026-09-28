import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { closeDb } from '@/db/client';
import { withContext } from '@/db/context';
import { contacts, deals, events, invoices, jobs, leads, messages, payments, tasks, webhookEvents, workflowRuns } from '@/db/schema';
import { createContact, createDeal, getStages } from '@/server/services/crm';
import {
  acceptQuote, createInvoice, createQuote, getInvoice, recordManualPayment, recordProviderPayment, sendInvoice, sweepOverdueInvoices,
} from '@/server/services/finance';
import { completeTask, createTask } from '@/server/services/work';
import { recordInbound } from '@/server/services/comms';
import { saveForm, submitForm, saveCampaign, scheduleCampaign, dispatchCampaign, previewSegment } from '@/server/services/marketing';
import { advanceRun, processEvent, saveWorkflow, setWorkflowStatus } from '@/server/services/automation';
import { connectBusinessIntegration } from '@/server/services/integrations';
import { handleStripeWebhook } from '@/server/services/stripe';
import { deliverDueMessages } from '@/server/services/delivery';
import { asSystem, asUser, createFixture, type Fixture } from './helpers';

let f: Fixture;
beforeAll(async () => { f = await createFixture(); });
afterAll(async () => { await closeDb(); });

/** Drain this business's outbox like the worker would, returning started-run count. */
async function drainEvents(subAccountId: string) {
  const pending = await asSystem(subAccountId, (tx) => tx.select({ seq: events.seq }).from(events).where(and(eq(events.subAccountId, subAccountId))));
  let started = 0;
  for (const e of pending) started += (await asSystem(subAccountId, (tx, s) => processEvent(tx, s, e.seq))).started;
  return started;
}

describe('quote -> job -> invoice -> payment', () => {
  it('accepting a quote wins the deal, creates the job and a deposit invoice', async () => {
    const r = await asUser(f.ownerId, f.bizA, async (tx, s) => {
      const c = await createContact(tx, s, { name: 'Sarah Mitchell', email: 'sarah@q.test' });
      const deal = await createDeal(tx, s, { title: 'Facelift', contactId: c.id, valueCents: 18_000_00 });
      const q = await createQuote(tx, s, {
        contactId: c.id, dealId: deal.id, title: 'Kitchen facelift',
        lines: [{ description: 'Doors', quantity: 20, unitPriceCents: 185_00 }, { description: 'Benchtop', quantity: 6, unitPriceCents: 950_00 }],
        acceptOptions: { createJob: true, createInvoice: true, depositPercent: 30, markDealWon: true },
      });
      expect(q.totalCents).toBe(Math.round((3700_00 + 5700_00) * 1.1));
      return { c, deal, q };
    });
    const accepted = await withContext({ actor: 'public', subAccountId: f.bizA }, (tx) =>
      acceptQuote(tx, { subAccountId: f.bizA, userId: null, actor: 'public' }, r.q.id, { acceptedByName: 'Sarah M' }));
    expect(accepted.quote.status).toBe('accepted');
    const check = await asUser(f.ownerId, f.bizA, async (tx) => ({
      deal: (await tx.select().from(deals).where(eq(deals.id, r.deal.id)))[0],
      job: (await tx.select().from(jobs).where(eq(jobs.id, accepted.jobId!)))[0],
      invoice: (await tx.select().from(invoices).where(eq(invoices.id, accepted.invoiceId!)))[0],
      contact: (await tx.select().from(contacts).where(eq(contacts.id, r.c.id)))[0],
    }));
    expect(check.deal.status).toBe('won');
    expect(check.job.quoteId).toBe(r.q.id);
    expect(check.invoice.totalCents).toBe(Math.round(9400_00 * 0.3 * 1.1));
    expect(check.contact.status).toBe('customer');
    // Accepting twice is harmless.
    const again = await asSystem(f.bizA, (tx, s) => acceptQuote(tx, s, r.q.id));
    expect(again.invoiceId).toBe(accepted.invoiceId);
  });

  it('partial then full manual payments update balance and status', async () => {
    const inv = await asUser(f.ownerId, f.bizA, async (tx, s) => {
      const c = await createContact(tx, s, { name: 'Pay Er', email: 'payer@q.test' });
      const i = await createInvoice(tx, s, { contactId: c.id, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 1000_00 }] });
      await sendInvoice(tx, s, i.id);
      await recordManualPayment(tx, s, { invoiceId: i.id, amountCents: 500_00 });
      expect((await getInvoice(tx, s, i.id)).status).toBe('partially_paid');
      await recordManualPayment(tx, s, { invoiceId: i.id, amountCents: 600_00 });
      return getInvoice(tx, s, i.id);
    });
    expect(inv.status).toBe('paid');
    expect(inv.amountPaidCents).toBe(1100_00);
  });

  it('provider payments are idempotent', async () => {
    const inv = await asUser(f.ownerId, f.bizA, async (tx, s) => {
      const c = await createContact(tx, s, { name: 'Card Payer', email: 'card@q.test' });
      const i = await createInvoice(tx, s, { contactId: c.id, lines: [{ description: 'Work', quantity: 1, unitPriceCents: 200_00 }] });
      await sendInvoice(tx, s, i.id);
      return i;
    });
    const pay = () => asSystem(f.bizA, (tx, s) => recordProviderPayment(tx, s, { invoiceId: inv.id, amountCents: inv.totalCents, currency: 'aud', providerPaymentId: 'pi_test_same' }));
    const first = await pay();
    const second = await pay();
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const rows = await asSystem(f.bizA, (tx) => tx.select().from(payments).where(eq(payments.invoiceId, inv.id)));
    expect(rows).toHaveLength(1);
    expect((await asSystem(f.bizA, (tx, s) => getInvoice(tx, s, inv.id))).status).toBe('paid');
  });

  it('overdue sweep flips late invoices once and emits invoice.overdue', async () => {
    const inv = await asUser(f.ownerId, f.bizB, async (tx, s) => {
      const c = await createContact(tx, s, { name: 'Late Payer', email: 'late@q.test' });
      const i = await createInvoice(tx, s, { contactId: c.id, lines: [{ description: 'x', quantity: 1, unitPriceCents: 100_00 }], issueDate: '2020-01-01', dueDate: '2020-01-15' });
      await tx.update(invoices).set({ status: 'sent' }).where(eq(invoices.id, i.id));
      return i;
    });
    expect(await asSystem(f.bizB, (tx, s) => sweepOverdueInvoices(tx, s))).toBeGreaterThanOrEqual(1);
    expect(await asSystem(f.bizB, (tx, s) => sweepOverdueInvoices(tx, s))).toBe(0);
    const evs = await asSystem(f.bizB, (tx) => tx.select().from(events).where(and(eq(events.type, 'invoice.overdue'), eq(events.entityId, inv.id))));
    expect(evs).toHaveLength(1);
  });
});

describe('Stripe webhooks', () => {
  it('verifies signatures, records the payment once, and rejects forgeries', async () => {
    const whsec = 'whsec_test_secret_for_business_a';
    const integration = await asUser(f.ownerId, f.bizA, (tx, s) => connectBusinessIntegration(tx, s, 'stripe', { secretKey: 'sk_test_123', webhookSecret: whsec }));
    const inv = await asUser(f.ownerId, f.bizA, async (tx, s) => {
      const c = await createContact(tx, s, { name: 'Stripe Customer', email: 'stripe@q.test' });
      const i = await createInvoice(tx, s, { contactId: c.id, lines: [{ description: 'Deposit', quantity: 1, unitPriceCents: 300_00 }] });
      await sendInvoice(tx, s, i.id);
      return i;
    });
    const event = {
      id: 'evt_test_1', object: 'event', type: 'checkout.session.completed', api_version: '2025-01-01', created: Date.now() / 1000,
      data: { object: { id: 'cs_test_1', object: 'checkout.session', payment_status: 'paid', payment_intent: 'pi_test_webhook', amount_total: inv.totalCents, currency: 'aud', customer: 'cus_123', metadata: { invoice_id: inv.id, sub_account_id: f.bizA } } },
    };
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: whsec });
    const run = (sig: string) => asSystem(f.bizA, (tx, s) => handleStripeWebhook(tx, s, integration.id, payload, sig));
    expect((await run(header)).status).toBe('processed');
    expect((await run(header)).status).toBe('duplicate');
    await expect(run('t=1,v1=deadbeef')).rejects.toThrow();
    const paid = await asSystem(f.bizA, (tx, s) => getInvoice(tx, s, inv.id));
    expect(paid.status).toBe('paid');
    const logged = await asSystem(f.bizA, (tx) => tx.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, 'evt_test_1')));
    expect(logged).toHaveLength(1);
    const cust = await asSystem(f.bizA, (tx) => tx.select().from(contacts).where(eq(contacts.id, inv.contactId!)));
    expect(cust[0].stripeCustomerId).toBe('cus_123');
  });

  it('a webhook for business A cannot pay an invoice in business B', async () => {
    const whsec = 'whsec_test_secret_for_business_a';
    const integration = await asUser(f.ownerId, f.bizA, (tx, s) => connectBusinessIntegration(tx, s, 'stripe', { secretKey: 'sk_test_123', webhookSecret: whsec }));
    const invB = await asUser(f.ownerId, f.bizB, async (tx, s) => {
      const c = await createContact(tx, s, { name: 'B Customer', email: 'b@q.test' });
      return createInvoice(tx, s, { contactId: c.id, lines: [{ description: 'x', quantity: 1, unitPriceCents: 100_00 }] });
    });
    const payload = JSON.stringify({
      id: 'evt_cross', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_cross', object: 'payment_intent', amount: 11000, amount_received: 11000, currency: 'aud', latest_charge: null, metadata: { invoice_id: invB.id } } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: whsec });
    await expect(asSystem(f.bizA, (tx, s) => handleStripeWebhook(tx, s, integration.id, payload, header))).rejects.toThrow(/not found/i);
    const b = await asUser(f.ownerId, f.bizB, (tx, s) => getInvoice(tx, s, invB.id));
    expect(b.amountPaidCents).toBe(0);
  });
});

describe('automations', () => {
  it('new lead -> wait -> SMS -> wait -> if no reply email + task; a reply stops it', async () => {
    const wf = await asUser(f.ownerId, f.bizA, async (tx, s) => {
      const w = await saveWorkflow(tx, s, {
        name: 'Nurture', trigger: { type: 'lead.created', config: { source: 'facebook' } },
        settings: { stopOnReply: true, allowReentry: false },
        steps: [
          { id: '1', type: 'wait', config: { amount: 10, unit: 'minutes' } },
          { id: '2', type: 'send_sms', config: { body: 'Hi {{contact.first_name}}' } },
          { id: '3', type: 'wait', config: { amount: 1, unit: 'days' } },
          { id: '4', type: 'condition', config: { match: 'all', conditions: [{ field: 'contact.replied', op: 'eq', value: 'no' }] },
            yes: [{ id: '5', type: 'send_email', config: { subject: 'Still keen?', body: 'Hi' } }, { id: '6', type: 'create_task', config: { title: 'Call {{contact.name}}' } }], no: [] },
        ],
      });
      await setWorkflowStatus(tx, s, w.id, 'active');
      return w;
    });
    // Two leads: one from facebook (matches), one from google (doesn't).
    const { createLead } = await import('@/server/services/crm');
    const lead = await asUser(f.ownerId, f.bizA, (tx, s) => createLead(tx, s, { name: 'Noah Jones', phone: '0466 000 111', email: 'noah@a.test', source: 'facebook' }));
    await asUser(f.ownerId, f.bizA, (tx, s) => createLead(tx, s, { name: 'Other Lead', phone: '0466 000 222', source: 'google' }));
    await drainEvents(f.bizA);
    const runs = await asSystem(f.bizA, (tx) => tx.select().from(workflowRuns).where(eq(workflowRuns.workflowId, wf.id)));
    expect(runs).toHaveLength(1);
    const run = runs[0];

    const t0 = new Date();
    let r = await asSystem(f.bizA, (tx, s) => advanceRun(tx, s, run.id, t0));
    expect(r.status).toBe('waiting');
    expect(r.nextRunAt!.getTime() - t0.getTime()).toBe(10 * 60_000);

    r = await asSystem(f.bizA, (tx, s) => advanceRun(tx, s, run.id, new Date(t0.getTime() + 11 * 60_000)));
    expect(r.status).toBe('waiting');
    const sms = await asSystem(f.bizA, (tx) => tx.select().from(messages).where(and(eq(messages.workflowRunId, run.id), eq(messages.channel, 'sms'))));
    expect(sms).toHaveLength(1);
    expect(sms[0].body).toBe('Hi Noah');

    r = await asSystem(f.bizA, (tx, s) => advanceRun(tx, s, run.id, new Date(t0.getTime() + 26 * 3_600_000)));
    expect(r.status).toBe('completed');
    const email = await asSystem(f.bizA, (tx) => tx.select().from(messages).where(and(eq(messages.workflowRunId, run.id), eq(messages.channel, 'email'))));
    expect(email).toHaveLength(1);
    const task = await asSystem(f.bizA, (tx) => tx.select().from(tasks).where(eq(tasks.title, 'Call Noah Jones')));
    expect(task).toHaveLength(1);
    expect(task[0].source).toBe('automation');

    // Second lead for the same contact within the run window would not re-enter; a reply stops a new run.
    await asSystem(f.bizA, (tx) => tx.update(workflowRuns).set({ status: 'waiting', cursor: [2], nextRunAt: new Date(Date.now() + 86_400_000) }).where(eq(workflowRuns.id, run.id)));
    await asSystem(f.bizA, (tx, s) => recordInbound(tx, s, { channel: 'sms', from: '+61466000111', body: 'Yes please call me' }));
    await drainEvents(f.bizA);
    const stopped = await asSystem(f.bizA, (tx) => tx.select().from(workflowRuns).where(eq(workflowRuns.id, run.id)));
    expect(stopped[0].status).toBe('stopped');
    void lead;
  });

  it('a failing step marks the run failed and notifies', async () => {
    const wf = await asUser(f.ownerId, f.bizB, async (tx, s) => {
      const w = await saveWorkflow(tx, s, { name: 'Needs email', trigger: { type: 'contact.created' }, settings: {}, steps: [{ id: 'x', type: 'send_email', config: { subject: 'Hi', body: 'Hi' } }] });
      await setWorkflowStatus(tx, s, w.id, 'active');
      return w;
    });
    const noEmail = await asUser(f.ownerId, f.bizB, (tx, s) => createContact(tx, s, { name: 'No Email', phone: '0400 000 999' }));
    await drainEvents(f.bizB);
    const [run] = await asSystem(f.bizB, (tx) => tx.select().from(workflowRuns).where(and(eq(workflowRuns.workflowId, wf.id), eq(workflowRuns.contactId, noEmail.id))));
    const done = await asSystem(f.bizB, (tx, s) => advanceRun(tx, s, run.id));
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/no email/i);
  });

  it('automations in business A never fire for events in business B', async () => {
    const wfA = await asUser(f.ownerId, f.bizA, async (tx, s) => {
      const w = await saveWorkflow(tx, s, { name: 'A only', trigger: { type: 'tag.added', config: { tag: 'isolation-check' } }, settings: {}, steps: [{ id: 'n', type: 'notify', config: { title: 'x' } }] });
      await setWorkflowStatus(tx, s, w.id, 'active');
      return w;
    });
    await asUser(f.ownerId, f.bizB, (tx, s) => createContact(tx, s, { name: 'Tagged in B', tags: ['isolation-check'] }));
    await drainEvents(f.bizB);
    const runs = await asUser(f.ownerId, [f.bizA, f.bizB], (tx) => tx.select().from(workflowRuns).where(eq(workflowRuns.workflowId, wfA.id)));
    expect(runs).toHaveLength(0);
  });
});

describe('forms, campaigns, tasks, delivery', () => {
  it('a public form submission creates the contact, lead, tags and event', async () => {
    const form = await asUser(f.ownerId, f.bizA, (tx, s) => saveForm(tx, s, {
      name: 'Kitchen planner',
      fields: [{ id: 'name', type: 'name', label: 'Name', required: true }, { id: 'email', type: 'email', label: 'Email', required: true }, { id: 'shape', type: 'dropdown', label: 'Shape', options: ['L', 'U'], customFieldKey: 'kitchen_type' }],
      settings: { createLead: true, leadSource: 'website', addTags: ['planner'] },
    }));
    const res = await withContext({ actor: 'public', subAccountId: f.bizA }, (tx) =>
      submitForm(tx, { subAccountId: f.bizA, userId: null, actor: 'public' }, form.publicId, { name: 'Emma Wilson', email: 'EMMA@planner.test', shape: 'U' }));
    expect(res.contact.email).toBe('emma@planner.test');
    expect(res.contact.tags).toContain('planner');
    expect(res.contact.customFields.kitchen_type).toBe('U');
    const l = await asSystem(f.bizA, (tx) => tx.select().from(leads).where(eq(leads.contactId, res.contact.id)));
    expect(l[0].source).toBe('website');
    // Same person again: no duplicate contact.
    const again = await withContext({ actor: 'public', subAccountId: f.bizA }, (tx) =>
      submitForm(tx, { subAccountId: f.bizA, userId: null, actor: 'public' }, form.publicId, { name: 'Emma Wilson', email: 'emma@planner.test' }));
    expect(again.contact.id).toBe(res.contact.id);
    await expect(withContext({ actor: 'public', subAccountId: f.bizA }, (tx) =>
      submitForm(tx, { subAccountId: f.bizA, userId: null, actor: 'public' }, form.publicId, { name: '' }))).rejects.toThrow(/required/);
  });

  it('campaign segments respect tags and opt-outs, and dispatch queues one message each', async () => {
    const campaign = await asUser(f.ownerId, f.bizB, async (tx, s) => {
      await createContact(tx, s, { name: 'Vip One', email: 'vip1@c.test', tags: ['vip'] });
      const two = await createContact(tx, s, { name: 'Vip Two', email: 'vip2@c.test', tags: ['VIP'] });
      await tx.update(contacts).set({ emailOptOut: true }).where(eq(contacts.id, two.id));
      await createContact(tx, s, { name: 'Normal', email: 'normal@c.test' });
      const seg = { match: 'all' as const, rules: [{ field: 'tag' as const, op: 'has' as const, value: 'vip' }] };
      expect(await previewSegment(tx, s, seg, 'email')).toEqual({ total: 2, reachable: 1 });
      const c = await saveCampaign(tx, s, { name: 'VIP drop', channel: 'email', subject: 'Hi {{contact.first_name}}', body: 'New drop', segment: seg });
      await scheduleCampaign(tx, s, c.id, null);
      return c;
    });
    expect(await asSystem(f.bizB, (tx, s) => dispatchCampaign(tx, s, campaign.id))).toBe(1);
    const msgs = await asSystem(f.bizB, (tx) => tx.select().from(messages).where(eq(messages.campaignId, campaign.id)));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].subject).toBe('Hi Vip');
    const delivered = await deliverDueMessages(f.bizB);
    expect(delivered.sent).toBeGreaterThanOrEqual(1);
  });

  it('completing a recurring task creates the next one', async () => {
    const { next } = await asUser(f.ownerId, f.bizA, async (tx, s) => {
      const t = await createTask(tx, s, { title: 'Weekly photos', dueAt: new Date('2026-09-28T07:00:00Z'), recurrence: 'weekly' });
      return completeTask(tx, s, t.id);
    });
    // Same wall-clock time (5pm Melbourne) a week later, across the DST change: 07:00Z -> 06:00Z.
    expect(next?.dueAt?.toISOString()).toBe('2026-10-05T06:00:00.000Z');
  });

  it('inbound SMS STOP opts the contact out', async () => {
    const res = await asSystem(f.bizA, (tx, s) => recordInbound(tx, s, { channel: 'sms', from: '+61400999888', body: 'STOP' }));
    expect(res.duplicate).toBe(false);
    const c = await asSystem(f.bizA, (tx) => tx.select().from(contacts).where(eq(contacts.phone, '+61400999888')));
    expect(c[0].smsOptOut).toBe(true);
  });

  it('pipeline stages come from the business, not hard-coded names', async () => {
    const stages = await asUser(f.ownerId, f.bizA, async (tx, s) => {
      const { getDefaultPipeline } = await import('@/server/services/crm');
      return getStages(tx, s, (await getDefaultPipeline(tx, s)).id);
    });
    expect(stages.map((s) => s.kind)).toContain('won');
  });
});
