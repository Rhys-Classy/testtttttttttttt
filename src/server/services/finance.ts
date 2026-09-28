import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import {
  contacts, invoiceLineItems, invoices, payments, products, quoteLineItems, quotes,
  type InvoiceStatus, type QuoteAcceptOptions,
} from '@/db/schema';
import { randomToken } from '@/lib/crypto';
import { addDaysKey, todayKey } from '@/lib/dates';
import { env } from '@/lib/env';
import { formatMoney } from '@/lib/money';
import { calculateDocument, type LineInput } from '@/lib/tax';
import {
  Scope, ValidationError, audit, businessTax, byTenant, cleanStr, emit, getBusiness, logActivity, must, nextNumber,
  type Business,
} from './_common';
import { contactName, getContact, markDealOutcome, updateContact } from './crm';
import { queueMessage } from './comms';
import { notify } from './notifications';

export type Invoice = typeof invoices.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Product = typeof products.$inferSelect;

export type LineItemInput = {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPercent?: number;
  taxCode?: string;
};

export const invoiceUrl = (token: string) => `${env().APP_URL}/i/${token}`;
export const quoteUrl = (token: string) => `${env().APP_URL}/q/${token}`;

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export async function createProduct(tx: Tx, scope: Scope, input: { name: string; sku?: string | null; description?: string | null; priceCents: number; costCents?: number | null; taxCode?: string; category?: string | null; kind?: 'product' | 'service'; unit?: string | null }) {
  if (!cleanStr(input.name)) throw new ValidationError('Product needs a name.');
  const [row] = await tx.insert(products).values({
    subAccountId: scope.subAccountId,
    name: input.name.trim(),
    sku: cleanStr(input.sku),
    description: cleanStr(input.description),
    priceCents: input.priceCents,
    costCents: input.costCents ?? null,
    taxCode: input.taxCode ?? 'GST',
    category: cleanStr(input.category),
    kind: input.kind ?? 'service',
    unit: cleanStr(input.unit),
  }).returning();
  return row;
}

export async function updateProduct(tx: Tx, scope: Scope, id: string, patch: Partial<Pick<Product, 'name' | 'sku' | 'description' | 'priceCents' | 'costCents' | 'taxCode' | 'category' | 'active' | 'kind' | 'unit'>>) {
  const [row] = await tx.update(products).set({ ...patch, updatedAt: new Date() }).where(byTenant(products, scope, id)).returning();
  return must(row, 'Product');
}

/* ------------------------------------------------------------------ */
/* Shared line-item maths                                              */
/* ------------------------------------------------------------------ */

function computeLines(b: Business, lines: LineItemInput[], pricesIncludeTax?: boolean) {
  const tax = businessTax(b);
  const inc = pricesIncludeTax ?? tax.pricesIncludeTax;
  const calcInput: LineInput[] = lines.map((l) => ({
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    discountPercent: l.discountPercent ?? 0,
    taxCode: l.taxCode ?? tax.regime.defaultCode,
  }));
  const totals = calculateDocument(calcInput, { regime: tax.regime, pricesIncludeTax: inc, taxRegistered: tax.taxRegistered });
  const rows = lines.map((l, i) => ({
    productId: l.productId ?? null,
    description: l.description.trim() || 'Item',
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    discountPercent: l.discountPercent ?? 0,
    taxCode: totals.lines[i].taxCode,
    taxRateBps: totals.lines[i].taxRateBps,
    lineSubtotalCents: totals.lines[i].lineSubtotalCents,
    lineTaxCents: totals.lines[i].lineTaxCents,
    lineTotalCents: totals.lines[i].lineTotalCents,
    sortOrder: i,
  }));
  return { rows, totals, pricesIncludeTax: inc };
}

function validateLines(lines: LineItemInput[]) {
  if (!lines.length) throw new ValidationError('Add at least one line item.');
  for (const l of lines) {
    if (!Number.isFinite(l.quantity) || !Number.isFinite(l.unitPriceCents)) throw new ValidationError('Line items need a quantity and price.');
  }
}

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

export type QuoteInput = {
  contactId: string;
  dealId?: string | null;
  companyId?: string | null;
  title?: string | null;
  lines: LineItemInput[];
  notes?: string | null;
  terms?: string | null;
  issueDate?: string;
  expiryDate?: string | null;
  pricesIncludeTax?: boolean;
  acceptOptions?: QuoteAcceptOptions;
};

