import { requireContext } from '@/server/context';
import { editorBusinesses, editorData } from '@/server/queries/editor';
import { saveQuoteAction } from '@/server/actions/finance';
import { PageHeader } from '@/components/ui/page';
import { DocEditor } from '@/components/documents/doc-editor';
import { ModuleOff } from '@/components/module-off';
import { sp1, type SP } from '@/server/page-helpers';
import { addDaysKey, todayKey } from '@/lib/dates';

export const metadata = { title: 'New quote' };

export default async function NewQuotePage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const businesses = editorBusinesses(ctx, 'quotes');
  if (!businesses.length) return <ModuleOff label="Quotes" business={ctx.current?.name} />;
  const data = await editorData(ctx, businesses.map((b) => b.id), sp1(p.contact));
  const biz = ctx.current ?? (data.contact ? ctx.businesses.find((b) => b.id === data.contact!.subAccountId) : null) ?? null;
  return (
    <div>
      <PageHeader title="New quote" subtitle={biz ? biz.name : 'Pick a customer — the business follows'} />
      <DocEditor kind="quote" action={saveQuoteAction} products={data.products} businesses={businesses}
        business={biz ? businesses.find((b) => b.id === biz.id) ?? null : null}
        initial={{ contact: data.contact, lines: [], pricesIncludeTax: biz?.pricesIncludeTax ?? false, expiryDate: addDaysKey(todayKey(ctx.tz), biz?.quoteValidityDays ?? 30), terms: biz?.quoteTerms ?? '', createJob: true, createInvoice: true }} />
    </div>
  );
}
