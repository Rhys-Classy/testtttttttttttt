import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/db/context';
import { formatDateTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { businessById, readScope, requireContext } from '@/server/context';
import { loadQuote } from '@/server/queries/documents';
import { quoteUrl } from '@/server/services/finance';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { DocumentView } from '@/components/documents/document-view';
import { QuoteActions } from './actions';

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const d = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, (tx) => loadQuote(tx, { id }));
  if (!d) notFound();
  const { q } = d;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted"><Link href="/quotes" className="hover:underline">Quotes</Link></p>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">{q.number} <StatusBadge status={q.status} /></h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <BusinessBadge business={businessById(ctx, q.subAccountId)} full />
            {d.contact ? <Link href={`/contacts/${d.contact.id}`} className="hover:underline">{d.customer?.name}</Link> : null}
            {q.acceptedByName ? <span>Accepted by {q.acceptedByName}</span> : null}
          </div>
        </div>
        <p className="text-3xl font-semibold tabular-nums">{formatMoney(q.totalCents)}</p>
      </div>
      <QuoteActions q={{ id: q.id, subAccountId: q.subAccountId, status: q.status, invoiceId: q.invoiceId, jobId: q.jobId }} link={quoteUrl(q.publicToken)} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><DocumentView business={d.business} customer={d.customer} lines={d.lines} doc={{ ...q, kind: 'quote' }} /></div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="When accepted" />
            <CardBody className="space-y-1 text-sm">
              <p>{q.acceptOptions?.createJob ? '✓ Create a job' : '— No job'}</p>
              <p>{q.acceptOptions?.createInvoice ? `✓ Invoice ${q.acceptOptions.depositPercent ? `${q.acceptOptions.depositPercent}% deposit` : 'full amount'}` : '— No invoice'}</p>
              <p>{q.acceptOptions?.markDealWon !== false ? '✓ Mark the deal won' : ''}</p>
              <p className="text-muted">Plus any automations using “Quote accepted”.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody className="space-y-2">
              {d.log.map((a) => <div key={a.id} className="text-sm"><p>{a.summary}</p><p className="text-xs text-muted">{formatDateTime(a.createdAt, ctx.tz)}</p></div>)}
              {q.viewedAt ? <p className="text-sm">Viewed by customer <span className="text-xs text-muted">{formatDateTime(q.viewedAt, ctx.tz)}</span></p> : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
