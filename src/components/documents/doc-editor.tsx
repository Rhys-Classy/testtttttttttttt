'use client';

import { useMemo, useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { calculateDocument, getTaxRegime } from '@/lib/tax';
import { formatMoney, parseMoney } from '@/lib/money';
import { ContactPicker } from '@/components/contact-picker';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';

export type EditorLine = { productId?: string | null; description: string; quantity: string; unitPrice: string; discountPercent: string; taxCode: string };
export type EditorProduct = { id: string; name: string; priceCents: number; taxCode: string; description: string | null };

type Props = {
  kind: 'invoice' | 'quote';
  action: (fd: FormData) => Promise<{ ok: false; error: string } | { ok: true } | void>;
  initial: {
    id?: string;
    subAccountId?: string;
    contact?: { id: string; label: string; subAccountId: string } | null;
    title?: string;
    lines: EditorLine[];
    notes?: string;
    terms?: string;
    dueDate?: string;
    expiryDate?: string;
    pricesIncludeTax: boolean;
    depositPercent?: string;
    createJob?: boolean;
    createInvoice?: boolean;
  };
  business: { id: string; name: string; taxRegime: string; taxRegistered: boolean } | null;
  businesses: { id: string; name: string; taxRegime: string; taxRegistered: boolean }[];
  products: Record<string, EditorProduct[]>;
};

const blank = (taxCode = 'GST'): EditorLine => ({ description: '', quantity: '1', unitPrice: '', discountPercent: '', taxCode });

/** Line item editor with live GST maths (same calculator the server uses). */
export function DocEditor({ kind, action, initial, business, businesses, products }: Props) {
  const [subAccountId, setSubAccountId] = useState(initial.subAccountId ?? business?.id ?? initial.contact?.subAccountId ?? '');
  const biz = businesses.find((b) => b.id === subAccountId) ?? business;
  const regime = getTaxRegime(biz?.taxRegime);
  const [lines, setLines] = useState<EditorLine[]>(initial.lines.length ? initial.lines : [blank(regime.defaultCode)]);
  const [inc, setInc] = useState(initial.pricesIncludeTax);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const catalog = products[subAccountId] ?? [];

  const totals = useMemo(() => calculateDocument(lines.map((l) => ({
    quantity: Number(l.quantity) || 0, unitPriceCents: parseMoney(l.unitPrice) ?? 0, discountPercent: Number(l.discountPercent) || 0, taxCode: l.taxCode,
  })), { regime, pricesIncludeTax: inc, taxRegistered: biz?.taxRegistered ?? true }), [lines, inc, regime, biz]);

  const set = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickProduct = (i: number, id: string) => {
    const p = catalog.find((x) => x.id === id);
    if (p) set(i, { productId: p.id, description: p.name, unitPrice: (p.priceCents / 100).toFixed(2), taxCode: p.taxCode });
  };

  const submit = (fd: FormData) => {
    setError(null);
    fd.set('lines', JSON.stringify(lines));
    fd.set('pricesIncludeTax', String(inc));
    fd.set('subAccountId', subAccountId);
    start(async () => {
      const res = await action(fd);
      if (res && !res.ok) setError(res.error);
    });
  };

  return (
    <form action={submit} className="space-y-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <FormError error={error} />
      <div className="grid gap-4 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2">
        <Field label="Customer">
          <ContactPicker required initial={initial.contact ?? null} onPick={(h) => h && setSubAccountId(h.subAccountId)} />
        </Field>
        {!business && !initial.contact ? (
          <Field label="Business" hint="Picked automatically from the customer">
            <Select value={subAccountId} onChange={(e) => setSubAccountId(e.target.value)} required>
              <option value="">Choose…</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        ) : <Field label="Business"><Input value={biz?.name ?? ''} readOnly className="bg-surface-2" /></Field>}
        <Field label="Title (optional)" className="sm:col-span-2"><Input name="title" defaultValue={initial.title} placeholder={kind === 'quote' ? 'L-shape kitchen facelift' : 'Doors supplied and installed'} /></Field>
        {kind === 'invoice' ? (
          <Field label="Due date"><Input name="dueDate" type="date" defaultValue={initial.dueDate} /></Field>
        ) : (
          <Field label="Valid until"><Input name="expiryDate" type="date" defaultValue={initial.expiryDate} /></Field>
        )}
        <Field label={`Prices`}>
          <Select value={inc ? 'inc' : 'ex'} onChange={(e) => setInc(e.target.value === 'inc')}>
            <option value="ex">Exclude {regime.taxName} (add on top)</option>
            <option value="inc">Include {regime.taxName}</option>
          </Select>
        </Field>
      </div>

      <div className="rounded-2xl border border-border bg-surface">
        <div className="hidden grid-cols-[1fr_5rem_7rem_5rem_7rem_7rem_2.5rem] gap-2 border-b border-border px-4 py-2 text-xs font-medium text-muted md:grid">
          <span>Item</span><span>Qty</span><span>Price</span><span>Disc %</span><span>{regime.taxName}</span><span className="text-right">Amount</span><span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 border-b border-border px-4 py-3 last:border-0 md:grid-cols-[1fr_5rem_7rem_5rem_7rem_7rem_2.5rem] md:items-center">
            <div className="col-span-2 space-y-1.5 md:col-span-1">
              {catalog.length ? (
                <select value={l.productId ?? ''} onChange={(e) => pickProduct(i, e.target.value)} className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs text-muted" aria-label="Product">
                  <option value="">Pick from catalogue…</option>
                  {catalog.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.priceCents)}</option>)}
                </select>
              ) : null}
              <Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Description" aria-label="Description" />
            </div>
            <Input value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} inputMode="decimal" aria-label="Quantity" placeholder="Qty" />
            <Input value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} inputMode="decimal" aria-label="Unit price" placeholder="$0.00" />
            <Input value={l.discountPercent} onChange={(e) => set(i, { discountPercent: e.target.value })} inputMode="decimal" aria-label="Discount %" placeholder="0" />
            <Select value={l.taxCode} onChange={(e) => set(i, { taxCode: e.target.value })} aria-label="Tax">
              {regime.codes.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </Select>
            <p className="text-right text-sm font-medium tabular-nums">{formatMoney(inc ? totals.lines[i]?.lineTotalCents : totals.lines[i]?.lineSubtotalCents)}</p>
            <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="flex size-9 items-center justify-center justify-self-end rounded-lg text-muted hover:bg-danger-soft hover:text-danger" aria-label="Remove line"><Trash2 className="size-4" /></button>
          </div>
        ))}
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
          <Button type="button" variant="soft" size="sm" onClick={() => setLines((ls) => [...ls, blank(regime.defaultCode)])}><Plus className="size-4" />Add line</Button>
          <dl className="w-full space-y-1 text-sm sm:w-64">
            <div className="flex justify-between"><dt className="text-muted">Subtotal (ex {regime.taxName})</dt><dd className="tabular-nums">{formatMoney(totals.subtotalCents)}</dd></div>
            {totals.discountCents ? <div className="flex justify-between"><dt className="text-muted">Includes discount</dt><dd className="tabular-nums">−{formatMoney(totals.discountCents)}</dd></div> : null}
            <div className="flex justify-between"><dt className="text-muted">{regime.taxName}</dt><dd className="tabular-nums">{formatMoney(totals.taxCents)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(totals.totalCents)}</dd></div>
          </dl>
        </div>
      </div>

      {kind === 'quote' ? (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="mb-3 text-sm font-medium">When the customer accepts online</p>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="createJob" defaultChecked={initial.createJob ?? true} />Create a job</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="createInvoice" defaultChecked={initial.createInvoice ?? true} />Create an invoice for</label>
            <div className="flex items-center gap-2 pl-6"><Input name="depositPercent" defaultValue={initial.depositPercent} inputMode="decimal" placeholder="100" className="h-9 w-20" /><span className="text-muted">% of the total (blank = full amount)</span></div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Notes to customer"><Textarea name="notes" defaultValue={initial.notes} rows={3} /></Field>
        <Field label="Terms"><Textarea name="terms" defaultValue={initial.terms} rows={3} /></Field>
      </div>

      <div className="sticky bottom-20 z-10 flex justify-end gap-2 rounded-2xl border border-border bg-surface/95 p-3 backdrop-blur md:bottom-4">
        <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>Save draft</Button>
        <Button type="submit" name="intent" value="send" variant="primary" disabled={pending}>{pending ? 'Saving…' : `Save & send`}</Button>
      </div>
    </form>
  );
}
