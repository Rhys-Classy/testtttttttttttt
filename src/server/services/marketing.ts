import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import {
  campaignRecipients, campaigns, contacts, formSubmissions, forms, landingPages,
  type FormField, type FormSettings, type LandingSection, type Segment,
} from '@/db/schema';
import { randomToken } from '@/lib/crypto';
import { renderTemplate } from '@/lib/template';
import { Scope, ValidationError, byTenant, cleanStr, emit, getBusiness, must } from './_common';
import { addTags, contactName, createDeal, createLead, findOrCreateContact, splitName } from './crm';
import { queueMessage } from './comms';
import { notify } from './notifications';

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

export const DEFAULT_FORM_FIELDS: FormField[] = [
  { id: 'name', type: 'name', label: 'Your name', required: true },
  { id: 'email', type: 'email', label: 'Email', required: true },
  { id: 'phone', type: 'phone', label: 'Mobile' },
  { id: 'message', type: 'textarea', label: 'How can we help?' },
];

export async function saveForm(tx: Tx, scope: Scope, input: { id?: string; name: string; fields: FormField[]; settings: FormSettings; status?: 'draft' | 'published' }) {
  if (!cleanStr(input.name)) throw new ValidationError('Form needs a name.');
  if (!input.fields.length) throw new ValidationError('Add at least one field.');
  if (!input.fields.some((f) => ['email', 'phone', 'name', 'first_name'].includes(f.type))) {
    throw new ValidationError('Add a name, email or phone field so submissions can become contacts.');
  }
  if (input.id) {
    const [row] = await tx.update(forms).set({ name: input.name, fields: input.fields, settings: input.settings, status: input.status, updatedAt: new Date() })
      .where(byTenant(forms, scope, input.id)).returning();
    return must(row, 'Form');
  }
  const [row] = await tx.insert(forms).values({
    subAccountId: scope.subAccountId, name: input.name, fields: input.fields, settings: input.settings,
    status: input.status ?? 'published', publicId: randomToken(9),
  }).returning();
  return row;
}

/** Public submission. Runs as the `public` actor pinned to the form's business. */
export async function submitForm(tx: Tx, scope: Scope, publicId: string, raw: Record<string, unknown>, meta: Record<string, unknown> = {}) {
  const [form] = await tx.select().from(forms).where(and(eq(forms.subAccountId, scope.subAccountId), eq(forms.publicId, publicId)));
  if (!form || form.status !== 'published') throw new ValidationError('This form is not available.');
  const data: Record<string, unknown> = {};
  const identity: { firstName?: string; lastName?: string; email?: string; phone?: string; address?: Record<string, string> } = {};
  const custom: Record<string, unknown> = {};
  for (const f of form.fields) {
    const v = raw[f.id];
    const str = Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v);
    if (f.required && !str) throw new ValidationError(`${f.label} is required.`);
    if (f.type === 'email' && str && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str)) throw new ValidationError('Enter a valid email address.');
    data[f.id] = v ?? null;
    if (!str) continue;
    if (f.type === 'name') Object.assign(identity, splitName(str));
    if (f.type === 'first_name') identity.firstName = str;
    if (f.type === 'last_name') identity.lastName = str;
    if (f.type === 'email') identity.email = str;
    if (f.type === 'phone') identity.phone = str;
    if (f.type === 'address') identity.address = { line1: str };
    if (f.customFieldKey) custom[f.customFieldKey] = v;
  }
  if (!identity.email && !identity.phone && !identity.firstName) throw new ValidationError('Please tell us who you are.');

  const settings = form.settings ?? {};
  const source = (settings.leadSource ?? 'website') as never;
  const { contact } = await findOrCreateContact(tx, scope, {
    firstName: identity.firstName, lastName: identity.lastName, email: identity.email, phone: identity.phone,
    address: identity.address, source, customFields: custom, tags: settings.addTags ?? [],
  });
  const [submission] = await tx.insert(formSubmissions).values({ subAccountId: scope.subAccountId, formId: form.id, contactId: contact.id, data, meta }).returning();
  await tx.update(forms).set({ submissionCount: sql`${forms.submissionCount} + 1` }).where(byTenant(forms, scope, form.id));
  if (settings.addTags?.length) await addTags(tx, scope, contact.id, settings.addTags);

  const message = Object.entries(data).filter(([k]) => !['name', 'email', 'phone'].includes(k)).map(([, v]) => v).filter(Boolean).join('\n');
  if (settings.createLead !== false) {
    await createLead(tx, scope, { contactId: contact.id, source, notes: cleanStr(message), formSubmissionId: submission.id, title: `${form.name}: ${contactName(contact)}` });
  }
  if (settings.createDeal?.pipelineId) {
    await createDeal(tx, scope, { title: `${contactName(contact)} — ${form.name}`, contactId: contact.id, pipelineId: settings.createDeal.pipelineId, stageId: settings.createDeal.stageId, source });
  }
  await emit(tx, scope, 'form.submitted', { entityType: 'form', entityId: form.id, contactId: contact.id, payload: { formId: form.id, submissionId: submission.id, source } });
  if (settings.notify !== false) {
    await notify(tx, scope, { type: 'form.submitted', severity: 'info', title: `New ${form.name} enquiry: ${contactName(contact)}`, body: message.slice(0, 160) || undefined, link: `/contacts/${contact.id}` });
  }
  return { submission, contact, form };
}