export async function createQuote(tx: Tx, scope: Scope, input: QuoteInput): Promise<Quote> {
  validateLines(input.lines);
  const b = await getBusiness(tx, scope.subAccountId);
  const contact = await getContact(tx, scope, input.contactId);
  const { rows, totals, pricesIncludeTax } = computeLines(b, input.lines, input.pricesIncludeTax);
  const issueDate = input.issueDate ?? todayKey(b.timezone);
  const [quote] = await tx.insert(quotes).values({
    subAccountId: scope.subAccountId,
    number: await nextNumber(tx, scope, 'quote'),
    contactId: contact.id,
    companyId: input.companyId ?? contact.companyId,
    dealId: input.dealId ?? null,
    title: cleanStr(input.title),
    issueDate,
    expiryDate: input.expiryDate ?? addDaysKey(issueDate, b.quoteValidityDays),
    currency: b.currency,
    pricesIncludeTax,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    notes: cleanStr(input.notes),
    terms: cleanStr(input.terms) ?? b.quoteTerms,
    publicToken: randomToken(24),
    acceptOptions: input.acceptOptions ?? { createJob: true, createInvoice: true, markDealWon: true },
  }).returning();
  await tx.insert(quoteLineItems).values(rows.map((r) => ({ ...r, subAccountId: scope.subAccountId, quoteId: quote.id })));
  await logActivity(tx, scope, { contactId: contact.id, entityType: 'quote', entityId: quote.id, type: 'quote', summary: `Quote ${quote.number} created (${formatMoney(quote.totalCents, b.currency)})` });
  await emit(tx, scope, 'quote.created', { entityType: 'quote', entityId: quote.id, contactId: contact.id, payload: { totalCents: quote.totalCents, number: quote.number } });
  return quote;
}

export async function updateQuoteLines(tx: Tx, scope: Scope, quoteId: string, input: Omit<QuoteInput, 'contactId'> & { contactId?: string }) {
  const quote = await getQuote(tx, scope, quoteId);
  if (!['draft', 'sent', 'viewed'].includes(quote.status)) throw new ValidationError('Only open quotes can be edited.');
  validateLines(input.lines);
  const b = await getBusiness(tx, scope.subAccountId);
  const { rows, totals, pricesIncludeTax } = computeLines(b, input.lines, input.pricesIncludeTax ?? quote.pricesIncludeTax);
  await tx.delete(quoteLineItems).where(and(eq(quoteLineItems.subAccountId, scope.subAccountId), eq(quoteLineItems.quoteId, quoteId)));
  await tx.insert(quoteLineItems).values(rows.map((r) => ({ ...r, subAccountId: scope.subAccountId, quoteId })));
  const [row] = await tx.update(quotes).set({
    contactId: input.contactId ?? quote.contactId,
    title: input.title !== undefined ? cleanStr(input.title) : quote.title,
    notes: input.notes !== undefined ? cleanStr(input.notes) : quote.notes,
    terms: input.terms !== undefined ? cleanStr(input.terms) : quote.terms,
    expiryDate: input.expiryDate ?? quote.expiryDate,
    pricesIncludeTax,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    updatedAt: new Date(),
  }).where(byTenant(quotes, scope, quoteId)).returning();
  return row;
}

export async function getQuote(tx: Tx, scope: Scope, id: string): Promise<Quote> {
  const [row] = await tx.select().from(quotes).where(byTenant(quotes, scope, id));
  return must(row, 'Quote');
}

export async function getQuoteLines(tx: Tx, scope: Scope, quoteId: string) {
  return tx.select().from(quoteLineItems)
    .where(and(eq(quoteLineItems.subAccountId, scope.subAccountId), eq(quoteLineItems.quoteId, quoteId)))
    .orderBy(asc(quoteLineItems.sortOrder));
}

