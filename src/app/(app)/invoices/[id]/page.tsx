import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/db/context';
import { formatDateTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { getTaxRegime } from '@/lib/tax';
import { businessById, readScope, requireContext } from '@/server/context';
import { loadInvoice } from '@/server/queries/documents';
import { invoiceUrl } from '@/server/services/finance';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { DocumentView } from '@/components/documents/document-view';
import { InvoiceActions } from './actions';
import { RefundButton } from './refund-button';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const d = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, (tx) => loadInvoice(tx, { id }));
  if (!d) notFound();
  const { inv } = d;
  const balance = inv.totalCents - inv.amountPaidCents;
  const warnings = getTaxRegime(d.business.taxRegime).documentWarnings?.({ kind: 'invoice', totalCents: inv.totalCents, taxRegistered: d.business.taxRegistered, businessId: d.business.abn, buyerName: d.customer?.company ?? d.customer?.name, buyerBusinessId: d.customer?.abn }) ?? [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted"><Link href="/invoices" className="hover:underline">Invoices</Link></p>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">{inv.number} <StatusBadge status={inv.status} /></h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <BusinessBadge business={businessById(ctx, inv.subAccountId)} full />
            {d.contact ? <Link href={`/contacts/${d.contact.id}`} className="hover:underline">{d.customer?.name}</Link> : null}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">{inv.status === 'paid' ? 'Paid' : 'Balance due'}</p>
          <p className={`text-3xl font-semibold tabular-nums ${inv.status === 'overdue' ? 'text-danger' : ''}`}>{formatMoney(inv.status === 'paid' ? inv.totalCents : balance)}</p>
        </div>
      </div>
      {warnings.length && inv.status === 'draft' ? <div className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">{warnings.map((w) => <p key={w}>• {w}</p>)}</div> : null}
      <InvoiceActions inv={{ id: inv.id, subAccountId: inv.subAccountId, status: inv.status, number: inv.number, amountPaidCents: inv.amountPaidCents }} link={invoiceUrl(inv.publicToken)} hasEmail={!!d.contact?.email} hasPhone={!!d.contact?.phone} balance={formatMoney(balance)} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DocumentView business={d.business} customer={d.customer} lines={d.lines} doc={{ ...inv, kind: 'invoice' }} />
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Payments" />
            <CardBody>
              {d.payments.length ? d.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 text-sm">
                  <div><p className="font-medium">{formatMoney(p.amountCents, p.currency)}</p><p className="text-xs text-muted">{p.paidAt ? formatDateTime(p.paidAt, ctx.tz) : '—'} · {p.method.replace('_', ' ')}{p.cardLast4 ? ` ····${p.cardLast4}` : ''}</p></div>
                  <div className="flex items-center gap-2"><StatusBadge status={p.status} />{p.status === 'succeeded' ? <RefundButton subAccountId={p.subAccountId} paymentId={p.id} label={formatMoney(p.amountCents - p.refundedCents, p.currency)} /> : null}</div>
                </div>
              )) : <p className="text-sm text-muted">No payments yet.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody className="space-y-2">
              {d.log.map((a) => <div key={a.id} className="text-sm"><p>{a.summary}</p><p className="text-xs text-muted">{formatDateTime(a.createdAt, ctx.tz)}</p></div>)}
              {inv.viewedAt ? <p className="text-sm">Viewed by customer <span className="text-xs text-muted">{formatDateTime(inv.viewedAt, ctx.tz)}</span></p> : null}
              {inv.reminderCount ? <p className="text-sm">{inv.reminderCount} reminder{inv.reminderCount === 1 ? '' : 's'} sent</p> : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
