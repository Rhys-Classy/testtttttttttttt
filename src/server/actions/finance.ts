'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, and } from 'drizzle-orm';
import { contacts, invoices } from '@/db/schema';
import { parseMoney } from '@/lib/money';
import { inBusiness, requireContext } from '@/server/context';
import {
  acceptQuote, balanceDue, cancelInvoice, createInvoice, createInvoiceFromQuote, createProduct, createQuote, getInvoice,
  invoiceUrl, recordManualPayment, rejectQuote, sendInvoice, sendQuote, updateInvoiceLines, updateProduct, updateQuoteLines,
  type LineItemInput,
} from '@/server/services/finance';
import { queueMessage } from '@/server/services/comms';
import { formatMoney } from '@/lib/money';
import { ValidationError } from '@/server/services/_common';
import { attempt, num, optStr, str } from './_util';

/** Line items arrive as JSON from the editor. */
function parseLines(fd: FormData): LineItemInput[] {
  const raw = str(fd, 'lines');
  let arr: unknown;
  try { arr = JSON.parse(raw || '[]'); } catch { throw new ValidationError('Line items are invalid.'); }
  if (!Array.isArray(arr)) throw new ValidationError('Line items are invalid.');
  return arr
    .filter((l) => l && (String(l.description ?? '').trim() || Number(l.unitPrice)))
    .map((l) => ({
      productId: l.productId || null,
      description: String(l.description ?? '').trim() || 'Item',
      quantity: Number(l.quantity) || 0,
      unitPriceCents: parseMoney(String(l.unitPrice ?? '0')) ?? 0,
      discountPercent: Number(l.discountPercent) || 0,
      taxCode: String(l.taxCode || 'GST'),
    }));
}

export async function saveInvoiceAction(fd: FormData) {
  const ctx = await requireContext();
  const id = optStr(fd, 'id');
  const subAccountId = str(fd, 'subAccountId');
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const input = {
      contactId: str(fd, 'contactId'), title: optStr(fd, 'title'), lines: parseLines(fd), notes: optStr(fd, 'notes'), terms: optStr(fd, 'terms'),
      dueDate: optStr(fd, 'dueDate') ?? undefined, issueDate: optStr(fd, 'issueDate') ?? undefined, pricesIncludeTax: str(fd, 'pricesIncludeTax') === 'true',
    };
    if (!input.contactId) throw new ValidationError('Pick a customer.');
    return id ? updateInvoiceLines(tx, s, id, input) : createInvoice(tx, s, input);
  }));
  if (!res.ok) return res;
  revalidatePath('/invoices');
  if (str(fd, 'intent') === 'send') {
    const sent = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => sendInvoice(tx, s, res.data!.id)));
    if (!sent.ok) return sent;
  }
  redirect(`/invoices/${res.data!.id}`);
}

export async function sendInvoiceAction(subAccountId: string, id: string, channel?: 'email' | 'sms') {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    const r = await inBusiness(ctx, subAccountId, (tx, s) => sendInvoice(tx, s, id, { channel }));
    return { link: r.link, delivered: r.delivered };
  }, 'Invoice sent');
  revalidatePath(`/invoices/${id}`);
  revalidatePath('/invoices');
  return res;
}

export async function sendReminderAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const inv = await getInvoice(tx, s, id);
    if (!inv.contactId) throw new ValidationError('This invoice has no customer.');
    const [c] = await tx.select().from(contacts).where(and(eq(contacts.subAccountId, s.subAccountId), eq(contacts.id, inv.contactId)));
    const channel = c?.email ? 'email' : 'sms';
    await queueMessage(tx, s, {
      contactId: inv.contactId, channel,
      subject: `Reminder: invoice ${inv.number}`,
      body: `Hi ${c?.firstName || 'there'}, a friendly reminder that invoice ${inv.number} (${formatMoney(balanceDue(inv), inv.currency)}) was due ${inv.dueDate}. Pay online: ${invoiceUrl(inv.publicToken)}`,
    });
    await tx.update(invoices).set({ lastReminderAt: new Date(), reminderCount: inv.reminderCount + 1 }).where(and(eq(invoices.subAccountId, s.subAccountId), eq(invoices.id, id)));
  }), 'Reminder sent');
  revalidatePath('/', 'layout');
  return res;
}

