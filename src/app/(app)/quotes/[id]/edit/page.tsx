import { notFound } from 'next/navigation';
import { isUuid } from '@/db/context';
import { readScope, requireContext } from '@/server/context';
import { loadQuote } from '@/server/queries/documents';
import { editorBusinesses, editorData } from '@/server/queries/editor';
import { saveQuoteAction } from '@/server/actions/finance';
import { PageHeader } from '@/components/ui/page';
import { DocEditor } from '@/components/documents/doc-editor';

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const d = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, (tx) => loadQuote(tx, { id }));
  if (!d) notFound();
  const businesses = editorBusinesses({ ...ctx, current: ctx.businesses.find((b) => b.id === d.q.subAccountId) ?? null }, 'quotes');
  const data = await editorData(ctx, [d.q.subAccountId]);
  return (
    <div>
      <PageHeader title={`Edit ${d.q.number}`} subtitle={d.business.name} />
      <DocEditor kind="quote" action={saveQuoteAction} products={data.products} businesses={businesses} business={businesses[0] ?? null}
        initial={{
          id: d.q.id, subAccountId: d.q.subAccountId, contact: d.contact ? { id: d.contact.id, label: d.customer!.name, subAccountId: d.q.subAccountId } : null,
          title: d.q.title ?? '', notes: d.q.notes ?? '', terms: d.q.terms ?? '', expiryDate: d.q.expiryDate ?? undefined, pricesIncludeTax: d.q.pricesIncludeTax,
          depositPercent: d.q.acceptOptions?.depositPercent ? String(d.q.acceptOptions.depositPercent) : '', createJob: d.q.acceptOptions?.createJob, createInvoice: d.q.acceptOptions?.createInvoice,
          lines: d.lines.map((l) => ({ productId: l.productId, description: l.description, quantity: String(Number(l.quantity)), unitPrice: (l.unitPriceCents / 100).toFixed(2), discountPercent: l.discountPercent ? String(Number(l.discountPercent)) : '', taxCode: l.taxCode })),
        }} />
    </div>
  );
}