export async function sendQuote(tx: Tx, scope: Scope, quoteId: string, opts: { message?: string } = {}) {
  const quote = await getQuote(tx, scope, quoteId);
  if (['accepted', 'rejected'].includes(quote.status)) throw new ValidationError(`Quote is already ${quote.status}.`);
  const b = await getBusiness(tx, scope.subAccountId);
  const contact = quote.contactId ? await getContact(tx, scope, quote.contactId) : null;
  const link = quoteUrl(quote.publicToken);
  if (contact?.email) {
    await queueMessage(tx, scope, {
      contactId: contact.id,
      channel: 'email',
      subject: `Quote ${quote.number} from ${b.tradingName ?? b.name}`,
      body: opts.message ?? `Hi ${contact.firstName || 'there'},\n\nHere's your quote for ${formatMoney(quote.totalCents, quote.currency)}. You can view and accept it online:\n${link}\n\nThanks,\n${b.tradingName ?? b.name}`,
    });
  }
  const [row] = await tx.update(quotes).set({ status: quote.status === 'draft' ? 'sent' : quote.status, sentAt: new Date(), updatedAt: new Date() })
    .where(byTenant(quotes, scope, quoteId)).returning();
  await logActivity(tx, scope, { contactId: quote.contactId, entityType: 'quote', entityId: quoteId, type: 'quote_sent', summary: `Quote ${quote.number} sent` });
  await emit(tx, scope, 'quote.sent', { entityType: 'quote', entityId: quoteId, contactId: quote.contactId, payload: { link } });
  return { quote: row, link, emailed: !!contact?.email };
}

export async function markQuoteViewed(tx: Tx, scope: Scope, quoteId: string) {
  const quote = await getQuote(tx, scope, quoteId);
  if (quote.viewedAt) return quote;
  const [row] = await tx.update(quotes).set({ viewedAt: new Date(), status: quote.status === 'sent' ? 'viewed' : quote.status })
    .where(byTenant(quotes, scope, quoteId)).returning();
  await emit(tx, scope, 'quote.viewed', { entityType: 'quote', entityId: quoteId, contactId: quote.contactId });
  return row;
}

/**
 * Customer accepts online (or owner marks accepted). Runs the quote's accept options:
 * mark customer, win the deal, create the job, create the (deposit) invoice.
 */
export async function acceptQuote(tx: Tx, scope: Scope, quoteId: string, opts: { acceptedByName?: string } = {}) {
  const quote = await getQuote(tx, scope, quoteId);
  if (quote.status === 'accepted') return { quote, jobId: quote.jobId, invoiceId: quote.invoiceId };
  if (quote.status === 'rejected') throw new ValidationError('This quote was declined.');
  const b = await getBusiness(tx, scope.subAccountId);
  if (quote.expiryDate && quote.expiryDate < todayKey(b.timezone)) throw new ValidationError('This quote has expired.');
  const options = quote.acceptOptions ?? {};

  if (quote.contactId) {
    const c = await getContact(tx, scope, quote.contactId);
    if (c.status !== 'customer') await updateContact(tx, scope, c.id, { status: 'customer' });
  }
  if (quote.dealId && options.markDealWon !== false) await markDealOutcome(tx, scope, quote.dealId, 'won');

  let jobId: string | null = quote.jobId;
  if (options.createJob && !jobId) {
    const { createJob } = await import('./work');
    const job = await createJob(tx, scope, {
      title: quote.title ?? `Job for ${quote.number}`,
      contactId: quote.contactId,
      dealId: quote.dealId,
      quoteId: quote.id,
      valueCents: quote.totalCents,
      status: 'booked',
    });
    jobId = job.id;
  }

  let invoiceId: string | null = quote.invoiceId;
  if (options.createInvoice && !invoiceId && quote.contactId) {
    const inv = await createInvoiceFromQuote(tx, scope, quote.id, { depositPercent: options.depositPercent, jobId });
    invoiceId = inv.id;
  }

  const [row] = await tx.update(quotes).set({
    status: 'accepted', acceptedAt: new Date(), acceptedByName: cleanStr(opts.acceptedByName), jobId, invoiceId, updatedAt: new Date(),
  }).where(byTenant(quotes, scope, quoteId)).returning();

  await logActivity(tx, scope, { contactId: quote.contactId, entityType: 'quote', entityId: quoteId, type: 'quote_accepted', summary: `Quote ${quote.number} accepted${opts.acceptedByName ? ` by ${opts.acceptedByName}` : ''}` });
  await emit(tx, scope, 'quote.accepted', { entityType: 'quote', entityId: quoteId, contactId: quote.contactId, payload: { totalCents: quote.totalCents, jobId, invoiceId } });
  await notify(tx, scope, {
    type: 'quote.accepted', severity: 'success',
    title: `Quote ${quote.number} accepted`,
    body: `${formatMoney(quote.totalCents, quote.currency)}${opts.acceptedByName ? ` — ${opts.acceptedByName}` : ''}`,
    link: `/quotes/${quoteId}`,
  });
  await audit(tx, scope, 'quote.accept', 'quote', quoteId, { acceptedByName: opts.acceptedByName });
  return { quote: row, jobId, invoiceId };
}

