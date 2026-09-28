import { notFound, redirect } from 'next/navigation';
import { withPublic } from '@/db/context';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { resolvePublic } from '@/server/public';
import { loadInvoice } from '@/server/queries/documents';
import { markInvoiceViewed } from '@/server/services/finance';
import { createPayNowSession, getStripeCreds } from '@/server/services/stripe';
import { DocumentView } from '@/components/documents/document-view';
import { friendlyError } from '@/server/actions/_util';
import { PrintOnLoad } from '../../print-on-load';

export const metadata = { title: 'Invoice', robots: { index: false } };

async function payNow(token: string) {
  'use server';
  const subAccountId = await resolvePublic('invoice', token);
  if (!subAccountId) notFound();
  let url: string | null = null;
  try {
    url = await withPublic(subAccountId, async (tx) => {
      const d = await loadInvoice(tx, { token });
      if (!d) return null;
      return createPayNowSession(tx, { subAccountId, userId: null, actor: 'public' }, d.inv.id);
    });
  } catch (e) {
    redirect(`/i/${token}?error=${encodeURIComponent(friendlyError(e))}`);
  }
  if (url) redirect(url);
}

export default async function PublicInvoicePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const subAccountId = await resolvePublic('invoice', token);
  if (!subAccountId) notFound();
  const d = await withPublic(subAccountId, async (tx) => {
    const data = await loadInvoice(tx, { token });
    if (data && !sp.print && data.inv.status !== 'draft') await markInvoiceViewed(tx, { subAccountId, userId: null, actor: 'public' }, data.inv.id);
    return data ? { ...data, stripe: !!(await getStripeCreds(tx, { subAccountId, userId: null, actor: 'public' })) } : null;
  });
  if (!d || d.inv.status === 'draft') notFound();
  const balance = d.inv.totalCents - d.inv.amountPaidCents;
  const payable = !['paid', 'cancelled'].includes(d.inv.status) && balance > 0;
  return (
    <div className="min-h-dvh bg-slate-100 px-3 py-6 text-slate-900 print:bg-white print:p-0 sm:py-10">
      {sp.print ? <PrintOnLoad /> : null}
      <div className="mx-auto max-w-3xl space-y-4">
        {sp.accepted ? <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 print:hidden">Quote accepted — thank you! {payable ? 'Your deposit invoice is below.' : ''}</div> : null}
        {sp.paid ? <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 print:hidden">Thanks! Your payment is being confirmed — you&apos;ll get a receipt by email.</div> : null}
        {sp.error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">{sp.error}</div> : null}
        {d.inv.status === 'cancelled' ? <div className="rounded-2xl bg-slate-200 px-4 py-3 text-sm print:hidden">This invoice has been cancelled.</div> : null}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm print:hidden">
          <div>
            <p className="text-sm text-slate-500">{d.inv.status === 'paid' ? 'Paid in full' : `Due ${formatDate(d.inv.dueDate)}`}</p>
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(d.inv.status === 'paid' ? d.inv.totalCents : balance, d.inv.currency)}</p>
          </div>
          {payable && d.stripe ? (
            <form action={payNow.bind(null, token)}>
              <button className="h-12 rounded-xl px-6 text-base font-semibold text-white" style={{ backgroundColor: d.business.color }}>Pay now</button>
            </form>
          ) : d.inv.status === 'paid' ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">Paid</span>
            : payable && d.business.bankDetails ? <p className="whitespace-pre-line text-right text-sm text-slate-600">{d.business.bankDetails}{'\n'}Ref: {d.inv.number}</p> : null}
        </div>
        <DocumentView business={d.business} customer={d.customer} lines={d.lines} doc={{ ...d.inv, kind: 'invoice' }} />
        <p className="text-center text-xs text-slate-400 print:hidden">Questions? Reply to the email or call {d.business.phone ?? d.business.name}.</p>
      </div>
    </div>
  );
}
