'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, ilike, isNull, or, sql } from 'drizzle-orm';
import { withContext } from '@/db/context';
import { pgArray } from '@/db/sql';
import { companies, contacts } from '@/db/schema';
import { parseCommand, type ParsedCommand } from '@/lib/commands/parse';
import { tzOffsetMinutes } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { AU_GST } from '@/lib/tax';
import { BUSINESS_COOKIE, businessById, can, inBusiness, readScope, requireContext, type AppContext } from '@/server/context';
import type { Permission } from '@/lib/permissions';
import { contactName, createContact, createLead } from '@/server/services/crm';
import { createInvoice, createQuote } from '@/server/services/finance';
import { createAppointment, createTask } from '@/server/services/work';
import { globalSearch, type SearchResult } from '@/server/queries/search';
import { friendlyError } from './_util';

export async function switchBusiness(idOrAll: string) {
  const ctx = await requireContext();
  const jar = await cookies();
  if (idOrAll === 'all' || !ctx.businesses.some((b) => b.id === idOrAll)) jar.set(BUSINESS_COOKIE, 'all', { path: '/', sameSite: 'lax', httpOnly: true });
  else jar.set(BUSINESS_COOKIE, idOrAll, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}

export type SearchHit = SearchResult & { business: { name: string; shortName: string | null; color: string } | null };

export async function searchAction(q: string): Promise<SearchHit[]> {
  const ctx = await requireContext();
  const results = await readScope(ctx, (tx) => globalSearch(tx, ctx.scopeIds, q));
  return results.map((r) => {
    const b = businessById(ctx, r.subAccountId);
    return { ...r, business: b ? { name: b.name, shortName: b.shortName, color: b.color } : null };
  });
}

export type ClarifyOption = { label: string; sublabel?: string; color?: string; pick: { contactId?: string; subAccountId?: string; createContact?: boolean } };

export type CommandOutcome =
  | { kind: 'done'; message: string; href?: string }
  | { kind: 'navigate'; href: string }
  | { kind: 'clarify'; question: string; options: ClarifyOption[] }
  | { kind: 'ask'; question: string }
  | { kind: 'search'; query: string }
  | { kind: 'error'; message: string };

type Pick = { contactId?: string; subAccountId?: string; createContact?: boolean };

async function findPeople(ctx: AppContext, who: string) {
  const ids = ctx.scopeIds;
  const like = `%${who.trim().replace(/\s+/g, '%')}%`;
  return readScope(ctx, async (tx) => {
    const byName = await tx.select({ c: contacts }).from(contacts).where(and(
      sql`${contacts.subAccountId} = any(${pgArray(ids)})`, isNull(contacts.archivedAt),
      or(ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, like), ilike(contacts.email, like)),
    )).limit(8);
    if (byName.length) return byName.map((r) => r.c);
    // "ABC Builders" -> people at that company
    const cos = await tx.select().from(companies).where(and(sql`${companies.subAccountId} = any(${pgArray(ids)})`, ilike(companies.name, like))).limit(3);
    if (!cos.length) return [];
    return tx.select().from(contacts).where(sql`${contacts.companyId} = any(${pgArray(cos.map((c) => c.id))})`).limit(8);
  });
}

