import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import {
  companies, contacts, customFieldDefinitions, deals, leads, notes, pipelineStages, pipelines,
  type ContactStatus, type LeadSource, type LeadStatus,
} from '@/db/schema';
import type { Address } from '@/db/schema/_shared';
import { Scope, ValidationError, byTenant, cleanStr, emit, logActivity, must } from './_common';

export type Contact = typeof contacts.$inferSelect;
export type Deal = typeof deals.$inferSelect;

export function contactName(c: Pick<Contact, 'firstName' | 'lastName' | 'email' | 'phone'> | null | undefined): string {
  if (!c) return 'Unknown';
  const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
  return name || c.email || c.phone || 'Unnamed';
}

export function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Normalise Australian numbers to E.164 where possible (0412 345 678 -> +61412345678). */
export function normalizePhone(v: string | null | undefined): string | null {
  const raw = cleanStr(v);
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('61') && digits.length === 11) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+61${digits.slice(1)}`;
  if (digits.startsWith('4') && digits.length === 9) return `+61${digits}`;
  return digits;
}

export function normalizeEmail(v: string | null | undefined): string | null {
  const e = cleanStr(v);
  return e ? e.toLowerCase() : null;
}

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

export type ContactInput = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  website?: string | null;
  address?: Address;
  tags?: string[];
  source?: LeadSource | null;
  status?: ContactStatus;
  ownerUserId?: string | null;
  customFields?: Record<string, unknown>;
  note?: string | null;
};

export async function createContact(tx: Tx, scope: Scope, input: ContactInput): Promise<Contact> {
  const names = input.name ? splitName(input.name) : { firstName: input.firstName ?? '', lastName: input.lastName ?? '' };
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (!names.firstName && !names.lastName && !email && !phone) {
    throw new ValidationError('Give the contact a name, email or phone number.');
  }
  let companyId = input.companyId ?? null;
  if (!companyId && cleanStr(input.companyName)) {
    companyId = (await findOrCreateCompany(tx, scope, input.companyName!)).id;
  }
  const [row] = await tx.insert(contacts).values({
    subAccountId: scope.subAccountId,
    firstName: names.firstName,
    lastName: names.lastName,
    email,
    phone,
    companyId,
    jobTitle: cleanStr(input.jobTitle),
    website: cleanStr(input.website),
    address: input.address ?? {},
    tags: normalizeTags(input.tags ?? []),
    source: input.source ?? null,
    status: input.status ?? 'lead',
    ownerUserId: input.ownerUserId ?? scope.userId,
    customFields: input.customFields ?? {},
  }).returning();

  await logActivity(tx, scope, { contactId: row.id, entityType: 'contact', entityId: row.id, type: 'created', summary: 'Contact created' });
  await emit(tx, scope, 'contact.created', { entityType: 'contact', entityId: row.id, contactId: row.id, payload: { source: row.source } });
  if (row.status === 'customer') {
    await emit(tx, scope, 'customer.created', { entityType: 'contact', entityId: row.id, contactId: row.id });
  }
  for (const tag of row.tags) {
    await emit(tx, scope, 'tag.added', { entityType: 'contact', entityId: row.id, contactId: row.id, payload: { tag } });
  }
  if (cleanStr(input.note)) {
    await addNote(tx, scope, { entityType: 'contact', entityId: row.id, contactId: row.id, body: input.note! });
  }
  return row;
}

/** Match by email, then phone, inside this business only. Used by forms, inbound messages and Stripe. */
export async function findContactByIdentity(tx: Tx, scope: Scope, identity: { email?: string | null; phone?: string | null }) {
  const email = normalizeEmail(identity.email);
  const phone = normalizePhone(identity.phone);
  if (!email && !phone) return null;
  const conds = [];
  if (email) conds.push(eq(contacts.email, email));
  if (phone) conds.push(eq(contacts.phone, phone));
  const [row] = await tx.select().from(contacts)
    .where(and(eq(contacts.subAccountId, scope.subAccountId), or(...conds)))
    .orderBy(asc(contacts.createdAt)).limit(1);
  return row ?? null;
}

export async function findOrCreateContact(tx: Tx, scope: Scope, input: ContactInput): Promise<{ contact: Contact; created: boolean }> {
  const existing = await findContactByIdentity(tx, scope, input);
  if (existing) {
    const patch: Partial<Contact> = {};
    const names = input.name ? splitName(input.name) : { firstName: input.firstName ?? '', lastName: input.lastName ?? '' };
    if (!existing.firstName && names.firstName) patch.firstName = names.firstName;
    if (!existing.lastName && names.lastName) patch.lastName = names.lastName;
    if (!existing.email && input.email) patch.email = normalizeEmail(input.email);
    if (!existing.phone && input.phone) patch.phone = normalizePhone(input.phone);
    if (input.customFields && Object.keys(input.customFields).length) patch.customFields = { ...existing.customFields, ...input.customFields };
    let contact = existing;
    if (Object.keys(patch).length) {
      [contact] = await tx.update(contacts).set({ ...patch, updatedAt: new Date() }).where(byTenant(contacts, scope, existing.id)).returning();
    }
    if (input.tags?.length) contact = await addTags(tx, scope, contact.id, input.tags);
    return { contact, created: false };
  }
  return { contact: await createContact(tx, scope, input), created: true };
}

export async function updateContact(tx: Tx, scope: Scope, id: string, input: ContactInput): Promise<Contact> {
  const current = await getContact(tx, scope, id);
  const patch: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) Object.assign(patch, splitName(input.name));
  if (input.firstName !== undefined) patch.firstName = input.firstName;
  if (input.lastName !== undefined) patch.lastName = input.lastName;
  if (input.email !== undefined) patch.email = normalizeEmail(input.email);
  if (input.phone !== undefined) patch.phone = normalizePhone(input.phone);
  if (input.companyId !== undefined) patch.companyId = input.companyId;
  if (input.companyName) patch.companyId = (await findOrCreateCompany(tx, scope, input.companyName)).id;
  if (input.jobTitle !== undefined) patch.jobTitle = cleanStr(input.jobTitle);
  if (input.website !== undefined) patch.website = cleanStr(input.website);
  if (input.address !== undefined) patch.address = input.address;
  if (input.source !== undefined) patch.source = input.source;
  if (input.ownerUserId !== undefined) patch.ownerUserId = input.ownerUserId;
  if (input.customFields !== undefined) patch.customFields = { ...current.customFields, ...input.customFields };
  if (input.status !== undefined) patch.status = input.status;
  const [row] = await tx.update(contacts).set(patch).where(byTenant(contacts, scope, id)).returning();
  if (input.status === 'customer' && current.status !== 'customer') {
    await emit(tx, scope, 'customer.created', { entityType: 'contact', entityId: id, contactId: id });
    await logActivity(tx, scope, { contactId: id, entityType: 'contact', entityId: id, type: 'status', summary: 'Became a customer' });
  }
  if (input.tags !== undefined) return setTags(tx, scope, id, input.tags);
  return row;
}

export async function getContact(tx: Tx, scope: Scope, id: string): Promise<Contact> {
  const [row] = await tx.select().from(contacts).where(byTenant(contacts, scope, id));
  return must(row, 'Contact');
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
}

export async function addTags(tx: Tx, scope: Scope, contactId: string, tags: string[]): Promise<Contact> {
  const c = await getContact(tx, scope, contactId);
  const added = normalizeTags(tags).filter((t) => !c.tags.some((x) => x.toLowerCase() === t.toLowerCase()));
  if (!added.length) return c;
  const [row] = await tx.update(contacts).set({ tags: [...c.tags, ...added], updatedAt: new Date() })
    .where(byTenant(contacts, scope, contactId)).returning();
  for (const tag of added) await emit(tx, scope, 'tag.added', { entityType: 'contact', entityId: contactId, contactId, payload: { tag } });
  return row;
}

export async function removeTags(tx: Tx, scope: Scope, contactId: string, tags: string[]): Promise<Contact> {
  const c = await getContact(tx, scope, contactId);
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  const removed = c.tags.filter((t) => lower.has(t.toLowerCase()));
  if (!removed.length) return c;
  const [row] = await tx.update(contacts).set({ tags: c.tags.filter((t) => !lower.has(t.toLowerCase())), updatedAt: new Date() })
    .where(byTenant(contacts, scope, contactId)).returning();
  for (const tag of removed) await emit(tx, scope, 'tag.removed', { entityType: 'contact', entityId: contactId, contactId, payload: { tag } });
  return row;
}

export async function setTags(tx: Tx, scope: Scope, contactId: string, tags: string[]): Promise<Contact> {
  const c = await getContact(tx, scope, contactId);
  const next = normalizeTags(tags);
  const toRemove = c.tags.filter((t) => !next.includes(t));
  if (toRemove.length) await removeTags(tx, scope, contactId, toRemove);
  return addTags(tx, scope, contactId, next);
}

export async function touchContact(tx: Tx, scope: Scope, contactId: string | null | undefined, at = new Date()) {
  if (!contactId) return;
  await tx.update(contacts).set({ lastContactedAt: at }).where(byTenant(contacts, scope, contactId));
}

export async function archiveContact(tx: Tx, scope: Scope, id: string) {
  await tx.update(contacts).set({ archivedAt: new Date() }).where(byTenant(contacts, scope, id));
}

/* ------------------------------------------------------------------ */
/* Companies                                                           */
/* ------------------------------------------------------------------ */

export async function findOrCreateCompany(tx: Tx, scope: Scope, name: string) {
  const clean = name.trim();
  const [existing] = await tx.select().from(companies)
    .where(and(eq(companies.subAccountId, scope.subAccountId), ilike(companies.name, clean))).limit(1);
  if (existing) return existing;
  const [row] = await tx.insert(companies).values({ subAccountId: scope.subAccountId, name: clean }).returning();
  return row;
}

export async function createCompany(tx: Tx, scope: Scope, input: { name: string; email?: string | null; phone?: string | null; website?: string | null; abn?: string | null; address?: Address }) {
  if (!cleanStr(input.name)) throw new ValidationError('Company name is required.');
  const [row] = await tx.insert(companies).values({
    subAccountId: scope.subAccountId,
    name: input.name.trim(),
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    website: cleanStr(input.website),
    abn: cleanStr(input.abn),
    address: input.address ?? {},
  }).returning();
  return row;
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export async function addNote(tx: Tx, scope: Scope, input: { entityType: string; entityId: string; contactId?: string | null; body: string }) {
  const body = cleanStr(input.body);
  if (!body) throw new ValidationError('Note is empty.');
  const [row] = await tx.insert(notes).values({
    subAccountId: scope.subAccountId,
    entityType: input.entityType,
    entityId: input.entityId,
    contactId: input.contactId ?? null,
    body,
    authorUserId: scope.userId,
  }).returning();
  await logActivity(tx, scope, { contactId: input.contactId, entityType: input.entityType, entityId: input.entityId, type: 'note', summary: body.slice(0, 140) });
  return row;
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

export type LeadInput = ContactInput & {
  contactId?: string;
  title?: string | null;
  valueCents?: number;
  nextAction?: string | null;
  nextActionAt?: Date | null;
  notes?: string | null;
  assignedUserId?: string | null;
  formSubmissionId?: string | null;
};

export async function createLead(tx: Tx, scope: Scope, input: LeadInput) {
  const contact = input.contactId
    ? await getContact(tx, scope, input.contactId)
    : (await findOrCreateContact(tx, scope, { ...input, status: 'lead' })).contact;
  const [lead] = await tx.insert(leads).values({
    subAccountId: scope.subAccountId,
    contactId: contact.id,
    title: cleanStr(input.title),
    source: input.source ?? 'manual',
    valueCents: input.valueCents ?? 0,
    nextAction: cleanStr(input.nextAction) ?? 'Make first contact',
    nextActionAt: input.nextActionAt ?? new Date(),
    notes: cleanStr(input.notes),
    assignedUserId: input.assignedUserId ?? scope.userId,
    formSubmissionId: input.formSubmissionId ?? null,
  }).returning();
  await logActivity(tx, scope, { contactId: contact.id, entityType: 'lead', entityId: lead.id, type: 'lead', summary: `New lead from ${lead.source}` });
  await emit(tx, scope, 'lead.created', {
    entityType: 'lead', entityId: lead.id, contactId: contact.id,
    payload: { source: lead.source, valueCents: lead.valueCents },
  });
  return { lead, contact };
}

export async function updateLead(tx: Tx, scope: Scope, id: string, patch: Partial<{ status: LeadStatus; nextAction: string | null; nextActionAt: Date | null; valueCents: number; notes: string | null; assignedUserId: string | null; probability: number }>) {
  const extra: Partial<typeof leads.$inferInsert> = {};
  if (patch.status === 'contacted') extra.lastContactedAt = new Date();
  const [row] = await tx.update(leads).set({ ...patch, ...extra, updatedAt: new Date() }).where(byTenant(leads, scope, id)).returning();
  const lead = must(row, 'Lead');
  if (patch.status) {
    await logActivity(tx, scope, { contactId: lead.contactId, entityType: 'lead', entityId: id, type: 'status', summary: `Lead marked ${patch.status}` });
    if (patch.status === 'contacted') await touchContact(tx, scope, lead.contactId);
  }
  return lead;
}

/** Lead -> deal in the default pipeline. */
export async function convertLead(tx: Tx, scope: Scope, leadId: string, opts: { pipelineId?: string; stageId?: string; title?: string } = {}) {
  const [lead] = await tx.select().from(leads).where(byTenant(leads, scope, leadId));
  must(lead, 'Lead');
  if (lead.dealId) return { dealId: lead.dealId };
  const contact = await getContact(tx, scope, lead.contactId);
  const deal = await createDeal(tx, scope, {
    title: opts.title ?? lead.title ?? contactName(contact),
    contactId: lead.contactId,
    valueCents: lead.valueCents,
    pipelineId: opts.pipelineId,
    stageId: opts.stageId,
    source: lead.source,
  });
  await tx.update(leads).set({ status: 'converted', dealId: deal.id, updatedAt: new Date() }).where(byTenant(leads, scope, leadId));
  return { dealId: deal.id };
}

/* ------------------------------------------------------------------ */
/* Pipelines + deals                                                   */
/* ------------------------------------------------------------------ */

export const DEFAULT_STAGES: { name: string; kind: 'open' | 'won' | 'lost'; probability: number }[] = [
  { name: 'New Lead', kind: 'open', probability: 10 },
  { name: 'Contacted', kind: 'open', probability: 20 },
  { name: 'Qualified', kind: 'open', probability: 40 },
  { name: 'Appointment Booked', kind: 'open', probability: 60 },
  { name: 'Quote Sent', kind: 'open', probability: 75 },
  { name: 'Won', kind: 'won', probability: 100 },
  { name: 'Lost', kind: 'lost', probability: 0 },
];

export async function createPipeline(tx: Tx, scope: Scope, name: string, stages = DEFAULT_STAGES, isDefault = false) {
  const [pipeline] = await tx.insert(pipelines).values({ subAccountId: scope.subAccountId, name, isDefault }).returning();
  const stageRows = await tx.insert(pipelineStages).values(stages.map((s, i) => ({
    subAccountId: scope.subAccountId, pipelineId: pipeline.id, name: s.name, kind: s.kind, probability: s.probability, sortOrder: i,
  }))).returning();
  return { pipeline, stages: stageRows };
}

export async function getDefaultPipeline(tx: Tx, scope: Scope) {
  const rows = await tx.select().from(pipelines).where(eq(pipelines.subAccountId, scope.subAccountId))
    .orderBy(sql`${pipelines.isDefault} desc`, asc(pipelines.sortOrder), asc(pipelines.createdAt)).limit(1);
  if (rows[0]) return rows[0];
  return (await createPipeline(tx, scope, 'Sales', DEFAULT_STAGES, true)).pipeline;
}

export async function getStages(tx: Tx, scope: Scope, pipelineId: string) {
  return tx.select().from(pipelineStages)
    .where(and(eq(pipelineStages.subAccountId, scope.subAccountId), eq(pipelineStages.pipelineId, pipelineId)))
    .orderBy(asc(pipelineStages.sortOrder));
}

export type DealInput = {
  title: string;
  contactId?: string | null;
  companyId?: string | null;
  pipelineId?: string;
  stageId?: string;
  valueCents?: number;
  expectedCloseDate?: string | null;
  assignedUserId?: string | null;
  source?: LeadSource | null;
  probability?: number | null;
};

export async function createDeal(tx: Tx, scope: Scope, input: DealInput): Promise<Deal> {
  if (!cleanStr(input.title)) throw new ValidationError('Deal needs a title.');
  const pipelineId = input.pipelineId ?? (await getDefaultPipeline(tx, scope)).id;
  const stages = await getStages(tx, scope, pipelineId);
  const stage = stages.find((s) => s.id === input.stageId) ?? stages[0];
  if (!stage) throw new ValidationError('Pipeline has no stages.');
  const [deal] = await tx.insert(deals).values({
    subAccountId: scope.subAccountId,
    pipelineId,
    stageId: stage.id,
    title: input.title.trim(),
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    valueCents: input.valueCents ?? 0,
    probability: input.probability ?? stage.probability,
    expectedCloseDate: input.expectedCloseDate ?? null,
    assignedUserId: input.assignedUserId ?? scope.userId,
    source: input.source ?? null,
    status: stage.kind === 'open' ? 'open' : stage.kind,
  }).returning();
  await logActivity(tx, scope, { contactId: deal.contactId, entityType: 'deal', entityId: deal.id, type: 'deal', summary: `Deal created: ${deal.title}` });
  await emit(tx, scope, 'deal.created', { entityType: 'deal', entityId: deal.id, contactId: deal.contactId, payload: { stageId: stage.id, pipelineId, valueCents: deal.valueCents } });
  return deal;
}

export async function getDeal(tx: Tx, scope: Scope, id: string): Promise<Deal> {
  const [row] = await tx.select().from(deals).where(byTenant(deals, scope, id));
  return must(row, 'Deal');
}

export async function moveDeal(tx: Tx, scope: Scope, dealId: string, stageId: string, opts: { lostReason?: string } = {}): Promise<Deal> {
  const deal = await getDeal(tx, scope, dealId);
  if (deal.stageId === stageId) return deal;
  const [stage] = await tx.select().from(pipelineStages)
    .where(and(eq(pipelineStages.subAccountId, scope.subAccountId), eq(pipelineStages.id, stageId), eq(pipelineStages.pipelineId, deal.pipelineId)));
  must(stage, 'Stage');
  const now = new Date();
  const [updated] = await tx.update(deals).set({
    stageId,
    status: stage.kind === 'open' ? 'open' : stage.kind,
    probability: stage.probability,
    stageChangedAt: now,
    wonAt: stage.kind === 'won' ? now : null,
    lostAt: stage.kind === 'lost' ? now : null,
    lostReason: stage.kind === 'lost' ? (opts.lostReason ?? deal.lostReason) : null,
    updatedAt: now,
  }).where(byTenant(deals, scope, dealId)).returning();
  await logActivity(tx, scope, { contactId: deal.contactId, entityType: 'deal', entityId: dealId, type: 'stage', summary: `Moved to ${stage.name}` });
  await emit(tx, scope, 'deal.stage_changed', {
    entityType: 'deal', entityId: dealId, contactId: deal.contactId,
    payload: { fromStageId: deal.stageId, toStageId: stageId, stageName: stage.name, kind: stage.kind },
  });
  if (stage.kind === 'won') {
    await emit(tx, scope, 'deal.won', { entityType: 'deal', entityId: dealId, contactId: deal.contactId, payload: { valueCents: deal.valueCents } });
    if (deal.contactId) {
      const c = await getContact(tx, scope, deal.contactId);
      if (c.status !== 'customer') await updateContact(tx, scope, c.id, { status: 'customer' });
    }
  }
  if (stage.kind === 'lost') await emit(tx, scope, 'deal.lost', { entityType: 'deal', entityId: dealId, contactId: deal.contactId });
  return updated;
}

/** Move a deal to the first stage of a given kind (e.g. mark won when a quote is accepted). */
export async function markDealOutcome(tx: Tx, scope: Scope, dealId: string, kind: 'won' | 'lost') {
  const deal = await getDeal(tx, scope, dealId);
  const stages = await getStages(tx, scope, deal.pipelineId);
  const target = stages.find((s) => s.kind === kind);
  if (target) return moveDeal(tx, scope, dealId, target.id);
  return deal;
}

export async function moveDealToStageNamed(tx: Tx, scope: Scope, dealId: string, stageName: string) {
  const deal = await getDeal(tx, scope, dealId);
  const stages = await getStages(tx, scope, deal.pipelineId);
  const target = stages.find((s) => s.name.toLowerCase() === stageName.toLowerCase());
  if (!target) throw new ValidationError(`No stage called "${stageName}"`);
  return moveDeal(tx, scope, dealId, target.id);
}

export async function updateDeal(tx: Tx, scope: Scope, id: string, patch: Partial<Pick<Deal, 'title' | 'valueCents' | 'expectedCloseDate' | 'assignedUserId' | 'contactId' | 'probability' | 'customFields'>>) {
  const [row] = await tx.update(deals).set({ ...patch, updatedAt: new Date() }).where(byTenant(deals, scope, id)).returning();
  return must(row, 'Deal');
}

/* ------------------------------------------------------------------ */
/* Custom fields                                                       */
/* ------------------------------------------------------------------ */

export type CustomFieldDef = typeof customFieldDefinitions.$inferSelect;

export async function listCustomFields(tx: Tx, scope: Scope, entityType?: CustomFieldDef['entityType']) {
  const conds = [eq(customFieldDefinitions.subAccountId, scope.subAccountId)];
  if (entityType) conds.push(eq(customFieldDefinitions.entityType, entityType));
  return tx.select().from(customFieldDefinitions).where(and(...conds)).orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label));
}

export function fieldKey(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'field';
}

export async function defineCustomField(tx: Tx, scope: Scope, input: { entityType: CustomFieldDef['entityType']; label: string; fieldType?: CustomFieldDef['fieldType']; options?: string[]; required?: boolean }) {
  const label = cleanStr(input.label);
  if (!label) throw new ValidationError('Field needs a label.');
  const [row] = await tx.insert(customFieldDefinitions).values({
    subAccountId: scope.subAccountId,
    entityType: input.entityType,
    key: fieldKey(label),
    label,
    fieldType: input.fieldType ?? 'text',
    options: input.options ?? [],
    required: input.required ?? false,
  }).onConflictDoNothing().returning();
  return row;
}

/** Coerce raw form values into the declared types, dropping unknown keys. */
export function coerceCustomFields(defs: CustomFieldDef[], raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    if (!(d.key in raw)) continue;
    const v = raw[d.key];
    if (v === '' || v === null || v === undefined) { out[d.key] = null; continue; }
    switch (d.fieldType) {
      case 'number': { const n = Number(v); out[d.key] = Number.isFinite(n) ? n : null; break; }
      case 'checkbox': out[d.key] = v === true || v === 'true' || v === 'on' || v === '1'; break;
      case 'multiselect': out[d.key] = Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()).filter(Boolean); break;
      default: out[d.key] = String(v);
    }
  }
  return out;
}
