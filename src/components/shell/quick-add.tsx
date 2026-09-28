'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Briefcase, CalendarPlus, CheckSquare, CreditCard, FilePlus, FileText, Hammer, Plus, Sparkles, StickyNote, UserPlus, X,
} from 'lucide-react';
import { quickAddAction, type QuickKind } from '@/server/actions/quick-add';
import { ContactPicker } from '@/components/contact-picker';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/toast';
import type { ShellBusiness, ShellData } from './types';

const KINDS: { kind: QuickKind; label: string; icon: React.ComponentType<{ className?: string }>; module?: string }[] = [
  { kind: 'task', label: 'Task', icon: CheckSquare },
  { kind: 'lead', label: 'Lead', icon: Sparkles, module: 'leads' },
  { kind: 'contact', label: 'Contact', icon: UserPlus },
  { kind: 'appointment', label: 'Appointment', icon: CalendarPlus, module: 'calendar' },
  { kind: 'quote', label: 'Quote', icon: FileText, module: 'quotes' },
  { kind: 'invoice', label: 'Invoice', icon: FilePlus, module: 'invoices' },
  { kind: 'payment', label: 'Payment', icon: CreditCard, module: 'payments' },
  { kind: 'deal', label: 'Deal', icon: Briefcase, module: 'sales' },
  { kind: 'job', label: 'Job', icon: Hammer, module: 'jobs' },
  { kind: 'note', label: 'Note', icon: StickyNote },
];

export type PresetContact = { id: string; label: string; subAccountId: string };

export function openQuickAdd(kind?: QuickKind, contact?: PresetContact) {
  window.dispatchEvent(new CustomEvent('bos:quick-add', { detail: { kind, contact } }));
}

