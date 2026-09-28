import { boolean, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { cents, createdAt, pk, ts, updatedAt } from './_shared';
import { subAccountId } from './tenant';

export const products = pgTable('products', {
  id: pk(),
  subAccountId: subAccountId(),
  name: text('name').notNull(),
  sku: text('sku'),
  description: text('description'),
  kind: text('kind').$type<'product' | 'service'>().notNull().default('service'),
  unit: text('unit'),
  costCents: cents('cost_cents'),
  priceCents: cents('price_cents').notNull().default(0),
  /** Tax code from the business's tax regime, e.g. 'GST', 'GST_FREE'. */
  taxCode: text('tax_code').notNull().default('GST'),
  category: text('category'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('products_tenant_uq').on(t.subAccountId, t.id)]);

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired';

export type QuoteAcceptOptions = {
  createJob?: boolean;
  createInvoice?: boolean;
  /** Percentage of total to request as a deposit invoice (0-100). Empty = full amount. */
  depositPercent?: number;
  markDealWon?: boolean;
};

/** Shared document totals (quotes + invoices). */
const docTotals = () => ({
  pricesIncludeTax: boolean('prices_include_tax').notNull().default(false),
  currency: text('currency').notNull().default('AUD'),
  subtotalCents: cents('subtotal_cents').notNull().default(0),
  discountCents: cents('discount_cents').notNull().default(0),
  taxCents: cents('tax_cents').notNull().default(0),
  totalCents: cents('total_cents').notNull().default(0),
});

export const quotes = pgTable('quotes', {
  id: pk(),
  subAccountId: subAccountId(),
  number: text('number').notNull(),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  dealId: uuid('deal_id'),
  title: text('title'),
  status: text('status').$type<QuoteStatus>().notNull().default('draft'),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  expiryDate: date('expiry_date', { mode: 'string' }),
  ...docTotals(),
  notes: text('notes'),
  terms: text('terms'),
  publicToken: text('public_token').notNull(),
  acceptOptions: jsonb('accept_options').$type<QuoteAcceptOptions>().notNull().default({ createJob: true, createInvoice: true }),
  sentAt: ts('sent_at'),
  viewedAt: ts('viewed_at'),
  acceptedAt: ts('accepted_at'),
  acceptedByName: text('accepted_by_name'),
  rejectedAt: ts('rejected_at'),
  rejectionReason: text('rejection_reason'),
  jobId: uuid('job_id'),
  invoiceId: uuid('invoice_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('quotes_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('quotes_number_uq').on(t.subAccountId, t.number),
  uniqueIndex('quotes_public_token_uq').on(t.publicToken),
  index('quotes_status_idx').on(t.subAccountId, t.status),
]);

const lineItemColumns = () => ({
  productId: uuid('product_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 12, scale: 3, mode: 'number' }).notNull().default(1),
  unitPriceCents: cents('unit_price_cents').notNull().default(0),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  taxCode: text('tax_code').notNull().default('GST'),
  /** Snapshot of the rate at the time of the document, in basis points (1000 = 10%). */
  taxRateBps: integer('tax_rate_bps').notNull().default(1000),
  lineSubtotalCents: cents('line_subtotal_cents').notNull().default(0),
  lineTaxCents: cents('line_tax_cents').notNull().default(0),
  lineTotalCents: cents('line_total_cents').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const quoteLineItems = pgTable('quote_line_items', {
  id: pk(),
  subAccountId: subAccountId(),
  quoteId: uuid('quote_id').notNull(),
  ...lineItemColumns(),
}, (t) => [
  uniqueIndex('quote_line_items_tenant_uq').on(t.subAccountId, t.id),
  index('quote_line_items_quote_idx').on(t.subAccountId, t.quoteId),
]);

export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export const invoices = pgTable('invoices', {
  id: pk(),
  subAccountId: subAccountId(),
  number: text('number').notNull(),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  dealId: uuid('deal_id'),
  quoteId: uuid('quote_id'),
  jobId: uuid('job_id'),
  orderId: uuid('order_id'),
  title: text('title'),
  status: text('status').$type<InvoiceStatus>().notNull().default('draft'),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  ...docTotals(),
  amountPaidCents: cents('amount_paid_cents').notNull().default(0),
  notes: text('notes'),
  terms: text('terms'),
  publicToken: text('public_token').notNull(),
  sentAt: ts('sent_at'),
  viewedAt: ts('viewed_at'),
  paidAt: ts('paid_at'),
  cancelledAt: ts('cancelled_at'),
  lastReminderAt: ts('last_reminder_at'),
  reminderCount: integer('reminder_count').notNull().default(0),
  remindersEnabled: boolean('reminders_enabled').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('invoices_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('invoices_number_uq').on(t.subAccountId, t.number),
  uniqueIndex('invoices_public_token_uq').on(t.publicToken),
  index('invoices_status_idx').on(t.subAccountId, t.status, t.dueDate),
  index('invoices_contact_idx').on(t.subAccountId, t.contactId),
]);

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: pk(),
  subAccountId: subAccountId(),
  invoiceId: uuid('invoice_id').notNull(),
  ...lineItemColumns(),
}, (t) => [
  uniqueIndex('invoice_line_items_tenant_uq').on(t.subAccountId, t.id),
  index('invoice_line_items_invoice_idx').on(t.subAccountId, t.invoiceId),
]);

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded';

export const payments = pgTable('payments', {
  id: pk(),
  subAccountId: subAccountId(),
  invoiceId: uuid('invoice_id'),
  contactId: uuid('contact_id'),
  amountCents: cents('amount_cents').notNull(),
  refundedCents: cents('refunded_cents').notNull().default(0),
  currency: text('currency').notNull().default('AUD'),
  status: text('status').$type<PaymentStatus>().notNull().default('pending'),
  /** 'card', 'bank_transfer', 'cash', 'cheque', 'other' */
  method: text('method').notNull().default('card'),
  provider: text('provider').$type<'stripe' | 'manual'>().notNull().default('manual'),
  /** Stripe PaymentIntent id (or other provider id). Unique per business for idempotency. */
  providerPaymentId: text('provider_payment_id'),
  providerChargeId: text('provider_charge_id'),
  providerCheckoutSessionId: text('provider_checkout_session_id'),
  cardBrand: text('card_brand'),
  cardLast4: text('card_last4'),
  failureReason: text('failure_reason'),
  receiptUrl: text('receipt_url'),
  receiptSentAt: ts('receipt_sent_at'),
  reference: text('reference'),
  paidAt: ts('paid_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('payments_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('payments_provider_payment_uq').on(t.subAccountId, t.provider, t.providerPaymentId),
  index('payments_invoice_idx').on(t.subAccountId, t.invoiceId),
  index('payments_paid_at_idx').on(t.subAccountId, t.paidAt),
]);

/** Inbound provider webhook log. Unique (provider, event id) makes processing idempotent. */
export const webhookEvents = pgTable('webhook_events', {
  id: pk(),
  subAccountId: subAccountId(),
  integrationId: uuid('integration_id'),
  provider: text('provider').notNull(),
  providerEventId: text('provider_event_id').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processedAt: ts('processed_at'),
  error: text('error'),
  receivedAt: createdAt(),
}, (t) => [
  uniqueIndex('webhook_events_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('webhook_events_provider_event_uq').on(t.subAccountId, t.provider, t.providerEventId),
]);

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';

export type OrderItem = { productId?: string; name: string; sku?: string; quantity: number; unitPriceCents: number; variant?: string };

/** Lightweight orders for product businesses (e.g. clothing). */
export const orders = pgTable('orders', {
  id: pk(),
  subAccountId: subAccountId(),
  number: text('number').notNull(),
  contactId: uuid('contact_id'),
  status: text('status').$type<OrderStatus>().notNull().default('pending'),
  source: text('source').notNull().default('manual'),
  items: jsonb('items').$type<OrderItem[]>().notNull().default([]),
  totalCents: cents('total_cents').notNull().default(0),
  taxCents: cents('tax_cents').notNull().default(0),
  currency: text('currency').notNull().default('AUD'),
  shippingAddress: jsonb('shipping_address').$type<Record<string, string>>().notNull().default({}),
  notes: text('notes'),
  externalId: text('external_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('orders_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('orders_number_uq').on(t.subAccountId, t.number),
]);