export async function rejectQuote(tx: Tx, scope: Scope, quoteId: string, reason?: string) {
  const quote = await getQuote(tx, scope, quoteId);
  if (quote.status === 'accepted') throw new ValidationError('This quote was already accepted.');
  const [row] = await tx.update(quotes).set({ status: 'rejected', rejectedAt: new Date(), rejectionReason: cleanStr(reason), updatedAt: new Date() })
    .where(byTenant(quotes, scope, quoteId)).returning();
  await emit(tx, scope, 'quote.rejected', { entityType: 'quote', entityId: quoteId, contactId: quote.contactId, payload: { reason } });
  await notify(tx, scope, { type: 'quote.rejected', severity: 'warning', title: `Quote ${quote.number} declined`, body: reason ?? undefined, link: `/quotes/${quoteId}` });
  return row;
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export type InvoiceInput = {
  contactId: string;
  companyId?: string | null;
  dealId?: string | null;
  quoteId?: string | null;
  jobId?: string | null;
  orderId?: string | null;
  title?: string | null;
  lines: LineItemInput[];
  notes?: string | null;
  terms?: string | null;
  issueDate?: string;
  dueDate?: string;
  pricesIncludeTax?: boolean;
};

export async function createInvoice(tx: Tx, scope: Scope, input: InvoiceInput): Promise<Invoice> {
  validateLines(input.lines);
  const b = await getBusiness(tx, scope.subAccountId);
  const contact = await getContact(tx, scope, input.contactId);
  const { rows, totals, pricesIncludeTax } = computeLines(b, input.lines, input.pricesIncludeTax);
  const issueDate = input.issueDate ?? todayKey(b.timezone);
  const [invoice] = await tx.insert(invoices).values({
    subAccountId: scope.subAccountId,
    number: await nextNumber(tx, scope, 'invoice'),
    contactId: contact.id,
    companyId: input.companyId ?? contact.companyId,
    dealId: input.dealId ?? null,
    quoteId: input.quoteId ?? null,
    jobId: input.jobId ?? null,
    orderId: input.orderId ?? null,
    title: cleanStr(input.title),
    issueDate,
    dueDate: input.dueDate ?? addDaysKey(issueDate, b.paymentTermsDays),
    currency: b.currency,
    pricesIncludeTax,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    notes: cleanStr(input.notes),
    terms: cleanStr(input.terms) ?? b.invoiceTerms,
    publicToken: randomToken(24),
  }).returning();
  await tx.insert(invoiceLineItems).values(rows.map((r) => ({ ...r, subAccountId: scope.subAccountId, invoiceId: invoice.id })));
  await logActivity(tx, scope, { contactId: contact.id, entityType: 'invoice', entityId: invoice.id, type: 'invoice', summary: `Invoice ${invoice.number} created (${formatMoney(invoice.totalCents, b.currency)})` });
  await emit(tx, scope, 'invoice.created', { entityType: 'invoice', entityId: invoice.id, contactId: contact.id, payload: { totalCents: invoice.totalCents, number: invoice.number } });
  return invoice;
}

export async function updateInvoiceLines(tx: Tx, scope: Scope, invoiceId: string, input: Omit<InvoiceInput, 'contactId'> & { contactId?: string }) {
  const inv = await getInvoice(tx, scope, invoiceId);
  if (inv.amountPaidCents > 0 || ['paid', 'cancelled'].includes(inv.status)) throw new ValidationError('Paid or cancelled invoices cannot be edited.');
  validateLines(input.lines);
  const b = await getBusiness(tx, scope.subAccountId);
  const { rows, totals, pricesIncludeTax } = computeLines(b, input.lines, input.pricesIncludeTax ?? inv.pricesIncludeTax);
  await tx.delete(invoiceLineItems).where(and(eq(invoiceLineItems.subAccountId, scope.subAccountId), eq(invoiceLineItems.invoiceId, invoiceId)));
  await tx.insert(invoiceLineItems).values(rows.map((r) => ({ ...r, subAccountId: scope.subAccountId, invoiceId })));
  const [row] = await tx.update(invoices).set({
    contactId: input.contactId ?? inv.contactId,
    title: input.title !== undefined ? cleanStr(input.title) : inv.title,
    notes: input.notes !== undefined ? cleanStr(input.notes) : inv.notes,
    terms: input.terms !== undefined ? cleanStr(input.terms) : inv.terms,
    dueDate: input.dueDate ?? inv.dueDate,
    pricesIncludeTax,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    updatedAt: new Date(),
  }).where(byTenant(invoices, scope, invoiceId)).returning();
  return row;
}

export async function createInvoiceFromQuote(tx: Tx, scope: Scope, quoteId: string, opts: { depositPercent?: number; jobId?: string | null } = {}) {
  const quote = await getQuote(tx, scope, quoteId);
  if (!quote.contactId) throw new ValidationError('Quote has no customer.');
  const lines = await getQuoteLines(tx, scope, quoteId);
  const pct = opts.depositPercent && opts.depositPercent > 0 && opts.depositPercent < 100 ? opts.depositPercent : null;
  const invoiceLines: LineItemInput[] = pct
    ? [{ description: `${pct}% deposit for quote ${quote.number}${quote.title ? ` — ${quote.title}` : ''}`, quantity: 1, unitPriceCents: Math.round((quote.pricesIncludeTax ? quote.totalCents : quote.subtotalCents) * pct / 100), taxCode: lines[0]?.taxCode ?? 'GST' }]
    : lines.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountPercent: l.discountPercent, taxCode: l.taxCode }));
  return createInvoice(tx, scope, {
    contactId: quote.contactId,
    companyId: quote.companyId,
    dealId: quote.dealId,
    quoteId: quote.id,
    jobId: opts.jobId ?? quote.jobId,
    title: quote.title,
    lines: invoiceLines,
    pricesIncludeTax: quote.pricesIncludeTax,
    notes: quote.notes,
  });
}

