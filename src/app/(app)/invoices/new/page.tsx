import { requireContext } from '@/server/context';
import { editorBusinesses, editorData } from '@/server/queries/editor';
import { saveInvoiceAction } from '@/server/actions/finance';
import { PageHeader } from '@/components/ui/page';
import { DocEditor } from '@/components/documents/doc-editor';
import { ModuleOff } from '@/components/module-off';
import { sp1, type SP } from '@/server/page-helpers';
import { addDaysKey, todayKey } from '@/lib/dates';

export const metadata = { title: 'New invoice' };

export default async function NewInvoicePage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const businesses = editorBusinesses(ctx, 'invoices');
  if (!businesses.length) return <ModuleOff label="Invoices" business={ctx.current?.name} />;
  const data = await editorData(ctx, businesses.map((b) => b.id), sp1(p.contact));
  const biz = ctx.current ?? (data.contact ? ctx.businesses.find((b) => b.id === data.contact!.subAccountId) : null) ?? null;
  return (
    <div>
      <PageHeader title="New invoice" subtitle={biz ? biz.name : 'Pick a customer — the business follows'} />
      <DocEditor kind="invoice" action={saveInvoiceAction} products={data.products} businesses={businesses}
        business={biz ? businesses.find((b) => b.id === biz.id) ?? null : null}
        initial={{ contact: data.contact, lines: [], pricesIncludeTax: biz?.pricesIncludeTax ?? false, dueDate: addDaysKey(todayKey(ctx.tz), biz?.paymentTermsDays ?? 14), terms: biz?.invoiceTerms ?? '' }} />
    </div>
  );
}