export async function recordPaymentAction(fd: FormData) {
  const ctx = await requireContext();
  const subAccountId = str(fd, 'subAccountId');
  const invoiceId = str(fd, 'invoiceId');
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const inv = await getInvoice(tx, s, invoiceId);
    const amount = parseMoney(str(fd, 'amount')) ?? balanceDue(inv);
    return recordManualPayment(tx, s, { invoiceId, amountCents: amount, method: str(fd, 'method') || 'bank_transfer', reference: optStr(fd, 'reference'), paidAt: optStr(fd, 'paidAt') ? new Date(str(fd, 'paidAt')) : undefined });
  }).then(() => undefined), 'Payment recorded');
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath('/', 'layout');
  return res;
}

export async function cancelInvoiceAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => cancelInvoice(tx, s, id)).then(() => undefined), 'Invoice cancelled');
  revalidatePath(`/invoices/${id}`);
  return res;
}

export async function saveQuoteAction(fd: FormData) {
  const ctx = await requireContext();
  const id = optStr(fd, 'id');
  const subAccountId = str(fd, 'subAccountId');
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const deposit = num(fd, 'depositPercent');
    const input = {
      contactId: str(fd, 'contactId'), title: optStr(fd, 'title'), lines: parseLines(fd), notes: optStr(fd, 'notes'), terms: optStr(fd, 'terms'),
      expiryDate: optStr(fd, 'expiryDate'), pricesIncludeTax: str(fd, 'pricesIncludeTax') === 'true', dealId: optStr(fd, 'dealId'),
      acceptOptions: { createJob: str(fd, 'createJob') === 'on', createInvoice: str(fd, 'createInvoice') === 'on', markDealWon: true, depositPercent: deposit ?? undefined },
    };
    if (!input.contactId) throw new ValidationError('Pick a customer.');
    return id ? updateQuoteLines(tx, s, id, input) : createQuote(tx, s, input);
  }));
  if (!res.ok) return res;
  revalidatePath('/quotes');
  if (str(fd, 'intent') === 'send') {
    const sent = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => sendQuote(tx, s, res.data!.id)));
    if (!sent.ok) return sent;
  }
  redirect(`/quotes/${res.data!.id}`);
}

export async function sendQuoteAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    const r = await inBusiness(ctx, subAccountId, (tx, s) => sendQuote(tx, s, id));
    return { link: r.link, emailed: r.emailed };
  }, 'Quote sent');
  revalidatePath(`/quotes/${id}`);
  return res;
}

export async function acceptQuoteAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    const r = await inBusiness(ctx, subAccountId, (tx, s) => acceptQuote(tx, s, id, { acceptedByName: `${ctx.user.name} (marked in app)` }));
    return { jobId: r.jobId, invoiceId: r.invoiceId };
  }, 'Quote accepted');
  revalidatePath(`/quotes/${id}`);
  revalidatePath('/', 'layout');
  return res;
}

export async function rejectQuoteAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => rejectQuote(tx, s, id, 'Marked declined in app')).then(() => undefined), 'Quote marked declined');
  revalidatePath(`/quotes/${id}`);
  return res;
}

export async function invoiceFromQuoteAction(subAccountId: string, quoteId: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => createInvoiceFromQuote(tx, s, quoteId)));
  if (!res.ok) return res;
  redirect(`/invoices/${res.data!.id}`);
}

export async function saveProductAction(fd: FormData) {
  const ctx = await requireContext();
  const id = optStr(fd, 'id');
  const subAccountId = str(fd, 'subAccountId');
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const input = {
      name: str(fd, 'name'), sku: optStr(fd, 'sku'), description: optStr(fd, 'description'), priceCents: parseMoney(str(fd, 'price')) ?? 0,
      costCents: parseMoney(str(fd, 'cost')), taxCode: str(fd, 'taxCode') || 'GST', category: optStr(fd, 'category'),
      kind: (str(fd, 'kind') || 'service') as 'product' | 'service', unit: optStr(fd, 'unit'),
    };
    return id ? updateProduct(tx, s, id, { ...input, active: str(fd, 'active') !== 'off' }) : createProduct(tx, s, input);
  }).then(() => undefined), 'Saved');
  revalidatePath('/products');
  return res;
}