export async function getInvoice(tx: Tx, scope: Scope, id: string): Promise<Invoice> {
  const [row] = await tx.select().from(invoices).where(byTenant(invoices, scope, id));
  return must(row, 'Invoice');
}

export async function getInvoiceLines(tx: Tx, scope: Scope, invoiceId: string) {
  return tx.select().from(invoiceLineItems)
    .where(and(eq(invoiceLineItems.subAccountId, scope.subAccountId), eq(invoiceLineItems.invoiceId, invoiceId)))
    .orderBy(asc(invoiceLineItems.sortOrder));
}

export const balanceDue = (inv: Pick<Invoice, 'totalCents' | 'amountPaidCents'>) => Math.max(inv.totalCents - inv.amountPaidCents, 0);

/** Status after a payment or date change. Draft/cancelled are sticky. */
export function deriveInvoiceStatus(inv: Pick<Invoice, 'status' | 'totalCents' | 'amountPaidCents' | 'dueDate' | 'viewedAt' | 'sentAt'>, today: string): InvoiceStatus {
  if (inv.status === 'cancelled' || inv.status === 'draft') return inv.status;
  if (inv.amountPaidCents >= inv.totalCents && inv.totalCents > 0) return 'paid';
  if (inv.dueDate < today) return 'overdue';
  if (inv.amountPaidCents > 0) return 'partially_paid';
  return inv.viewedAt ? 'viewed' : 'sent';
}

export async function sendInvoice(tx: Tx, scope: Scope, invoiceId: string, opts: { message?: string; channel?: 'email' | 'sms' } = {}) {
  const inv = await getInvoice(tx, scope, invoiceId);
  if (inv.status === 'cancelled') throw new ValidationError('This invoice is cancelled.');
  const b = await getBusiness(tx, scope.subAccountId);
  const contact = inv.contactId ? await getContact(tx, scope, inv.contactId) : null;
  const link = invoiceUrl(inv.publicToken);
  const channel = opts.channel ?? (contact?.email ? 'email' : 'sms');
  let delivered = false;
  if (contact && (channel === 'email' ? contact.email : contact.phone)) {
    await queueMessage(tx, scope, {
      contactId: contact.id,
      channel,
      subject: `Invoice ${inv.number} from ${b.tradingName ?? b.name}`,
      body: opts.message ?? (channel === 'email'
        ? `Hi ${contact.firstName || 'there'},\n\nInvoice ${inv.number} for ${formatMoney(inv.totalCents, inv.currency)} is due ${inv.dueDate}.\n\nView and pay online:\n${link}\n\nThanks,\n${b.tradingName ?? b.name}`
        : `Hi ${contact.firstName || 'there'}, invoice ${inv.number} for ${formatMoney(inv.totalCents, inv.currency)} from ${b.shortName ?? b.name}: ${link}`),
    });
    delivered = true;
  }
  const next = inv.status === 'draft' ? deriveInvoiceStatus({ ...inv, status: 'sent' }, todayKey(b.timezone)) : inv.status;
  const [row] = await tx.update(invoices).set({ status: next, sentAt: new Date(), updatedAt: new Date() })
    .where(byTenant(invoices, scope, invoiceId)).returning();
  await logActivity(tx, scope, { contactId: inv.contactId, entityType: 'invoice', entityId: invoiceId, type: 'invoice_sent', summary: `Invoice ${inv.number} sent` });
  await emit(tx, scope, 'invoice.sent', { entityType: 'invoice', entityId: invoiceId, contactId: inv.contactId, payload: { link } });
  return { invoice: row, link, delivered };
}

