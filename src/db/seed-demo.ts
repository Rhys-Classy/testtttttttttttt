import { eq } from 'drizzle-orm';
import type { Tx } from './client';
import { conversations, invoices, leads, quotes, tasks } from './schema';
import { addDaysKey, todayKey, zonedTimeToUtc } from '@/lib/dates';
import type { Step } from '@/lib/automation/types';
import type { Scope } from '@/server/services/_common';
import { byTenant, getBusiness } from '@/server/services/_common';
import { createContact, createDeal, createLead, getDefaultPipeline, getStages, moveDeal } from '@/server/services/crm';
import { createInvoice, createProduct, createQuote, recordManualPayment, sendInvoice, sendQuote } from '@/server/services/finance';
import { createAppointment, createJob, createStaffMember, createTask } from '@/server/services/work';
import { recordInbound } from '@/server/services/comms';
import { saveForm, saveCampaign, DEFAULT_FORM_FIELDS } from '@/server/services/marketing';
import { saveWorkflow, setWorkflowStatus } from '@/server/services/automation';

/** Run thunks one at a time (a transaction is one connection). */
async function sequentialCalls<T>(thunks: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  for (const t of thunks) out.push(await t());
  return out;
}

const $ = (dollars: number) => Math.round(dollars * 100);

/** Demo data so every screen has something real-looking on day one. */
export async function seedDemoData(tx: Tx, scope: Scope, businessName: string) {
  const b = await getBusiness(tx, scope.subAccountId);
  const tz = b.timezone;
  const today = todayKey(tz);
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const [y, m, d] = addDaysKey(today, dayOffset).split('-').map(Number);
    return zonedTimeToUtc(y, m, d, hour, minute, tz);
  };
  const pipeline = await getDefaultPipeline(tx, scope);
  const stages = await getStages(tx, scope, pipeline.id);
  const stage = (name: string) => stages.find((s) => s.name === name)?.id ?? stages[0].id;
  const backdate = async (table: typeof invoices | typeof quotes, id: string, patch: Record<string, unknown>) =>
    tx.update(table).set(patch).where(byTenant(table, scope, id));

  const nurture: Step[] = [
    { id: 'w1', type: 'wait', config: { amount: 10, unit: 'minutes' } },
    { id: 's1', type: 'send_sms', config: { body: 'Hi {{contact.first_name|there}}, thanks for contacting {{business.name}}! When suits for a quick call?' } },
    { id: 'w2', type: 'wait', config: { amount: 1, unit: 'days' } },
    {
      id: 'c1', type: 'condition', config: { match: 'all', conditions: [{ field: 'contact.replied', op: 'eq', value: 'no' }] },
      yes: [
        { id: 'e1', type: 'send_email', config: { subject: 'Still keen?', body: 'Hi {{contact.first_name|there}},\n\nJust checking in on your enquiry. Reply to this email or call us any time.\n\n{{business.name}}' } },
        { id: 't1', type: 'create_task', config: { title: 'Call {{contact.name}} — no reply to follow-up', dueInDays: 0, priority: 'high' } },
      ],
      no: [],
    },
  ];
  const wf = await saveWorkflow(tx, scope, {
    name: 'New lead follow-up', description: 'SMS in 10 minutes, email + call task next day if no reply.',
    trigger: { type: 'lead.created' }, steps: nurture, settings: { stopOnReply: true, allowReentry: false },
  });
  await setWorkflowStatus(tx, scope, wf.id, 'active');
  const overdueWf = await saveWorkflow(tx, scope, {
    name: 'Overdue invoice chaser', description: 'Friendly SMS when an invoice goes overdue, task if still unpaid after 5 days.',
    trigger: { type: 'invoice.overdue' },
    steps: [
      { id: 'o1', type: 'send_sms', config: { body: 'Hi {{contact.first_name|there}}, a quick reminder that invoice {{invoice.number}} ({{invoice.balance}}) is overdue. Pay online: {{invoice.link}}' } },
      { id: 'o2', type: 'wait', config: { amount: 5, unit: 'days' } },
      { id: 'o3', type: 'condition', config: { match: 'all', conditions: [{ field: 'invoice.status', op: 'neq', value: 'paid' }] },
        yes: [{ id: 'o4', type: 'create_task', config: { title: 'Call {{contact.name}} about overdue {{invoice.number}}', priority: 'high' } }], no: [] },
    ],
    settings: { stopOnReply: false, allowReentry: true },
  });
  await setWorkflowStatus(tx, scope, overdueWf.id, 'active');

  await saveForm(tx, scope, {
    name: businessName.includes('Kitchen') ? 'Kitchen planner' : 'Website enquiry',
    fields: businessName.includes('Kitchen')
      ? [...DEFAULT_FORM_FIELDS.slice(0, 3),
          { id: 'suburb', type: 'text', label: 'Suburb' },
          { id: 'kitchen_type', type: 'dropdown', label: 'Kitchen shape', options: ['L-shape', 'U-shape', 'Galley', 'Island', 'Single wall'], customFieldKey: 'kitchen_type' },
          { id: 'scope', type: 'checkbox', label: 'What are you thinking?', options: ['New doors', 'Benchtops', 'Splashback', 'Drawer conversions', 'Full facelift'] },
          { id: 'message', type: 'textarea', label: 'Anything else?' }]
      : DEFAULT_FORM_FIELDS,
    settings: { createLead: true, leadSource: 'website', addTags: ['website'], notify: true, thankYouMessage: 'Thanks! We will be in touch within one business day.' },
  });

  if (businessName.includes('Kitchen')) {
    const [doors, drawers, stone, glass, panels] = await sequentialCalls([
      () => createProduct(tx, scope, { name: 'Replacement door (per door)', sku: 'DOOR-STD', priceCents: $(185), costCents: $(78), kind: 'product', unit: 'door', category: 'Doors' }),
      () => createProduct(tx, scope, { name: 'Drawer conversion', sku: 'DRW-CONV', priceCents: $(420), costCents: $(190), kind: 'service', category: 'Drawers' }),
      () => createProduct(tx, scope, { name: 'Stone benchtop (per lm)', sku: 'BT-STONE', priceCents: $(950), costCents: $(560), kind: 'product', unit: 'lm', category: 'Benchtops' }),
      () => createProduct(tx, scope, { name: 'Glass splashback', sku: 'SPL-GLASS', priceCents: $(1450), costCents: $(700), kind: 'product', category: 'Splashbacks' }),
      () => createProduct(tx, scope, { name: 'Kickboards & end panels', sku: 'PNL-KICK', priceCents: $(380), costCents: $(140), kind: 'product', category: 'Panels' }),
    ]);
    const sarah = await createContact(tx, scope, { name: 'Sarah Mitchell', email: 'sarah.mitchell@example.com', phone: '0412 345 678', source: 'facebook', address: { suburb: 'Traralgon', state: 'VIC', postcode: '3844' }, customFields: { kitchen_type: 'L-shape', door_profile: 'Shaker', benchtop_type: 'Stone' }, tags: ['facebook-ad'] });
    const john = await createContact(tx, scope, { name: 'John Smith', email: 'john@abcbuilders.example.com', phone: '0400 111 222', companyName: 'ABC Builders', jobTitle: 'Director', source: 'referral', status: 'customer', tags: ['builder', 'trade'] });
    await createContact(tx, scope, { name: 'Sarah Smith', email: 'accounts@abcbuilders.example.com', companyId: john.companyId, jobTitle: 'Accounts', source: 'referral', status: 'customer' });
    const emma = await createContact(tx, scope, { name: 'Emma Wilson', email: 'emma.w@example.com', phone: '0423 555 010', source: 'website', address: { suburb: 'Moe', state: 'VIC' }, customFields: { kitchen_type: 'U-shape' } });
    const liam = await createContact(tx, scope, { name: 'Liam Brown', email: 'liam.brown@example.com', phone: '0433 222 919', source: 'google', status: 'customer', address: { suburb: 'Morwell', state: 'VIC' } });
    const olivia = await createContact(tx, scope, { name: 'Olivia Taylor', phone: '0455 876 543', source: 'instagram' });

    await createLead(tx, scope, { name: 'Noah Jones', phone: '0466 321 987', email: 'noah.j@example.com', source: 'facebook', notes: 'Wants new doors + stone benchtop, galley kitchen', valueCents: $(14000) });
    await createLead(tx, scope, { contactId: olivia.id, source: 'instagram', notes: 'Asked about splashbacks' });
    const [oliviaLead] = await tx.select().from(leads).where(eq(leads.contactId, olivia.id));
    await tx.update(leads).set({ status: 'contacted', nextAction: 'Book measure', nextActionAt: at(0, 16) }).where(byTenant(leads, scope, oliviaLead.id));

    const sarahDeal = await createDeal(tx, scope, { title: 'Sarah Mitchell — full facelift', contactId: sarah.id, valueCents: $(18500), stageId: stage('Quote Sent') });
    const emmaDeal = await createDeal(tx, scope, { title: 'Emma Wilson — doors + benchtop', contactId: emma.id, valueCents: $(12000), stageId: stage('Appointment Booked') });
    const liamDeal = await createDeal(tx, scope, { title: 'Liam Brown — facelift', contactId: liam.id, valueCents: $(16240), stageId: stage('Qualified') });
    await moveDeal(tx, scope, liamDeal.id, stage('Won'));
    await createDeal(tx, scope, { title: 'ABC Builders — 3 unit fit-out', contactId: john.id, companyId: john.companyId, valueCents: $(42000), stageId: stage('Contacted') });

    const q = await createQuote(tx, scope, {
      contactId: sarah.id, dealId: sarahDeal.id, title: 'L-shape kitchen facelift',
      lines: [
        { productId: doors.id, description: doors.name, quantity: 22, unitPriceCents: doors.priceCents },
        { productId: drawers.id, description: drawers.name, quantity: 3, unitPriceCents: drawers.priceCents },
        { productId: stone.id, description: stone.name, quantity: 6.2, unitPriceCents: stone.priceCents },
        { productId: glass.id, description: glass.name, quantity: 1, unitPriceCents: glass.priceCents },
        { productId: panels.id, description: panels.name, quantity: 1, unitPriceCents: panels.priceCents },
      ],
      acceptOptions: { createJob: true, createInvoice: true, depositPercent: 30, markDealWon: true },
    });
    await sendQuote(tx, scope, q.id);
    await backdate(quotes, q.id, { sentAt: at(-5, 10), status: 'viewed', viewedAt: at(-4, 19) });

    const job = await createJob(tx, scope, { title: 'Liam Brown kitchen facelift', contactId: liam.id, dealId: liamDeal.id, valueCents: $(16240), scheduledStart: at(1, 7, 30), scheduledEnd: at(3, 16), address: { suburb: 'Morwell', state: 'VIC' } });
    const deposit = await createInvoice(tx, scope, { contactId: liam.id, jobId: job.id, dealId: liamDeal.id, title: 'Deposit — kitchen facelift', lines: [{ description: '30% deposit — kitchen facelift', quantity: 1, unitPriceCents: $(4428.99) }], issueDate: addDaysKey(today, -20), dueDate: addDaysKey(today, -13) });
    await sendInvoice(tx, scope, deposit.id);
    await recordManualPayment(tx, scope, { invoiceId: deposit.id, amountCents: deposit.totalCents, method: 'bank_transfer', reference: 'LB DEPOSIT', paidAt: at(-2, 11) });
    const final = await createInvoice(tx, scope, { contactId: liam.id, jobId: job.id, title: 'Balance — kitchen facelift', lines: [{ description: 'Kitchen facelift balance', quantity: 1, unitPriceCents: $(10334.31) }], dueDate: addDaysKey(today, 5) });
    await sendInvoice(tx, scope, final.id);
    const johnInv = await createInvoice(tx, scope, { contactId: john.id, companyId: john.companyId, title: 'Unit 2 doors', lines: [{ productId: doors.id, description: 'Replacement doors — unit 2', quantity: 14, unitPriceCents: doors.priceCents }, { description: 'Installation labour', quantity: 6, unitPriceCents: $(95) }], issueDate: addDaysKey(today, -30), dueDate: addDaysKey(today, -16) });
    await sendInvoice(tx, scope, johnInv.id);
    await backdate(invoices, johnInv.id, { status: 'overdue', sentAt: at(-30, 9) });
    const paidToday = await createInvoice(tx, scope, { contactId: john.id, companyId: john.companyId, title: 'Unit 1 panels', lines: [{ productId: panels.id, description: panels.name, quantity: 4, unitPriceCents: panels.priceCents }], issueDate: addDaysKey(today, -10) });
    await sendInvoice(tx, scope, paidToday.id);
    await recordManualPayment(tx, scope, { invoiceId: paidToday.id, amountCents: paidToday.totalCents, method: 'card', paidAt: new Date() });

    await createTask(tx, scope, { title: 'Call Noah about his galley kitchen', dueAt: at(0, 9), priority: 'high' });
    await createTask(tx, scope, { title: 'Send quote to Emma', dueAt: at(0, 12), contactId: emma.id, dealId: emmaDeal.id });
    const overdueTask = await createTask(tx, scope, { title: "Order doors for Liam's job", dueAt: at(-1, 9), jobId: job.id, priority: 'urgent' });
    void overdueTask;
    await createTask(tx, scope, { title: 'Post before/after photos to Instagram', dueAt: at(0, 17), priority: 'low', recurrence: 'weekly' });
    await createTask(tx, scope, { title: 'Interview head installer candidates', dueAt: at(2, 10), priority: 'high' });
    await createAppointment(tx, scope, { title: 'Measure & quote — Emma Wilson', contactId: emma.id, dealId: emmaDeal.id, startsAt: at(0, 14), durationMinutes: 60, location: 'Moe VIC' });
    await createAppointment(tx, scope, { title: 'Supplier meeting — stone', startsAt: at(2, 11), durationMinutes: 45, kind: 'event' });
    await recordInbound(tx, scope, { channel: 'sms', from: '+61455876543', body: 'Hi! Can you come out Thursday to measure up? Thanks, Olivia' });
    return;
  }

  if (businessName.includes('Clothing')) {
    const tee = await createProduct(tx, scope, { name: 'Classy logo tee', sku: 'TEE-LOGO', priceCents: $(45), costCents: $(14), kind: 'product', category: 'Tees' });
    const hood = await createProduct(tx, scope, { name: 'Heavyweight hoodie', sku: 'HOOD-HW', priceCents: $(95), costCents: $(32), kind: 'product', category: 'Hoodies' });
    const shop = await createContact(tx, scope, { name: 'Mia Chen', email: 'mia@streetstore.example.com', companyName: 'Street Store Sale', jobTitle: 'Buyer', status: 'customer', customFields: { customer_segment: 'Wholesale' }, tags: ['wholesale'] });
    await createContact(tx, scope, { name: 'Jack Harris', email: 'jack.h@example.com', status: 'customer', customFields: { clothing_size: 'L', customer_segment: 'VIP' }, tags: ['vip'], source: 'instagram' });
    await createContact(tx, scope, { name: 'Ava Nguyen', email: 'ava.n@example.com', status: 'customer', customFields: { clothing_size: 'S' }, source: 'instagram' });
    await createLead(tx, scope, { name: 'Ruby Patel', email: 'ruby@boutique.example.com', source: 'instagram', notes: 'Boutique wanting wholesale pricing' });
    const inv = await createInvoice(tx, scope, { contactId: shop.id, title: 'Wholesale order', lines: [{ productId: tee.id, description: tee.name, quantity: 40, unitPriceCents: $(24) }, { productId: hood.id, description: hood.name, quantity: 20, unitPriceCents: $(52) }], issueDate: addDaysKey(today, -9) });
    await sendInvoice(tx, scope, inv.id);
    await recordManualPayment(tx, scope, { invoiceId: inv.id, amountCents: inv.totalCents, method: 'bank_transfer', paidAt: at(-3, 14) });
    await saveCampaign(tx, scope, { name: 'Summer drop — VIP early access', channel: 'email', subject: 'Early access for you, {{contact.first_name|friend}}', body: 'The summer drop lands Friday. VIPs get 24 hours early access. Use code VIP10.', segment: { match: 'all', rules: [{ field: 'tag', op: 'has', value: 'vip' }] } });
    await createTask(tx, scope, { title: 'Approve summer drop samples', dueAt: at(0, 11), priority: 'high' });
    return;
  }

  if (businessName.includes('Marketing')) {
    const retainer = await createProduct(tx, scope, { name: 'Automation Pro retainer (monthly)', priceCents: $(1800), kind: 'service', category: 'Retainers' });
    const client = await createContact(tx, scope, { name: 'Ben Carter', email: 'ben@gippsplumbing.example.com', phone: '0411 909 808', companyName: 'Gipps Plumbing', jobTitle: 'Owner', status: 'customer', customFields: { marketing_package: 'Automation Pro', monthly_ad_spend: 2500 } });
    const prospect = await createContact(tx, scope, { name: 'Chloe Adams', email: 'chloe@latrobedental.example.com', companyName: 'Latrobe Dental', source: 'google' });
    await createLead(tx, scope, { contactId: prospect.id, source: 'google', valueCents: $(1800 * 12), notes: 'Wants Google Ads + booking automation' });
    await createDeal(tx, scope, { title: 'Latrobe Dental — Growth package', contactId: prospect.id, valueCents: $(21600), stageId: stage('Qualified') });
    const paid = await createInvoice(tx, scope, { contactId: client.id, title: 'Retainer — this month', lines: [{ productId: retainer.id, description: retainer.name, quantity: 1, unitPriceCents: retainer.priceCents }], issueDate: addDaysKey(today, -6) });
    await sendInvoice(tx, scope, paid.id);
    await recordManualPayment(tx, scope, { invoiceId: paid.id, amountCents: paid.totalCents, method: 'card', paidAt: at(-1, 9) });
    const late = await createInvoice(tx, scope, { contactId: client.id, title: 'Ad spend management', lines: [{ description: 'Ad management fee', quantity: 1, unitPriceCents: $(650) }], issueDate: addDaysKey(today, -25), dueDate: addDaysKey(today, -11) });
    await sendInvoice(tx, scope, late.id);
    await backdate(invoices, late.id, { status: 'overdue' });
    await createTask(tx, scope, { title: 'Follow up lead Chloe (Latrobe Dental)', dueAt: at(0, 10), contactId: prospect.id, priority: 'high' });
    await createAppointment(tx, scope, { title: 'Strategy call — Latrobe Dental', contactId: prospect.id, startsAt: at(1, 13), durationMinutes: 30, location: 'Zoom' });
    return;
  }

  if (businessName.includes('Disability')) {
    const worker1 = await createStaffMember(tx, scope, { name: 'Kate Morrison', role: 'Support worker', phone: '0400 555 101' });
    await createStaffMember(tx, scope, { name: 'Daniel Price', role: 'Support worker', phone: '0400 555 202' });
    const planManager = await createContact(tx, scope, { name: 'Plan Partners Accounts', email: 'invoices@planpartners.example.com', status: 'customer', tags: ['plan-manager'] });
    const client = await createContact(tx, scope, { name: 'Tom Richards', phone: '0412 700 300', status: 'customer', customFields: { service_type: 'Community access', support_schedule: 'Tue + Thu 9am–1pm', plan_manager: 'Plan Partners' } });
    await createContact(tx, scope, { name: 'Grace Walker', phone: '0412 700 400', status: 'customer', customFields: { service_type: 'Core supports' } });
    await createLead(tx, scope, { name: 'Helen Foster', phone: '0412 700 500', source: 'referral', notes: 'Referred by support coordinator — respite enquiry' });
    await createAppointment(tx, scope, { title: 'Community access — Tom Richards', contactId: client.id, staffId: worker1.id, startsAt: at(0, 9), durationMinutes: 240, location: 'Traralgon' });
    await createAppointment(tx, scope, { title: 'Intake call — Helen Foster', startsAt: at(0, 15, 30), durationMinutes: 30, kind: 'appointment' });
    const inv = await createInvoice(tx, scope, { contactId: planManager.id, title: 'Supports — Tom Richards (fortnight)', lines: [{ description: 'Access community social & rec activities — 16 hrs', quantity: 16, unitPriceCents: $(70.23), taxCode: 'GST_FREE' }] });
    await sendInvoice(tx, scope, inv.id);
    await createTask(tx, scope, { title: 'Update shift notes for Tom', dueAt: at(0, 16), contactId: client.id });
    await createTask(tx, scope, { title: 'Renew worker screening check — Daniel', dueAt: at(-2, 9), priority: 'high' });
    return;
  }

  if (businessName.includes('Furniture')) {
    const table = await createProduct(tx, scope, { name: 'Custom dining table', priceCents: $(3200), costCents: $(1400), kind: 'product', category: 'Tables' });
    const john = await createContact(tx, scope, { name: 'John Smith', email: 'jsmith.home@example.com', phone: '0400 333 444', source: 'website', customFields: { timber_type: 'Blackbutt', finish: 'Natural oil' } });
    await createLead(tx, scope, { contactId: john.id, source: 'website', notes: '2.4m dining table, seats 8', valueCents: $(3800) });
    const lucy = await createContact(tx, scope, { name: 'Lucy Green', email: 'lucy.green@example.com', status: 'customer', customFields: { timber_type: 'Spotted gum' } });
    const deal = await createDeal(tx, scope, { title: 'Lucy Green — entertainment unit', contactId: lucy.id, valueCents: $(2650), stageId: stage('Quote Sent') });
    const q = await createQuote(tx, scope, { contactId: lucy.id, dealId: deal.id, title: 'Spotted gum entertainment unit', lines: [{ description: 'Entertainment unit 2.1m, spotted gum, 2 drawers', quantity: 1, unitPriceCents: $(2650) }] });
    await sendQuote(tx, scope, q.id);
    const job = await createJob(tx, scope, { title: 'Blackbutt coffee table — Morgan', valueCents: $(1450), status: 'in_progress' });
    void job; void table;
    await createTask(tx, scope, { title: 'Call timber supplier re blackbutt slabs', dueAt: at(0, 8, 30), priority: 'normal' });
    await recordInbound(tx, scope, { channel: 'email', from: 'lucy.green@example.com', subject: 'Re: quote', body: 'Hi, love the quote — can the drawers be soft close?' });
    return;
  }
  void conversations; void tasks;
}
