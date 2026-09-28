import { notFound, redirect } from 'next/navigation';
import { withPublic } from '@/db/context';
import { formatDate, todayKey } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { resolvePublic } from '@/server/public';
import { loadQuote } from '@/server/queries/documents';
import { acceptQuote, markQuoteViewed, rejectQuote, invoiceUrl } from '@/server/services/finance';
import { DocumentView } from '@/components/documents/document-view';
import { friendlyError } from '@/server/actions/_util';
import { invoices } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { PrintOnLoad } from '../../print-on-load';

export const metadata = { title: 'Quote', robots: { index: false } };

async function accept(token: string, fd: FormData) {
  'use server';
  const subAccountId = await resolvePublic('quote', token);
  if (!subAccountId) notFound();
  const name = String(fd.get('name') ?? '').trim();
  if (!name || fd.get('agree') !== 'on') redirect(`/q/${token}?error=${encodeURIComponent('Type your name and tick the box to accept.')}`);
  let next = `/q/${token}?accepted=1`;
  try {
    await withPublic(subAccountId, async (tx) => {
      const d = await loadQuote(tx, { token });
      if (!d) return;
      const r = await acceptQuote(tx, { subAccountId, userId: null, actor: 'public' }, d.q.id, { acceptedByName: name });
      if (r.invoiceId) {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, r.invoiceId));
        if (inv) {
          // Deposit invoice goes straight to the customer so they can pay now.
          const { sendInvoice } = await import('@/server/services/finance');
          await sendInvoice(tx, { subAccountId, userId: null, actor: 'public' }, inv.id);
          next = invoiceUrl(inv.publicToken).replace(/^https?:\/\/[^/]+/, '') + '?accepted=1';
        }
      }
    });
  } catch (e) {
    redirect(`/q/${token}?error=${encodeURIComponent(friendlyError(e))}`);
  }
  redirect(next);
}

async function decline(token: string, fd: FormData) {
  'use server';
  const subAccountId = await resolvePublic('quote', token);
  if (!subAccountId) notFound();
  await withPublic(subAccountId, async (tx) => {
    const d = await loadQuote(tx, { token });
    if (d && !['accepted', 'rejected'].includes(d.q.status)) await rejectQuote(tx, { subAccountId, userId: null, actor: 'public' }, d.q.id, String(fd.get('reason') ?? '') || undefined);
  });
  redirect(`/q/${token}`);
}

export default async function PublicQuotePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const subAccountId = await resolvePublic('quote', token);
  if (!subAccountId) notFound();
  const d = await withPublic(subAccountId, async (tx) => {
    const data = await loadQuote(tx, { token });
    if (data && !sp.print && data.q.status !== 'draft') await markQuoteViewed(tx, { subAccountId, userId: null, actor: 'public' }, data.q.id);
    return data;
  });
  if (!d || d.q.status === 'draft') notFound();
  const expired = !!d.q.expiryDate && d.q.expiryDate < todayKey(d.business.timezone);
  const open = ['sent', 'viewed'].includes(d.q.status) && !expired;
  return (
    <div className="min-h-dvh bg-slate-100 px-3 py-6 text-slate-900 print:bg-white print:p-0 sm:py-10">
      {sp.print ? <PrintOnLoad /> : null}
      <div className="mx-auto max-w-3xl space-y-4">
        {sp.error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">{sp.error}</div> : null}
        {d.q.status === 'accepted' ? <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 print:hidden">Accepted{d.q.acceptedByName ? ` by ${d.q.acceptedByName}` : ''}. Thank you! We&apos;ll be in touch to lock in dates.</div> : null}
        {d.q.status === 'rejected' ? <div className="rounded-2xl bg-slate-200 px-4 py-3 text-sm print:hidden">This quote was declined. Changed your mind? Just get in touch.</div> : null}
        {expired && d.q.status !== 'accepted' ? <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">This quote expired on {formatDate(d.q.expiryDate)}. Contact us for an updated price.</div> : null}
        <DocumentView business={d.business} customer={d.customer} lines={d.lines} doc={{ ...d.q, kind: 'quote' }} />
        {open ? (
          <div className="grid grid-cols-1 gap-4 print:hidden sm:grid-cols-3">
            <form action={accept.bind(null, token)} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm sm:col-span-2">
              <p className="font-semibold">Accept this quote ({formatMoney(d.q.totalCents, d.q.currency)})</p>
              <input name="name" required placeholder="Your full name" className="h-12 w-full rounded-xl border border-slate-300 px-3" />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="agree" required className="mt-1" />I accept this quote and its terms.</label>
              <button className="h-12 w-full rounded-xl text-base font-semibold text-white" style={{ backgroundColor: d.business.color }}>Accept quote</button>
            </form>
            <form action={decline.bind(null, token)} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
              <p className="font-semibold">Not right?</p>
              <textarea name="reason" rows={3} placeholder="Tell us why (optional)" className="w-full rounded-xl border border-slate-300 p-3 text-sm" />
              <button className="h-11 w-full rounded-xl border border-slate-300 text-sm font-medium">Decline</button>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  );
}
