import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { getTaxRegime } from '@/lib/tax';
import type { Business } from '@/server/services/_common';

type Line = { id: string; description: string; quantity: number; unitPriceCents: number; discountPercent: number; taxCode: string; taxRateBps: number; lineSubtotalCents: number; lineTaxCents: number; lineTotalCents: number };
type Doc = {
  kind: 'invoice' | 'quote';
  number: string;
  title: string | null;
  issueDate: string;
  dueDate?: string | null;
  expiryDate?: string | null;
  pricesIncludeTax: boolean;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents?: number;
  currency: string;
  notes: string | null;
  terms: string | null;
};
type Party = { name: string; company?: string | null; email?: string | null; phone?: string | null; address?: Record<string, string | undefined> | null; abn?: string | null } | null;

/** The customer-facing document: used in-app, on the public link and when printing to PDF. */
export function DocumentView({ doc, lines, business, customer, tone = 'paper' }: { doc: Doc; lines: Line[]; business: Business; customer: Party; tone?: 'paper' | 'app' }) {
  const regime = getTaxRegime(business.taxRegime);
  const title = regime.documentTitle(doc.kind, business.taxRegistered);
  const accent = (doc.kind === 'invoice' ? business.branding?.invoiceAccent : business.branding?.quoteAccent) ?? business.color;
  const addr = (a?: Record<string, string | undefined> | null) => (a ? [a.line1, a.line2, [a.suburb, a.state, a.postcode].filter(Boolean).join(' ')].filter(Boolean) : []);
  const balance = doc.totalCents - (doc.amountPaidCents ?? 0);
  const hasDiscount = lines.some((l) => l.discountPercent);
  return (
    <article className={`${tone === 'app' ? 'doc-app' : 'doc-paper'} overflow-hidden rounded-2xl border border-border bg-(--doc-bg) text-(--doc-text) print:rounded-none print:border-0`}>
      <div className="h-2" style={{ backgroundColor: accent }} />
      <div className="p-6 sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            {business.branding?.logoUrl ? <img src={business.branding.logoUrl} alt="" className="mb-3 h-12 w-auto" /> : null}
            <p className="text-lg font-semibold">{business.tradingName ?? business.name}</p>
            {business.legalName && business.legalName !== (business.tradingName ?? business.name) ? <p className="text-sm text-(--doc-muted)">{business.legalName}</p> : null}
            <div className="mt-1 text-sm text-(--doc-muted)">
              {addr(business.address).map((l) => <p key={l}>{l}</p>)}
              {business.phone ? <p>{business.phone}</p> : null}
              {business.email ? <p>{business.email}</p> : null}
              {business.abn ? <p>{regime.businessIdLabel} {regime.formatBusinessId ? regime.formatBusinessId(business.abn) : business.abn}</p> : null}
              {business.acn ? <p>{regime.secondaryBusinessIdLabel ?? 'ACN'} {business.acn}</p> : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tracking-tight" style={{ color: accent }}>{title}</p>
            <p className="mt-1 text-sm font-medium">{doc.number}</p>
            <dl className="mt-3 space-y-0.5 text-sm text-(--doc-muted)">
              <div><dt className="inline">Date: </dt><dd className="inline">{formatDate(doc.issueDate)}</dd></div>
              {doc.dueDate ? <div><dt className="inline">Due: </dt><dd className="inline font-medium text-(--doc-text)">{formatDate(doc.dueDate)}</dd></div> : null}
              {doc.expiryDate ? <div><dt className="inline">Valid until: </dt><dd className="inline">{formatDate(doc.expiryDate)}</dd></div> : null}
            </dl>
          </div>
        </header>

        <section className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-(--doc-muted)">{doc.kind === 'invoice' ? 'Bill to' : 'Prepared for'}</p>
          {customer ? (
            <div className="mt-1 text-sm">
              <p className="font-medium">{customer.company ?? customer.name}</p>
              {customer.company ? <p>{customer.name}</p> : null}
              {addr(customer.address).map((l) => <p key={l} className="text-(--doc-muted)">{l}</p>)}
              {customer.email ? <p className="text-(--doc-muted)">{customer.email}</p> : null}
              {customer.abn ? <p className="text-(--doc-muted)">{regime.businessIdLabel} {customer.abn}</p> : null}
            </div>
          ) : <p className="mt-1 text-sm text-(--doc-muted)">—</p>}
          {doc.title ? <p className="mt-4 font-medium">{doc.title}</p> : null}
        </section>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-(--doc-line) text-left text-xs uppercase tracking-wider text-(--doc-muted)">
              <th className="py-2 pr-2 font-medium">Description</th>
              <th className="py-2 px-2 text-right font-medium">Qty</th>
              <th className="py-2 px-2 text-right font-medium">Price</th>
              {hasDiscount ? <th className="py-2 px-2 text-right font-medium">Disc</th> : null}
              <th className="hidden py-2 px-2 text-right font-medium sm:table-cell">{regime.taxName}</th>
              <th className="py-2 pl-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-(--doc-line-soft) align-top">
                <td className="py-2.5 pr-2">{l.description}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{Number(l.quantity)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{formatMoney(l.unitPriceCents, doc.currency)}</td>
                {hasDiscount ? <td className="py-2.5 px-2 text-right tabular-nums">{l.discountPercent ? `${Number(l.discountPercent)}%` : ''}</td> : null}
                <td className="hidden py-2.5 px-2 text-right text-(--doc-muted) sm:table-cell">{l.taxRateBps ? `${l.taxRateBps / 100}%` : regime.codes.find((c) => c.code === l.taxCode)?.label ?? 'Free'}</td>
                <td className="py-2.5 pl-2 text-right tabular-nums">{formatMoney(doc.pricesIncludeTax ? l.lineTotalCents : l.lineSubtotalCents, doc.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-(--doc-muted)">Subtotal{doc.pricesIncludeTax ? '' : ` (ex ${regime.taxName})`}</dt><dd className="tabular-nums">{formatMoney(doc.pricesIncludeTax ? doc.totalCents : doc.subtotalCents, doc.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-(--doc-muted)">{doc.pricesIncludeTax ? `Includes ${regime.taxName}` : regime.taxName}</dt><dd className="tabular-nums">{formatMoney(doc.taxCents, doc.currency)}</dd></div>
            <div className="flex justify-between border-t border-(--doc-line) pt-1.5 text-base font-semibold"><dt>Total {doc.currency}</dt><dd className="tabular-nums">{formatMoney(doc.totalCents, doc.currency)}</dd></div>
            {doc.kind === 'invoice' && doc.amountPaidCents ? (
              <>
                <div className="flex justify-between text-(--doc-muted)"><dt>Paid</dt><dd className="tabular-nums">−{formatMoney(doc.amountPaidCents, doc.currency)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd className="tabular-nums">{formatMoney(balance, doc.currency)}</dd></div>
              </>
            ) : null}
          </dl>
        </div>

        {doc.notes || doc.terms || (doc.kind === 'invoice' && business.bankDetails) ? (
          <footer className="mt-8 grid grid-cols-1 gap-6 border-t border-(--doc-line) pt-6 text-sm sm:grid-cols-2">
            {doc.kind === 'invoice' && business.bankDetails ? <div><p className="text-xs font-semibold uppercase tracking-wider text-(--doc-muted)">How to pay</p><p className="mt-1 whitespace-pre-line">{business.bankDetails}</p></div> : null}
            {doc.notes ? <div><p className="text-xs font-semibold uppercase tracking-wider text-(--doc-muted)">Notes</p><p className="mt-1 whitespace-pre-line">{doc.notes}</p></div> : null}
            {doc.terms ? <div className="sm:col-span-2"><p className="text-xs font-semibold uppercase tracking-wider text-(--doc-muted)">Terms</p><p className="mt-1 whitespace-pre-line text-(--doc-muted)">{doc.terms}</p></div> : null}
          </footer>
        ) : null}
      </div>
    </article>
  );
}
