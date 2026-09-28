'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { saveProductAction } from '@/server/actions/finance';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { toast } from '@/components/toast';

export type ProductRow = { id: string; subAccountId: string; name: string; sku: string | null; description: string | null; price: string; cost: string; taxCode: string; category: string | null; kind: string; unit: string | null; active: boolean };

export function ProductForm({ businesses, taxCodes, product, trigger }: { businesses: { id: string; name: string }[]; taxCodes: { code: string; label: string }[]; product?: ProductRow; trigger?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <div onClick={() => { setErr(null); ref.current?.showModal(); }}>{trigger ?? <Button variant="primary"><Plus className="size-4" />Add product</Button>}</div>
      <dialog ref={ref} className="m-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-3xl border border-border bg-surface p-0 text-text">
        <form action={(fd) => start(async () => { const r = await saveProductAction(fd); if (!r.ok) { setErr(r.error); return; } ref.current?.close(); toast('Saved'); router.refresh(); })} className="space-y-3 p-5">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{product ? 'Edit' : 'New'} product or service</h2><button type="button" onClick={() => ref.current?.close()} className="text-muted"><X className="size-5" /></button></div>
          <FormError error={err} />
          {product ? <input type="hidden" name="id" value={product.id} /> : null}
          {product ? <input type="hidden" name="subAccountId" value={product.subAccountId} /> : businesses.length === 1 ? <input type="hidden" name="subAccountId" value={businesses[0].id} /> : (
            <Field label="Business"><Select name="subAccountId" required defaultValue=""><option value="" disabled>Choose…</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          )}
          <Field label="Name"><Input name="name" required defaultValue={product?.name} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (ex GST)"><Input name="price" required inputMode="decimal" defaultValue={product?.price} placeholder="$" /></Field>
            <Field label="Cost (optional)"><Input name="cost" inputMode="decimal" defaultValue={product?.cost} placeholder="$" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Type"><Select name="kind" defaultValue={product?.kind ?? 'service'}><option value="service">Service</option><option value="product">Product</option></Select></Field>
            <Field label="Tax"><Select name="taxCode" defaultValue={product?.taxCode ?? 'GST'}>{taxCodes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</Select></Field>
            <Field label="Unit"><Input name="unit" defaultValue={product?.unit ?? ''} placeholder="each" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU"><Input name="sku" defaultValue={product?.sku ?? ''} /></Field>
            <Field label="Category"><Input name="category" defaultValue={product?.category ?? ''} /></Field>
          </div>
          <Field label="Description"><Textarea name="description" rows={2} defaultValue={product?.description ?? ''} /></Field>
          {product ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" value="on" defaultChecked={product.active} onChange={(e) => { e.currentTarget.value = e.currentTarget.checked ? 'on' : 'off'; }} />Active</label> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        </form>
      </dialog>
    </>
  );
}