/* ------------------------------------------------------------------ */
/* Landing pages                                                       */
/* ------------------------------------------------------------------ */

export async function saveLandingPage(tx: Tx, scope: Scope, input: { id?: string; name: string; title: string; sections: LandingSection[]; style?: Record<string, string>; published?: boolean }) {
  if (!cleanStr(input.name)) throw new ValidationError('Page needs a name.');
  if (input.id) {
    const [row] = await tx.update(landingPages).set({ name: input.name, title: input.title, sections: input.sections, style: input.style ?? {}, published: input.published, updatedAt: new Date() })
      .where(byTenant(landingPages, scope, input.id)).returning();
    return must(row, 'Page');
  }
  const [row] = await tx.insert(landingPages).values({
    subAccountId: scope.subAccountId, name: input.name, title: input.title || input.name, sections: input.sections,
    style: input.style ?? {}, published: input.published ?? false, publicId: randomToken(9),
  }).returning();
  return row;
}

/* ------------------------------------------------------------------ */
/* Segments + campaigns                                                */
/* ------------------------------------------------------------------ */

/** Segment rules -> SQL on contacts (always inside this business). */
export function segmentWhere(scope: Scope, segment: Segment): SQL {
  const parts: SQL[] = segment.rules.map((r) => {
    switch (r.field) {
      case 'tag': return r.op === 'has'
        ? sql`exists (select 1 from unnest(${contacts.tags}) t where lower(t) = lower(${r.value}))`
        : sql`not exists (select 1 from unnest(${contacts.tags}) t where lower(t) = lower(${r.value}))`;
      case 'source': return r.op === 'eq' ? sql`${contacts.source} = ${r.value}` : sql`coalesce(${contacts.source}, '') <> ${r.value}`;
      case 'status': return r.op === 'eq' ? sql`${contacts.status} = ${r.value}` : sql`${contacts.status} <> ${r.value}`;
      case 'pipeline': return sql`exists (select 1 from deals d where d.sub_account_id = ${contacts.subAccountId} and d.contact_id = ${contacts.id} and d.pipeline_id = ${r.value}::uuid)`;
      case 'pipeline_stage': return sql`exists (select 1 from deals d where d.sub_account_id = ${contacts.subAccountId} and d.contact_id = ${contacts.id} and d.stage_id = ${r.value}::uuid)`;
      case 'has_paid_invoice': return sql`${r.value ? sql`` : sql`not `}exists (select 1 from invoices i where i.sub_account_id = ${contacts.subAccountId} and i.contact_id = ${contacts.id} and i.status = 'paid')`;
      case 'has_overdue_invoice': return sql`${r.value ? sql`` : sql`not `}exists (select 1 from invoices i where i.sub_account_id = ${contacts.subAccountId} and i.contact_id = ${contacts.id} and i.status = 'overdue')`;
      case 'custom': {
        const val = sql`${contacts.customFields} ->> ${r.key}`;
        if (r.op === 'eq') return sql`lower(${val}) = lower(${r.value})`;
        if (r.op === 'neq') return sql`coalesce(lower(${val}), '') <> lower(${r.value})`;
        return sql`${val} ilike ${'%' + r.value + '%'}`;
      }
    }
  });
  const base = sql`${contacts.subAccountId} = ${scope.subAccountId} and ${contacts.archivedAt} is null`;
  if (!parts.length) return base;
  const joined = sql.join(parts, segment.match === 'any' ? sql` or ` : sql` and `);
  return sql`${base} and (${joined})`;
}

