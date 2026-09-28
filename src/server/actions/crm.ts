'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { leads } from '@/db/schema';
import { parseMoney } from '@/lib/money';
import { zonedTimeToUtc } from '@/lib/dates';
import { inBusiness, requireContext } from '@/server/context';
import {
  addNote, addTags, archiveContact, coerceCustomFields, convertLead, createCompany, createDeal, listCustomFields, moveDeal, removeTags,
  updateContact, updateDeal, updateLead, defineCustomField,
} from '@/server/services/crm';
import { logCall } from '@/server/services/comms';
import { attempt, optStr, str } from './_util';

export async function updateContactAction(fd: FormData) {
  const ctx = await requireContext();
  const id = str(fd, 'id');
  const subAccountId = str(fd, 'subAccountId');
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const defs = await listCustomFields(tx, s, 'contact');
    const raw: Record<string, unknown> = {};
    for (const d of defs) {
      const all = fd.getAll(`cf_${d.key}`).map(String);
      if (fd.has(`cf_${d.key}`) || d.fieldType === 'checkbox') raw[d.key] = d.fieldType === 'multiselect' ? all : d.fieldType === 'checkbox' ? fd.get(`cf_${d.key}`) === 'on' : all[0] ?? '';
    }
    await updateContact(tx, s, id, {
      firstName: str(fd, 'firstName'), lastName: str(fd, 'lastName'), email: optStr(fd, 'email'), phone: optStr(fd, 'phone'),
      website: optStr(fd, 'website'), jobTitle: optStr(fd, 'jobTitle'), companyName: optStr(fd, 'company') ?? undefined,
      status: (optStr(fd, 'status') ?? undefined) as never, source: (optStr(fd, 'source') ?? undefined) as never,
      address: { line1: str(fd, 'line1'), suburb: str(fd, 'suburb'), state: str(fd, 'state'), postcode: str(fd, 'postcode') },
      customFields: coerceCustomFields(defs, raw),
    });
  }), 'Saved');
  revalidatePath(`/contacts/${id}`);
  return res;
}

export async function addNoteAction(subAccountId: string, contactId: string, body: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => addNote(tx, s, { entityType: 'contact', entityId: contactId, contactId, body })).then(() => undefined), 'Note added');
  revalidatePath(`/contacts/${contactId}`);
  return res;
}

export async function logCallAction(subAccountId: string, contactId: string, summary: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => logCall(tx, s, { contactId, direction: 'outbound', summary })).then(() => undefined), 'Call logged');
  revalidatePath(`/contacts/${contactId}`);
  return res;
}

export async function tagAction(subAccountId: string, contactId: string, tag: string, remove = false) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => (remove ? removeTags(tx, s, contactId, [tag]) : addTags(tx, s, contactId, [tag]))).then(() => undefined));
  revalidatePath(`/contacts/${contactId}`);
  return res;
}

export async function archiveContactAction(subAccountId: string, contactId: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => archiveContact(tx, s, contactId)), 'Archived');
  revalidatePath('/contacts');
  return res;
}

export async function createCompanyAction(fd: FormData) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, str(fd, 'subAccountId'), (tx, s) => createCompany(tx, s, { name: str(fd, 'name'), email: optStr(fd, 'email'), phone: optStr(fd, 'phone'), abn: optStr(fd, 'abn'), website: optStr(fd, 'website') })).then(() => undefined), 'Company added');
  revalidatePath('/contacts');
  return res;
}

export async function leadStatusAction(subAccountId: string, leadId: string, status: 'new' | 'contacted' | 'qualified' | 'unqualified') {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => updateLead(tx, s, leadId, { status })).then(() => undefined), 'Updated');
  revalidatePath('/leads');
  revalidatePath('/', 'layout');
  return res;
}

export async function leadNextActionAction(fd: FormData) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, str(fd, 'subAccountId'), async (tx, s) => {
    const date = str(fd, 'nextActionAt');
    const tz = ctx.businesses.find((b) => b.id === s.subAccountId)?.timezone ?? ctx.tz;
    const [y, m, d] = date.split('-').map(Number);
    await updateLead(tx, s, str(fd, 'leadId'), { nextAction: optStr(fd, 'nextAction'), nextActionAt: date ? zonedTimeToUtc(y, m, d, 9, 0, tz) : null, valueCents: parseMoney(str(fd, 'value')) ?? undefined });
  }), 'Saved');
  revalidatePath('/leads');
  return res;
}

export async function convertLeadAction(subAccountId: string, leadId: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => convertLead(tx, s, leadId)), 'Moved to pipeline');
  revalidatePath('/leads');
  revalidatePath('/pipeline');
  return res;
}

export async function moveDealAction(subAccountId: string, dealId: string, stageId: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => moveDeal(tx, s, dealId, stageId)).then(() => undefined));
  revalidatePath('/pipeline');
  revalidatePath('/', 'layout');
  return res;
}

export async function saveDealAction(fd: FormData) {
  const ctx = await requireContext();
  const id = optStr(fd, 'id');
  const res = await attempt(() => inBusiness(ctx, str(fd, 'subAccountId'), async (tx, s) => {
    const valueCents = parseMoney(str(fd, 'value')) ?? 0;
    if (id) await updateDeal(tx, s, id, { title: str(fd, 'title'), valueCents, expectedCloseDate: optStr(fd, 'expectedCloseDate') });
    else await createDeal(tx, s, { title: str(fd, 'title'), contactId: optStr(fd, 'contactId'), valueCents, pipelineId: optStr(fd, 'pipelineId') ?? undefined, stageId: optStr(fd, 'stageId') ?? undefined, expectedCloseDate: optStr(fd, 'expectedCloseDate') });
  }), 'Saved');
  revalidatePath('/pipeline');
  return res;
}

export async function defineFieldAction(fd: FormData) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, str(fd, 'subAccountId'), (tx, s) => defineCustomField(tx, s, {
    entityType: (str(fd, 'entityType') || 'contact') as never, label: str(fd, 'label'), fieldType: (str(fd, 'fieldType') || 'text') as never,
    options: str(fd, 'options').split(',').map((o) => o.trim()).filter(Boolean),
  })).then(() => undefined), 'Field added');
  revalidatePath('/settings/fields');
  return res;
}

export async function deleteLeadAction(subAccountId: string, leadId: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => { await tx.delete(leads).where(and(eq(leads.subAccountId, s.subAccountId), eq(leads.id, leadId))); }), 'Lead removed');
  revalidatePath('/leads');
  return res;
}
