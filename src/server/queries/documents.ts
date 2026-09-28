import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { activities, companies, contacts, invoiceLineItems, invoices, payments, quoteLineItems, quotes, subAccounts } from '@/db/schema';
import { contactName } from '@/server/services/crm';

async function party(tx: Tx, subAccountId: string, contactId: string | null) {
  if (!contactId) return { contact: null, customer: null };
  const [c] = await tx.select().from(contacts).where(and(eq(contacts.subAccountId, subAccountId), eq(contacts.id, contactId)));
  if (!c) return { contact: null, customer: null };
  const [co] = c.companyId ? await tx.select().from(companies).where(and(eq(companies.subAccountId, subAccountId), eq(companies.id, c.companyId))) : [];
  return { contact: c, customer: { name: contactName(c), company: co?.name ?? null, email: c.email, phone: c.phone, address: (co?.address && Object.keys(co.address).length ? co.address : c.address) as Record<string, string>, abn: co?.abn ?? null } };
}

/** Everything needed to render an invoice. RLS decides whether it's visible at all. */
export async function loadInvoice(tx: Tx, where: { id?: string; token?: string }) {
  const [inv] = await tx.select().from(invoices).where(where.id ? eq(invoices.id, where.id) : eq(invoices.publicToken, where.token!));
  if (!inv) return null;
  const [business] = await tx.select().from(subAccounts).where(eq(subAccounts.id, inv.subAccountId));
  const lines = await tx.select().from(invoiceLineItems).where(and(eq(invoiceLineItems.subAccountId, inv.subAccountId), eq(invoiceLineItems.invoiceId, inv.id))).orderBy(asc(invoiceLineItems.sortOrder));
  const pays = await tx.select().from(payments).where(and(eq(payments.subAccountId, inv.subAccountId), eq(payments.invoiceId, inv.id))).orderBy(desc(payments.createdAt));
  const log = await tx.select().from(activities).where(and(eq(activities.subAccountId, inv.subAccountId), eq(activities.entityId, inv.id))).orderBy(desc(activities.createdAt)).limit(20);
  return { inv, business, lines, payments: pays, log, ...(await party(tx, inv.subAccountId, inv.contactId)) };
}

export async function loadQuote(tx: Tx, where: { id?: string; token?: string }) {
  const [q] = await tx.select().from(quotes).where(where.id ? eq(quotes.id, where.id) : eq(quotes.publicToken, where.token!));
  if (!q) return null;
  const [business] = await tx.select().from(subAccounts).where(eq(subAccounts.id, q.subAccountId));
  const lines = await tx.select().from(quoteLineItems).where(and(eq(quoteLineItems.subAccountId, q.subAccountId), eq(quoteLineItems.quoteId, q.id))).orderBy(asc(quoteLineItems.sortOrder));
  const log = await tx.select().from(activities).where(and(eq(activities.subAccountId, q.subAccountId), eq(activities.entityId, q.id))).orderBy(desc(activities.createdAt)).limit(20);
  return { q, business, lines, log, ...(await party(tx, q.subAccountId, q.contactId)) };
}
