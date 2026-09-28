import { notFound } from 'next/navigation';
import { isUuid } from '@/db/context';
import { readScope, requireContext } from '@/server/context';
import { loadInvoice } from '@/server/queries/documents';
import { editorBusinesses, editorData } from '@/server/queries/editor';
import { saveInvoiceAction } from '@/server/actions/finance';
import { PageHeader } from '@/components/ui/page';
import { DocEditor } from '@/components/documents/doc-editor';

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const d = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, (tx) => loadInvoice(tx, { id }));
  if (!d) notFound();
  const businesses = editorBusinesses({ ...ctx, current: ctx.businesses.find((b) => b.id === d.inv.subAccountId) ?? null }, 'invoices');
  const data = await editorData(ctx, [d.inv.subAccountId]);
  return (
    <div>
      <PageHeader title={`Edit ${d.inv.number}`} subtitle={d.business.name} />
      <DocEditor kind="invoice" action={saveInvoiceAction} products={data.products} businesses={businesses} business={businesses[0] ?? null}
        initial={{
          id: d.inv.id, subAccountId: d.inv.subAccountId, contact: d.contact ? { id: d.contact.id, label: d.customer!.name, subAccountId: d.inv.subAccountId } : null,
          title: d.inv.title ?? '', notes: d.inv.notes ?? '', terms: d.inv.terms ?? '', dueDate: d.inv.dueDate, pricesIncludeTax: d.inv.pricesIncludeTax,
          lines: d.lines.map((l) => ({ productId: l.productId, description: l.description, quantity: String(Number(l.quantity)), unitPrice: (l.unitPriceCents / 100).toFixed(2), discountPercent: l.discountPercent ? String(Number(l.discountPercent)) : '', taxCode: l.taxCode })),
        }} />
    </div>
  );
}