/** Resolve "John" to exactly one contact, or return a clarifying question. */
async function resolveContact(ctx: AppContext, who: string, pick: Pick, action: string): Promise<{ contactId: string; subAccountId: string } | CommandOutcome> {
  if (pick.contactId && pick.subAccountId) return { contactId: pick.contactId, subAccountId: pick.subAccountId };
  if (pick.createContact) {
    const subAccountId = pick.subAccountId ?? ctx.current?.id;
    if (!subAccountId) return chooseBusiness(ctx, `Which business is ${who} a customer of?`, { createContact: true }, 'contacts.edit');
    const c = await inBusiness(ctx, subAccountId, 'contacts.edit', (tx, s) => createContact(tx, s, { name: who }));
    return { contactId: c.id, subAccountId };
  }
  const people = await findPeople(ctx, who);
  if (people.length === 1) return { contactId: people[0].id, subAccountId: people[0].subAccountId };
  const options: ClarifyOption[] = people.map((p) => {
    const b = businessById(ctx, p.subAccountId);
    return { label: contactName(p), sublabel: [b?.name, p.email ?? p.phone].filter(Boolean).join(' · '), color: b?.color, pick: { contactId: p.id, subAccountId: p.subAccountId } };
  });
  // Keep the list short: with matches, offer one "someone new" option (asks for the business next).
  if (people.length && !ctx.current) options.push({ label: `Someone new called "${who}"`, sublabel: 'Create a new contact', pick: { createContact: true } });
  else for (const b of ctx.current ? [ctx.current] : ctx.businesses) options.push({ label: `New contact "${who}"`, sublabel: `in ${b.name}`, color: b.color, pick: { createContact: true, subAccountId: b.id } });
  return { kind: 'clarify', question: people.length ? `Which ${who} do you mean for this ${action}?` : `No one called "${who}" yet. Create them?`, options };
}

function chooseBusiness(ctx: AppContext, question: string, extra: Pick = {}, perm?: Permission): CommandOutcome {
  const options = ctx.businesses.filter((b) => !perm || can(ctx, perm, b.id));
  if (!options.length) return { kind: 'error', message: 'Your role doesn’t allow that in any business.' };
  return { kind: 'clarify', question, options: options.map((b) => ({ label: b.name, color: b.color, pick: { ...extra, subAccountId: b.id } })) };
}

/**
 * Execute a command from the palette. Anything financial is created as a DRAFT and
 * opened for review, so nothing reaches a customer without a human looking at it.
 */
