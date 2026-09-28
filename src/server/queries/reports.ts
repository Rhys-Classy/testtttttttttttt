import { sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { pgArray } from '@/db/sql';

export type ReportRange = { from: Date; to: Date };

/** Useful numbers only. Always limited to the businesses visible in this request. */
export async function getReport(tx: Tx, ids: string[], range: ReportRange) {
  const { from, to } = range;
  const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await tx.execute<T>(q)).rows[0];

  const sales = await one<Record<string, number>>(sql`select
    (select count(*) from leads where sub_account_id = any(${pgArray(ids)}) and created_at >= ${from} and created_at < ${to}) as leads,
    (select count(*) from leads where sub_account_id = any(${pgArray(ids)}) and created_at >= ${from} and created_at < ${to} and status = 'converted') as converted,
    (select coalesce(sum(value_cents), 0) from deals where sub_account_id = any(${pgArray(ids)}) and status = 'open') as pipeline_value,
    (select count(*) from deals where sub_account_id = any(${pgArray(ids)}) and status = 'won' and won_at >= ${from} and won_at < ${to}) as won,
    (select coalesce(sum(value_cents), 0) from deals where sub_account_id = any(${pgArray(ids)}) and status = 'won' and won_at >= ${from} and won_at < ${to}) as won_value,
    (select count(*) from deals where sub_account_id = any(${pgArray(ids)}) and status = 'lost' and lost_at >= ${from} and lost_at < ${to}) as lost,
    (select count(*) from quotes where sub_account_id = any(${pgArray(ids)}) and sent_at >= ${from} and sent_at < ${to}) as quotes_sent,
    (select count(*) from quotes where sub_account_id = any(${pgArray(ids)}) and accepted_at >= ${from} and accepted_at < ${to}) as quotes_accepted`);

  const revenue = await one<Record<string, number>>(sql`select
    (select coalesce(sum(amount_cents - refunded_cents), 0) from payments where sub_account_id = any(${pgArray(ids)}) and status in ('succeeded','partially_refunded') and paid_at >= ${from} and paid_at < ${to}) as paid,
    (select coalesce(sum(total_cents), 0) from invoices where sub_account_id = any(${pgArray(ids)}) and status <> 'cancelled' and status <> 'draft' and issue_date >= ${from}::date and issue_date < ${to}::date) as invoiced,
    (select count(*) from invoices where sub_account_id = any(${pgArray(ids)}) and status <> 'cancelled' and status <> 'draft' and issue_date >= ${from}::date and issue_date < ${to}::date) as invoice_count,
    (select coalesce(sum(tax_cents), 0) from invoices where sub_account_id = any(${pgArray(ids)}) and status <> 'cancelled' and status <> 'draft' and issue_date >= ${from}::date and issue_date < ${to}::date) as gst,
    (select coalesce(sum(total_cents - amount_paid_cents), 0) from invoices where sub_account_id = any(${pgArray(ids)}) and status in ('sent','viewed','partially_paid','overdue')) as outstanding,
    (select coalesce(sum(total_cents - amount_paid_cents), 0) from invoices where sub_account_id = any(${pgArray(ids)}) and status = 'overdue') as overdue`);

  const monthly = (await tx.execute<{ month: string; cents: number }>(sql`
    select to_char(date_trunc('month', paid_at at time zone 'Australia/Melbourne'), 'YYYY-MM') as month,
      coalesce(sum(amount_cents - refunded_cents), 0) as cents
    from payments where sub_account_id = any(${pgArray(ids)}) and status in ('succeeded','partially_refunded')
      and paid_at >= date_trunc('month', now()) - interval '11 months'
    group by 1 order by 1`)).rows;

  const bySource = (await tx.execute<{ source: string; leads: number; converted: number }>(sql`
    select source, count(*) as leads, count(*) filter (where status = 'converted') as converted
    from leads where sub_account_id = any(${pgArray(ids)}) and created_at >= ${from} and created_at < ${to}
    group by source order by leads desc`)).rows;

  const comms = await one<Record<string, number>>(sql`select
    count(*) filter (where channel = 'email' and direction = 'outbound' and status = 'sent') as emails_sent,
    count(*) filter (where channel = 'sms' and direction = 'outbound' and status = 'sent') as sms_sent,
    count(*) filter (where direction = 'inbound') as inbound,
    count(*) filter (where direction = 'outbound' and status = 'failed') as failed
    from messages where sub_account_id = any(${pgArray(ids)}) and created_at >= ${from} and created_at < ${to}`);

  const campaignsRows = (await tx.execute<{ id: string; sub_account_id: string; name: string; channel: string; sent_at: string; stats: Record<string, number> }>(sql`
    select id, sub_account_id, name, channel, sent_at, stats from campaigns
    where sub_account_id = any(${pgArray(ids)}) and status = 'sent' and sent_at >= ${from} and sent_at < ${to} order by sent_at desc limit 10`)).rows;

  const customers = await one<Record<string, number>>(sql`
    with paid as (
      select contact_id, count(*) as n, sum(total_cents) as value from invoices
      where sub_account_id = any(${pgArray(ids)}) and status = 'paid' and contact_id is not null group by contact_id
    )
    select
      (select count(*) from contacts where sub_account_id = any(${pgArray(ids)}) and status = 'customer' and created_at >= ${from} and created_at < ${to}) as new_customers,
      (select count(*) from paid where n > 1) as repeat_customers,
      (select coalesce(avg(value), 0) from paid) as avg_customer_value,
      (select count(*) from paid) as paying_customers`);

  const n = (v: unknown) => Number(v ?? 0);
  return {
    sales: {
      leads: n(sales.leads), converted: n(sales.converted), conversionRate: n(sales.leads) ? n(sales.converted) / n(sales.leads) : 0,
      pipelineValueCents: n(sales.pipeline_value), won: n(sales.won), wonValueCents: n(sales.won_value), lost: n(sales.lost),
      quotesSent: n(sales.quotes_sent), quotesAccepted: n(sales.quotes_accepted),
    },
    revenue: {
      paidCents: n(revenue.paid), invoicedCents: n(revenue.invoiced), invoiceCount: n(revenue.invoice_count), gstCents: n(revenue.gst),
      outstandingCents: n(revenue.outstanding), overdueCents: n(revenue.overdue),
      averageInvoiceCents: n(revenue.invoice_count) ? Math.round(n(revenue.invoiced) / n(revenue.invoice_count)) : 0,
      monthly: monthly.map((m) => ({ month: m.month, cents: n(m.cents) })),
    },
    marketing: {
      bySource: bySource.map((s) => ({ source: s.source, leads: n(s.leads), converted: n(s.converted) })),
      emailsSent: n(comms.emails_sent), smsSent: n(comms.sms_sent), inbound: n(comms.inbound), failed: n(comms.failed),
      campaigns: campaignsRows,
    },
    customers: {
      newCustomers: n(customers.new_customers), repeatCustomers: n(customers.repeat_customers),
      averageCustomerValueCents: Math.round(n(customers.avg_customer_value)), payingCustomers: n(customers.paying_customers),
    },
  };
}

export type Report = Awaited<ReturnType<typeof getReport>>;