export async function previewSegment(tx: Tx, scope: Scope, segment: Segment, channel: 'email' | 'sms') {
  const reachable = channel === 'email'
    ? sql`${contacts.email} is not null and not ${contacts.emailOptOut}`
    : sql`${contacts.phone} is not null and not ${contacts.smsOptOut}`;
  const [row] = await tx.select({
    total: sql<number>`count(*)`,
    reachable: sql<number>`count(*) filter (where ${reachable})`,
  }).from(contacts).where(segmentWhere(scope, segment));
  return { total: Number(row.total), reachable: Number(row.reachable) };
}

export async function saveCampaign(tx: Tx, scope: Scope, input: { id?: string; name: string; channel: 'email' | 'sms'; subject?: string | null; body: string; segment: Segment; scheduledAt?: Date | null }) {
  if (!cleanStr(input.name)) throw new ValidationError('Campaign needs a name.');
  const values = {
    name: input.name.trim(), channel: input.channel, subject: cleanStr(input.subject), body: input.body, segment: input.segment,
    scheduledAt: input.scheduledAt ?? null, updatedAt: new Date(),
  };
  if (input.id) {
    const [current] = await tx.select().from(campaigns).where(byTenant(campaigns, scope, input.id));
    if (must(current, 'Campaign').status === 'sent') throw new ValidationError('This campaign has already been sent.');
    const [row] = await tx.update(campaigns).set(values).where(byTenant(campaigns, scope, input.id)).returning();
    return row;
  }
  const [row] = await tx.insert(campaigns).values({ ...values, subAccountId: scope.subAccountId }).returning();
  return row;
}

export async function scheduleCampaign(tx: Tx, scope: Scope, id: string, at: Date | null) {
  const [row] = await tx.update(campaigns).set({ status: 'scheduled', scheduledAt: at ?? new Date(), updatedAt: new Date() })
    .where(and(byTenant(campaigns, scope, id), sql`${campaigns.status} in ('draft', 'scheduled')`)).returning();
  return must(row, 'Campaign');
}

/** Worker: expand a due campaign into queued messages (one per reachable contact). */
export async function dispatchCampaign(tx: Tx, scope: Scope, id: string) {
  const [c] = await tx.select().from(campaigns).where(byTenant(campaigns, scope, id));
  if (!c || c.status !== 'scheduled' || (c.scheduledAt && c.scheduledAt > new Date())) return 0;
  await tx.update(campaigns).set({ status: 'sending' }).where(byTenant(campaigns, scope, id));
  const b = await getBusiness(tx, scope.subAccountId);
  const reachable = c.channel === 'email'
    ? sql`${contacts.email} is not null and not ${contacts.emailOptOut}`
    : sql`${contacts.phone} is not null and not ${contacts.smsOptOut}`;
  const recipients = await tx.select().from(contacts).where(and(segmentWhere(scope, c.segment), reachable)).orderBy(asc(contacts.createdAt));
  let sent = 0;
  for (const contact of recipients) {
    const vars = { contact: { first_name: contact.firstName, last_name: contact.lastName, name: contactName(contact) }, business: { name: b.tradingName ?? b.name } };
    const footer = c.channel === 'sms' ? '\nReply STOP to opt out' : `\n\n—\n${b.tradingName ?? b.name}. Reply "unsubscribe" to stop receiving these emails.`;
    const msg = await queueMessage(tx, scope, {
      contactId: contact.id, channel: c.channel, subject: c.subject ? renderTemplate(c.subject, vars) : null,
      body: renderTemplate(c.body, vars) + footer, campaignId: c.id,
    });
    await tx.insert(campaignRecipients).values({ subAccountId: scope.subAccountId, campaignId: c.id, contactId: contact.id, messageId: msg.id, status: 'sent' })
      .onConflictDoNothing();
    sent++;
  }
  await tx.update(campaigns).set({
    status: 'sent', sentAt: new Date(),
    stats: { ...c.stats, recipients: recipients.length, sent },
  }).where(byTenant(campaigns, scope, id));
  return sent;
}