function todayLocal(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Persistent "+" — add anything in two taps, with as few fields as possible. */
export function QuickAdd({ businesses, currentId, allowed }: { businesses: ShellBusiness[]; currentId: string | null; allowed: ShellData['can'] }) {
  const [menu, setMenu] = useState(false);
  const [kind, setKind] = useState<QuickKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contactBiz, setContactBiz] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetContact | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scope = currentId ? businesses.filter((b) => b.id === currentId) : businesses;
  const PERM_KEY: Record<QuickKind, keyof ShellData['can']> = {
    task: 'tasks', lead: 'leads', contact: 'contacts', appointment: 'appointments', quote: 'quotes', invoice: 'invoices',
    payment: 'payments', deal: 'deals', job: 'jobs', note: 'notes',
  };
  const available = KINDS.filter((k) => allowed[PERM_KEY[k.kind]] && (!k.module || scope.some((b) => b.enabledModules.includes(k.module!))));

  useEffect(() => {
    const onOpen = (e: Event) => {
      const k = (e as CustomEvent).detail?.kind as QuickKind | undefined;
      const c = (e as CustomEvent).detail?.contact as PresetContact | undefined;
      setPreset(c ?? null);
      setContactBiz(c?.subAccountId ?? null);
      if (k) { setKind(k); setMenu(false); } else setMenu(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'n' && (e.altKey || e.metaKey && e.shiftKey) ) { e.preventDefault(); setMenu(true); }
    };
    window.addEventListener('bos:quick-add', onOpen);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('bos:quick-add', onOpen); window.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (kind && !d.open) d.showModal();
    if (!kind && d.open) d.close();
  }, [kind]);

  const submit = (fd: FormData) => {
    if (!kind) return;
    setError(null);
    start(async () => {
      const res = await quickAddAction(kind, fd);
      if (!res.ok) { setError(res.error); return; }
      toast(res.message ?? 'Added');
      setKind(null);
      setContactBiz(null);
      if (res.data?.href) router.push(res.data.href);
      router.refresh();
    });
  };

  const needsBusinessPicker = !currentId && !contactBiz;
  const withContact = ['deal', 'appointment', 'quote', 'invoice', 'note', 'job', 'task'].includes(kind ?? '');

  return (
    <>
      <button onClick={() => setMenu((m) => !m)} aria-label="Quick add"
        className="fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-xl transition-transform hover:scale-105 md:bottom-6 md:right-6">
        <Plus className="size-7" />
      </button>
      {menu ? (
        <div className="fixed inset-0 z-40" onClick={() => setMenu(false)}>
          <div className="absolute bottom-36 right-4 grid w-[min(22rem,calc(100vw-2rem))] grid-cols-2 gap-2 rounded-3xl border border-border bg-surface p-3 shadow-2xl md:bottom-24 md:right-6" onClick={(e) => e.stopPropagation()}>
            <p className="col-span-2 px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">Add</p>
            {available.map(({ kind: k, label, icon: I }) => (
              <button key={k} onClick={() => { setKind(k); setMenu(false); setError(null); setPreset(null); setContactBiz(null); }}
                className="flex h-14 items-center gap-3 rounded-2xl bg-surface-2 px-3 text-left text-sm font-medium hover:bg-accent-soft">
                <I className="size-5 text-accent" />{label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <dialog ref={dialogRef} onClose={() => { setKind(null); setContactBiz(null); setPreset(null); }}
        className="m-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-3xl border border-border bg-surface p-0 text-text shadow-2xl">
        {kind ? (
          <form action={submit} className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">New {KINDS.find((k) => k.kind === kind)?.label.toLowerCase()}</h2>
              <button type="button" onClick={() => setKind(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Close"><X className="size-5" /></button>
            </div>
            <FormError error={error} />
            {withContact ? (
              <Field label={kind === 'note' ? 'About' : 'Customer'}>
                <ContactPicker key={preset?.id ?? 'none'} initial={preset} required={['quote', 'invoice', 'note'].includes(kind)} onPick={(h) => setContactBiz(h?.subAccountId ?? null)} />
              </Field>
            ) : null}
            <KindFields kind={kind} />
            {needsBusinessPicker ? (
              <Field label="Business">
                <Select name="subAccountId" required defaultValue="">
                  <option value="" disabled>Choose a business…</option>
                  {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setKind(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={pending}>{pending ? 'Saving…' : ['quote', 'invoice'].includes(kind) ? 'Create draft' : 'Save'}</Button>
            </div>
          </form>
        ) : null}
      </dialog>
    </>
  );
}

function KindFields({ kind }: { kind: QuickKind }) {
  switch (kind) {
    case 'contact':
      return (<>
        <Field label="Name"><Input name="name" required autoFocus placeholder="Sarah Mitchell" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile"><Input name="phone" type="tel" placeholder="0412 345 678" /></Field>
          <Field label="Email"><Input name="email" type="email" /></Field>
        </div>
        <Field label="Company (optional)"><Input name="company" /></Field>
      </>);
    case 'lead':
      return (<>
        <Field label="Name"><Input name="name" required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile"><Input name="phone" type="tel" /></Field>
          <Field label="Email"><Input name="email" type="email" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source"><Select name="source" defaultValue="phone">{['phone', 'website', 'facebook', 'instagram', 'google', 'referral', 'sms', 'manual', 'other'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</Select></Field>
          <Field label="Value (optional)"><Input name="amount" inputMode="decimal" placeholder="$" /></Field>
        </div>
        <Field label="What do they want?"><Textarea name="notes" rows={2} /></Field>
      </>);
    case 'deal':
      return (<>
        <Field label="Deal name"><Input name="title" placeholder="Kitchen facelift" /></Field>
        <Field label="Value"><Input name="amount" inputMode="decimal" placeholder="$" /></Field>
      </>);
    case 'task':
      return (<>
        <Field label="What needs doing?"><Input name="title" required autoFocus placeholder="Call Steve about the order" /></Field>
        <DateChips />
        <Field label="Priority"><Select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
      </>);
    case 'appointment':
      return (<>
        <Field label="Title (optional)"><Input name="title" placeholder="Measure & quote" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><Input name="date" type="date" required defaultValue={todayLocal(1)} /></Field>
          <Field label="Time"><Input name="time" type="time" required defaultValue="10:00" /></Field>
          <Field label="Length"><Select name="duration" defaultValue="60"><option value="15">15m</option><option value="30">30m</option><option value="60">1h</option><option value="90">1.5h</option><option value="120">2h</option><option value="240">4h</option></Select></Field>
        </div>
        <Field label="Location (optional)"><Input name="location" /></Field>
      </>);
    case 'quote':
    case 'invoice':
      return (<>
        <Field label="What for?"><Input name="description" placeholder={kind === 'quote' ? 'Kitchen facelift' : 'Doors supplied and installed'} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount"><Input name="amount" required inputMode="decimal" placeholder="$2,500" /></Field>
          <Field label="GST"><Select name="gst" defaultValue="plus"><option value="plus">Plus GST</option><option value="inc">Includes GST</option><option value="none">GST free</option></Select></Field>
        </div>
        <p className="text-xs text-muted">Creates a draft. You can add line items and send it from the next screen.</p>
      </>);
    case 'payment':
      return (<>
        <Field label="Invoice number"><Input name="invoiceNumber" required placeholder="INV-1001" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" hint="Blank = full balance"><Input name="amount" inputMode="decimal" placeholder="$" /></Field>
          <Field label="Method"><Select name="method" defaultValue="bank_transfer"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></Select></Field>
        </div>
        <Field label="Reference (optional)"><Input name="reference" /></Field>
      </>);
    case 'note':
      return <Field label="Note"><Textarea name="body" required rows={4} autoFocus /></Field>;
    case 'job':
      return (<>
        <Field label="Job"><Input name="title" required placeholder="Kitchen facelift — Morwell" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date (optional)"><Input name="date" type="date" /></Field>
          <Field label="Value (optional)"><Input name="amount" inputMode="decimal" placeholder="$" /></Field>
        </div>
      </>);
  }
}

function DateChips() {
  const [date, setDate] = useState(todayLocal());
  const chips = [{ label: 'Today', v: todayLocal() }, { label: 'Tomorrow', v: todayLocal(1) }, { label: 'Next week', v: todayLocal(7) }, { label: 'No date', v: '' }];
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">When</span>
      <div className="mb-2 flex flex-wrap gap-2">
        {chips.map((c) => (
          <button key={c.label} type="button" onClick={() => setDate(c.v)}
            className={`h-9 rounded-full border px-3 text-sm ${date === c.v ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-border'}`}>{c.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input name="time" type="time" aria-label="Time (optional)" />
      </div>
    </div>
  );
}