export async function markInvoiceViewed(tx: Tx, scope: Scope, invoiceId: string) {
  const inv = await getInvoice(tx, scope, invoiceId);
  if (inv.viewedAt) return inv;
  const [row] = await tx.update(invoices).set({ viewedAt: new Date(), status: inv.status === 'sent' ? 'viewed' : inv.status })
    .where(byTenant(invoices, scope, invoiceId)).returning();
  await emit(tx, scope, 'invoice.viewed', { entityType: 'invoice', entityId: invoiceId, contactId: inv.contactId });
  return row;
}

export async function cancelInvoice(tx: Tx, scope: Scope, invoiceId: string) {
  const inv = await getInvoice(tx, scope, invoiceId);
  if (inv.amountPaidCents > 0) throw new ValidationError('Refund payments before cancelling this invoice.');
  const [row] = await tx.update(invoices).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
    .where(byTenant(invoices, scope, invoiceId)).returning();
  await audit(tx, scope, 'invoice.cancel', 'invoice', invoiceId);
  return row;
}

/** Recompute paid amount from succeeded payments (source of truth) and update status. */
export async function reconcileInvoice(tx: Tx, scope: Scope, invoiceId: string) {
  const inv = await getInvoice(tx, scope, invoiceId);
  const b = await getBusiness(tx, scope.subAccountId);
  const [agg] = await tx.select({
    paid: sql<number>`coalesce(sum(${payments.amountCents} - ${payments.refundedCents}), 0)`,
  }).from(payments).where(and(
    eq(payments.subAccountId, scope.subAccountId), eq(payments.invoiceId, invoiceId),
    inArray(payments.status, ['succeeded', 'partially_refunded', 'refunded']),
  ));
  const paid = Number(agg?.paid ?? 0);
  const wasPaid = inv.status === 'paid';
  const status = deriveInvoiceStatus({ ...inv, status: inv.status === 'draft' ? 'sent' : inv.status, amountPaidCents: paid }, todayKey(b.timezone));
  const [row] = await tx.update(invoices).set({
    amountPaidCents: paid,
    status,
    paidAt: status === 'paid' ? (inv.paidAt ?? new Date()) : null,
    updatedAt: new Date(),
  }).where(byTenant(invoices, scope, invoiceId)).returning();
  if (status === 'paid' && !wasPaid) {
    await emit(tx, scope, 'invoice.paid', { entityType: 'invoice', entityId: invoiceId, contactId: inv.contactId, payload: { totalCents: inv.totalCents, number: inv.number } });
    await logActivity(tx, scope, { contactId: inv.contactId, entityType: 'invoice', entityId: invoiceId, type: 'invoice_paid', summary: `Invoice ${inv.number} paid in full` });
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export async function recordManualPayment(tx: Tx, scope: Scope, input: { invoiceId: string; amountCents: number; method?: string; reference?: string | null; paidAt?: Date }) {
  const inv = await getInvoice(tx, scope, input.invoiceId);
  if (inv.status === 'cancelled') throw new ValidationError('This invoice is cancelled.');
  if (!(input.amountCents > 0)) throw new ValidationError('Payment amount must be more than zero.');
  const [payment] = await tx.insert(payments).values({
    subAccountId: scope.subAccountId,
    invoiceId: inv.id,
    contactId: inv.contactId,
    amountCents: input.amountCents,
    currency: inv.currency,
    status: 'succeeded',
    method: input.method ?? 'bank_transfer',
    provider: 'manual',
    reference: cleanStr(input.reference),
    paidAt: input.paidAt ?? new Date(),
  }).returning();
  await afterPaymentSucceeded(tx, scope, payment, inv);
  return payment;
}

/**
 * Stripe (or other provider) confirmed a payment. Idempotent on (provider, providerPaymentId):
 * replaying the same webhook never double-counts.
 */
export async function recordProviderPayment(tx: Tx, scope: Scope, input: {
  invoiceId: string;
  amountCents: number;
  currency: string;
  providerPaymentId: string;
  providerChargeId?: string | null;
  checkoutSessionId?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  receiptUrl?: string | null;
  method?: string;
  paidAt?: Date;
}) {
  const inv = await getInvoice(tx, scope, input.invoiceId);
  const inserted = await tx.insert(payments).values({
    subAccountId: scope.subAccountId,
    invoiceId: inv.id,
    contactId: inv.contactId,
    amountCents: input.amountCents,
    currency: input.currency.toUpperCase(),
    status: 'succeeded',
    method: input.method ?? 'card',
    provider: 'stripe',
    providerPaymentId: input.providerPaymentId,
    providerChargeId: input.providerChargeId ?? null,
    providerCheckoutSessionId: input.checkoutSessionId ?? null,
    cardBrand: input.cardBrand ?? null,
    cardLast4: input.cardLast4 ?? null,
    receiptUrl: input.receiptUrl ?? null,
    paidAt: input.paidAt ?? new Date(),
  }).onConflictDoNothing({ target: [payments.subAccountId, payments.provider, payments.providerPaymentId] }).returning();

  if (!inserted.length) {
    // Already recorded (webhook retry or redirect + webhook race). Upgrade a pending/failed row if needed.
    const [existing] = await tx.select().from(payments).where(and(
      eq(payments.subAccountId, scope.subAccountId), eq(payments.provider, 'stripe'), eq(payments.providerPaymentId, input.providerPaymentId),
    ));
    if (existing && existing.status !== 'succeeded' && existing.status !== 'refunded' && existing.status !== 'partially_refunded') {
      const [updated] = await tx.update(payments).set({ status: 'succeeded', paidAt: input.paidAt ?? new Date(), failureReason: null, updatedAt: new Date() })
        .where(byTenant(payments, scope, existing.id)).returning();
      await afterPaymentSucceeded(tx, scope, updated, inv);
      return { payment: updated, duplicate: false };
    }
    return { payment: existing, duplicate: true };
  }
  await afterPaymentSucceeded(tx, scope, inserted[0], inv);
  return { payment: inserted[0], duplicate: false };
}

async function afterPaymentSucceeded(tx: Tx, scope: Scope, payment: Payment, inv: Invoice) {
  await reconcileInvoice(tx, scope, inv.id);
  if (inv.contactId) {
    const c = await getContact(tx, scope, inv.contactId);
    if (c.status !== 'customer') await updateContact(tx, scope, c.id, { status: 'customer' });
  }
  await logActivity(tx, scope, { contactId: inv.contactId, entityType: 'payment', entityId: payment.id, type: 'payment', summary: `Payment received ${formatMoney(payment.amountCents, payment.currency)} for ${inv.number}` });
  await emit(tx, scope, 'payment.received', { entityType: 'payment', entityId: payment.id, contactId: inv.contactId, payload: { amountCents: payment.amountCents, invoiceId: inv.id, number: inv.number } });
  await notify(tx, scope, {
    type: 'payment.received', severity: 'success',
    title: `Payment received: ${formatMoney(payment.amountCents, payment.currency)}`,
    body: `Invoice ${inv.number}`,
    link: `/invoices/${inv.id}`,
  });
}

export async function recordFailedPayment(tx: Tx, scope: Scope, input: { invoiceId: string; amountCents: number; currency: string; providerPaymentId: string; reason?: string | null }) {
  const inv = await getInvoice(tx, scope, input.invoiceId);
  const [existing] = await tx.select().from(payments).where(and(
    eq(payments.subAccountId, scope.subAccountId), eq(payments.provider, 'stripe'), eq(payments.providerPaymentId, input.providerPaymentId),
  ));
  if (existing?.status === 'succeeded') return existing; // late failure event after success: ignore
  let payment: Payment;
  if (existing) {
    [payment] = await tx.update(payments).set({ status: 'failed', failureReason: cleanStr(input.reason), updatedAt: new Date() })
      .where(byTenant(payments, scope, existing.id)).returning();
  } else {
    [payment] = await tx.insert(payments).values({
      subAccountId: scope.subAccountId, invoiceId: inv.id, contactId: inv.contactId, amountCents: input.amountCents,
      currency: input.currency.toUpperCase(), status: 'failed', provider: 'stripe', providerPaymentId: input.providerPaymentId,
      failureReason: cleanStr(input.reason),
    }).returning();
  }
  await emit(tx, scope, 'payment.failed', { entityType: 'payment', entityId: payment.id, contactId: inv.contactId, payload: { invoiceId: inv.id, reason: input.reason } });
  await notify(tx, scope, { type: 'payment.failed', severity: 'urgent', title: `Payment failed on ${inv.number}`, body: input.reason ?? undefined, link: `/invoices/${inv.id}` });
  return payment;
}

export async function recordRefund(tx: Tx, scope: Scope, input: { providerPaymentId: string; refundedCents: number }) {
  const [p] = await tx.select().from(payments).where(and(
    eq(payments.subAccountId, scope.subAccountId), eq(payments.provider, 'stripe'), eq(payments.providerPaymentId, input.providerPaymentId),
  ));
  if (!p) return null;
  const status = input.refundedCents >= p.amountCents ? 'refunded' : 'partially_refunded';
  const [row] = await tx.update(payments).set({ refundedCents: input.refundedCents, status, updatedAt: new Date() }).where(byTenant(payments, scope, p.id)).returning();
  if (p.invoiceId) await reconcileInvoice(tx, scope, p.invoiceId);
  await emit(tx, scope, 'payment.refunded', { entityType: 'payment', entityId: p.id, contactId: p.contactId, payload: { refundedCents: input.refundedCents } });
  return row;
}

/* ------------------------------------------------------------------ */
/* Overdue sweep + reminders (worker)                                  */
/* ------------------------------------------------------------------ */

/** Flip sent/viewed/part-paid invoices past due to overdue and emit invoice.overdue once. */
export async function sweepOverdueInvoices(tx: Tx, scope: Scope) {
  const b = await getBusiness(tx, scope.subAccountId);
  const today = todayKey(b.timezone);
  const due = await tx.select().from(invoices).where(and(
    eq(invoices.subAccountId, scope.subAccountId),
    inArray(invoices.status, ['sent', 'viewed', 'partially_paid']),
    lt(invoices.dueDate, today),
  ));
  for (const inv of due) {
    await tx.update(invoices).set({ status: 'overdue', updatedAt: new Date() }).where(byTenant(invoices, scope, inv.id));
    await emit(tx, scope, 'invoice.overdue', { entityType: 'invoice', entityId: inv.id, contactId: inv.contactId, payload: { balanceCents: balanceDue(inv), dueDate: inv.dueDate, number: inv.number } });
    await notify(tx, scope, { type: 'invoice.overdue', severity: 'warning', title: `Invoice ${inv.number} is overdue`, body: `${formatMoney(balanceDue(inv), inv.currency)} outstanding`, link: `/invoices/${inv.id}` });
  }
  return due.length;
}

/** Friendly automatic reminders: 3 days overdue, then weekly, max 4. */
export async function sendDueReminders(tx: Tx, scope: Scope, now = new Date()) {
  const b = await getBusiness(tx, scope.subAccountId);
  const today = todayKey(b.timezone, now);
  const rows = await tx.select({ inv: invoices, contact: contacts }).from(invoices)
    .leftJoin(contacts, and(eq(contacts.id, invoices.contactId), eq(contacts.subAccountId, invoices.subAccountId)))
    .where(and(eq(invoices.subAccountId, scope.subAccountId), eq(invoices.status, 'overdue'), eq(invoices.remindersEnabled, true)));
  let sent = 0;
  for (const { inv, contact } of rows) {
    if (!contact?.email || inv.reminderCount >= 4) continue;
    const daysOverdue = Math.floor((Date.parse(today) - Date.parse(inv.dueDate)) / 86_400_000);
    const lastGap = inv.lastReminderAt ? (now.getTime() - inv.lastReminderAt.getTime()) / 86_400_000 : Infinity;
    if (daysOverdue < 3 || lastGap < 7) continue;
    await queueMessage(tx, scope, {
      contactId: contact.id,
      channel: 'email',
      subject: `Reminder: invoice ${inv.number} is overdue`,
      body: `Hi ${contact.firstName || 'there'},\n\nJust a friendly reminder that invoice ${inv.number} (${formatMoney(balanceDue(inv), inv.currency)}) was due on ${inv.dueDate}.\n\nPay online: ${invoiceUrl(inv.publicToken)}\n\nThanks,\n${b.tradingName ?? b.name}`,
    });
    await tx.update(invoices).set({ lastReminderAt: now, reminderCount: inv.reminderCount + 1 }).where(byTenant(invoices, scope, inv.id));
    sent++;
  }
  return sent;
}

export function invoiceContactName(c: typeof contacts.$inferSelect | null) {
  return c ? contactName(c) : 'No customer';
}
