import 'server-only';
import type { appointments, contacts, invoiceLineItems, invoices, jobs, leads, payments, tasks } from '@/db/schema';
import { invoiceUrl } from '@/server/services/finance';
import { iso } from './v1';

export const LEAD_SOURCES = ['website', 'facebook', 'instagram', 'google', 'referral', 'manual', 'phone', 'sms', 'other'] as const;

/** Public API shapes: snake_case, money in integer cents, ISO-8601 timestamps. Internal columns are never exposed. */
export const apiContact = (c: typeof contacts.$inferSelect) => ({
  id: c.id, first_name: c.firstName, last_name: c.lastName, email: c.email, phone: c.phone, company_id: c.companyId,
  job_title: c.jobTitle, website: c.website, address: c.address, tags: c.tags, source: c.source, status: c.status,
  email_opt_out: c.emailOptOut, sms_opt_out: c.smsOptOut, custom_fields: c.customFields,
  created_at: iso(c.createdAt), updated_at: iso(c.updatedAt), archived_at: iso(c.archivedAt),
});

export const apiLead = (l: typeof leads.$inferSelect) => ({
  id: l.id, contact_id: l.contactId, title: l.title, source: l.source, status: l.status, value_cents: l.valueCents,
  next_action: l.nextAction, next_action_at: iso(l.nextActionAt), notes: l.notes, deal_id: l.dealId,
  created_at: iso(l.createdAt), updated_at: iso(l.updatedAt),
});

export const apiInvoice = (i: typeof invoices.$inferSelect, lines?: (typeof invoiceLineItems.$inferSelect)[]) => ({
  id: i.id, number: i.number, status: i.status, contact_id: i.contactId, title: i.title, issue_date: i.issueDate, due_date: i.dueDate,
  currency: i.currency, prices_include_tax: i.pricesIncludeTax, subtotal_cents: i.subtotalCents, discount_cents: i.discountCents,
  tax_cents: i.taxCents, total_cents: i.totalCents, amount_paid_cents: i.amountPaidCents, balance_cents: i.totalCents - i.amountPaidCents,
  public_url: invoiceUrl(i.publicToken), sent_at: iso(i.sentAt), paid_at: iso(i.paidAt), created_at: iso(i.createdAt), updated_at: iso(i.updatedAt),
  ...(lines ? { lines: lines.map((l) => ({
    description: l.description, quantity: Number(l.quantity), unit_price_cents: l.unitPriceCents, discount_percent: Number(l.discountPercent),
    tax_code: l.taxCode, tax_cents: l.lineTaxCents, total_cents: l.lineTotalCents,
  })) } : {}),
});

export const apiPayment = (p: typeof payments.$inferSelect) => ({
  id: p.id, invoice_id: p.invoiceId, contact_id: p.contactId, amount_cents: p.amountCents, refunded_cents: p.refundedCents, currency: p.currency,
  status: p.status, method: p.method, provider: p.provider, reference: p.reference, card_brand: p.cardBrand, card_last4: p.cardLast4,
  paid_at: iso(p.paidAt), created_at: iso(p.createdAt),
});

export const apiTask = (t: typeof tasks.$inferSelect) => ({
  id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, due_at: iso(t.dueAt), all_day: t.allDay,
  contact_id: t.contactId, job_id: t.jobId, completed_at: iso(t.completedAt), created_at: iso(t.createdAt), updated_at: iso(t.updatedAt),
});

export const apiJob = (j: typeof jobs.$inferSelect) => ({
  id: j.id, number: j.number, title: j.title, status: j.status, contact_id: j.contactId, quote_id: j.quoteId, value_cents: j.valueCents,
  scheduled_start: iso(j.scheduledStart), scheduled_end: iso(j.scheduledEnd), address: j.address, completed_at: iso(j.completedAt),
  created_at: iso(j.createdAt), updated_at: iso(j.updatedAt),
});

export const apiAppointment = (a: typeof appointments.$inferSelect) => ({
  id: a.id, title: a.title, status: a.status, starts_at: iso(a.startsAt), ends_at: iso(a.endsAt), location: a.location, contact_id: a.contactId,
});