export async function runCommandAction(input: string | ParsedCommand, pick: Pick = {}): Promise<CommandOutcome> {
  const ctx = await requireContext();
  const tz = ctx.current?.timezone ?? ctx.tz;
  const cmd = typeof input === 'string' ? parseCommand(input, { now: new Date(), tzOffsetMinutes: tzOffsetMinutes(new Date(), tz) }) : input;
  try {
    switch (cmd.intent) {
      case 'navigate': return { kind: 'navigate', href: cmd.href };
      case 'search': return { kind: 'search', query: cmd.query };
      case 'ask': return { kind: 'ask', question: cmd.question };
      case 'switch_business': {
        if (cmd.query === 'all') { await switchBusiness('all'); return { kind: 'navigate', href: '/' }; }
        const q = cmd.query.toLowerCase();
        const matches = ctx.businesses.filter((b) => b.name.toLowerCase().includes(q) || (b.shortName ?? '').toLowerCase() === q || b.slug.includes(q.replace(/\s+/g, '-')));
        if (matches.length === 1) { await switchBusiness(matches[0].id); return { kind: 'done', message: `Opened ${matches[0].name}`, href: '/' }; }
        if (!matches.length) return { kind: 'search', query: cmd.query };
        return { kind: 'clarify', question: 'Which business?', options: matches.map((b) => ({ label: b.name, color: b.color, pick: { subAccountId: b.id } })) };
      }
      case 'create_invoice':
      case 'create_quote': {
        const r = await resolveContact(ctx, cmd.who, pick, cmd.intent === 'create_invoice' ? 'invoice' : 'quote');
        if ('kind' in r) return r;
        const b = businessById(ctx, r.subAccountId)!;
        const pricesIncludeTax = cmd.gst === 'inc' ? true : cmd.gst === 'plus' ? false : undefined;
        const line = { description: cmd.description ?? (cmd.intent === 'create_invoice' ? 'Services' : 'Quoted works'), quantity: 1, unitPriceCents: cmd.amountCents, taxCode: b.taxRegime === 'AU_GST' ? AU_GST.defaultCode : undefined };
        if (cmd.intent === 'create_invoice') {
          const inv = await inBusiness(ctx, r.subAccountId, 'invoices.edit', (tx, s) => createInvoice(tx, s, { contactId: r.contactId, lines: [line], pricesIncludeTax }), { visible: [['contacts', r.contactId]] });
          revalidatePath('/invoices');
          return { kind: 'done', message: `Draft invoice ${inv.number} for ${formatMoney(inv.totalCents)} created in ${b.name}. Review and send.`, href: `/invoices/${inv.id}` };
        }
        const q = await inBusiness(ctx, r.subAccountId, 'quotes.edit', (tx, s) => createQuote(tx, s, { contactId: r.contactId, lines: [line], pricesIncludeTax }), { visible: [['contacts', r.contactId]] });
        revalidatePath('/quotes');
        return { kind: 'done', message: `Draft quote ${q.number} for ${formatMoney(q.totalCents)} created in ${b.name}.`, href: `/quotes/${q.id}` };
      }
      case 'create_task': {
        let contactId: string | undefined;
        let subAccountId = pick.subAccountId ?? ctx.current?.id;
        if (cmd.who && !pick.subAccountId) {
          const people = await findPeople(ctx, cmd.who);
          if (people.length === 1) { contactId = people[0].id; subAccountId = people[0].subAccountId; }
        } else if (pick.contactId) contactId = pick.contactId;
        if (!subAccountId) return chooseBusiness(ctx, 'Which business is this task for?', {}, 'tasks.edit');
        const due = cmd.due ? new Date(cmd.due) : undefined;
        const b = businessById(ctx, subAccountId)!;
        await inBusiness(ctx, subAccountId, 'tasks.edit', (tx, s) => createTask(tx, s, { title: cmd.title, dueAt: due, allDay: cmd.allDay, contactId, source: 'manual' }), { visible: [['contacts', contactId]] });
        revalidatePath('/', 'layout');
        return { kind: 'done', message: `Task added to ${b.name}: ${cmd.title}`, href: '/tasks' };
      }
      case 'book_appointment': {
        let contactId: string | undefined;
        let subAccountId = pick.subAccountId ?? ctx.current?.id;
        if (cmd.who) {
          const r = await resolveContact(ctx, cmd.who, pick, 'appointment');
          if ('kind' in r) return r;
          contactId = r.contactId;
          subAccountId = r.subAccountId;
        }
        if (!subAccountId) return chooseBusiness(ctx, 'Which business is this appointment for?', {}, 'calendar.edit');
        await inBusiness(ctx, subAccountId, 'calendar.edit', (tx, s) => createAppointment(tx, s, { title: cmd.title, startsAt: new Date(cmd.start), durationMinutes: cmd.durationMinutes, contactId }), { visible: [['contacts', contactId]] });
        revalidatePath('/calendar');
        return { kind: 'done', message: `Booked: ${cmd.title}`, href: `/calendar` };
      }
      case 'create_contact':
      case 'create_lead': {
        const subAccountId = pick.subAccountId ?? ctx.current?.id;
        if (!subAccountId) return chooseBusiness(ctx, `Which business is ${cmd.name || 'this person'} for?`, {}, cmd.intent === 'create_lead' ? 'sales.edit' : 'contacts.edit');
        const b = businessById(ctx, subAccountId)!;
        if (cmd.intent === 'create_lead') {
          const { contact } = await inBusiness(ctx, subAccountId, 'sales.edit', (tx, s) => createLead(tx, s, { name: cmd.name, email: cmd.email, phone: cmd.phone, source: (cmd.source ?? 'manual') as never }));
          revalidatePath('/', 'layout');
          return { kind: 'done', message: `Lead added to ${b.name}: ${contactName(contact)}`, href: `/contacts/${contact.id}` };
        }
        const c = await inBusiness(ctx, subAccountId, 'contacts.edit', (tx, s) => createContact(tx, s, { name: cmd.name, email: cmd.email, phone: cmd.phone, source: (cmd.source ?? 'manual') as never }));
        return { kind: 'done', message: `Contact added to ${b.name}: ${contactName(c)}`, href: `/contacts/${c.id}` };
      }
    }
  } catch (e) {
    return { kind: 'error', message: friendlyError(e) };
  }
}
