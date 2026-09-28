'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import type { LandingSection } from '@/db/schema';
import { savePageAction } from '@/server/actions/marketing';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';

const ADD: { type: LandingSection['type']; label: string }[] = [
  { type: 'hero', label: 'Hero' }, { type: 'heading', label: 'Heading' }, { type: 'text', label: 'Text' }, { type: 'image', label: 'Image' },
  { type: 'button', label: 'Button' }, { type: 'form', label: 'Form' }, { type: 'testimonials', label: 'Testimonials' },
];
const nid = () => Math.random().toString(36).slice(2, 9);

function blank(type: LandingSection['type'], formId?: string): LandingSection {
  switch (type) {
    case 'hero': return { id: nid(), type, heading: 'Your headline', subheading: 'One sentence on why people should care.', buttonLabel: 'Get a free quote', buttonHref: '#form' };
    case 'heading': return { id: nid(), type, text: 'Section heading' };
    case 'text': return { id: nid(), type, body: 'Write something useful here.' };
    case 'image': return { id: nid(), type, url: '', alt: '' };
    case 'button': return { id: nid(), type, label: 'Call us', href: 'tel:' };
    case 'form': return { id: nid(), type, formId: formId ?? '' };
    case 'testimonials': return { id: nid(), type, items: [{ quote: 'Fantastic job, would recommend.', name: 'Happy customer' }] };
  }
}

export function PageBuilder({ initial, businesses, formsBy, appUrl }: {
  initial: { id?: string; subAccountId?: string; name: string; title: string; sections: LandingSection[]; style: Record<string, string>; published: boolean; publicId?: string };
  businesses: { id: string; name: string }[];
  formsBy: Record<string, { id: string; name: string; publicId: string }[]>;
  appUrl: string;
}) {
  const [subAccountId, setSubAccountId] = useState(initial.subAccountId ?? (businesses.length === 1 ? businesses[0].id : ''));
  const [name, setName] = useState(initial.name);
  const [title, setTitle] = useState(initial.title);
  const [sections, setSections] = useState(initial.sections);
  const [style, setStyle] = useState(initial.style);
  const [published, setPublished] = useState(initial.published);
  const [pending, start] = useTransition();
  const router = useRouter();
  const formsList = formsBy[subAccountId] ?? [];
  const url = initial.publicId ? `${appUrl}/p/${initial.publicId}` : null;
  const set = (i: number, patch: Partial<LandingSection>) => setSections((s) => s.map((x, j) => (j === i ? ({ ...x, ...patch } as LandingSection) : x)));
  const move = (i: number, d: -1 | 1) => setSections((s) => { const c = [...s]; const j = i + d; if (j < 0 || j >= c.length) return s; [c[i], c[j]] = [c[j], c[i]]; return c; });

  const save = () => start(async () => {
    if (!subAccountId) { toast('Pick a business', 'error'); return; }
    const r = await savePageAction({ id: initial.id, subAccountId, name, title, sections, style, published });
    if (!r.ok) { toast(r.error, 'error'); return; }
    toast('Page saved');
    if (!initial.id && r.data) router.replace(`/pages/${r.data.id}`);
    router.refresh();
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Page name (internal)" className="min-w-48 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Browser title" className="min-w-48 flex-1"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {!initial.subAccountId && businesses.length > 1 ? <Field label="Business"><Select value={subAccountId} onChange={(e) => setSubAccountId(e.target.value)}><option value="">Choose…</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field> : null}
        <Field label="Accent"><Input type="color" value={style.accent ?? '#4f46e5'} onChange={(e) => setStyle({ ...style, accent: e.target.value })} className="w-16 p-1" /></Field>
        <label className="flex h-11 items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />Published</label>
        <Button variant="primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save page'}</Button>
      </div>
      {url ? <div className="flex items-center gap-2 rounded-2xl bg-accent-soft p-3 text-sm"><span className="font-medium text-accent">Live at</span><a href={url} target="_blank" rel="noreferrer" className="truncate text-accent underline">{url}</a><button onClick={() => { navigator.clipboard.writeText(url); toast('Copied'); }} className="ml-auto text-accent"><Copy className="size-4" /></button></div> : null}
      <div className="space-y-3">
        {sections.map((s, i) => (
          <div key={s.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-muted">{s.type}</p>
              <div className="flex gap-1"><button onClick={() => move(i, -1)} className="p-1.5 text-muted"><ArrowUp className="size-4" /></button><button onClick={() => move(i, 1)} className="p-1.5 text-muted"><ArrowDown className="size-4" /></button><button onClick={() => setSections((x) => x.filter((_, j) => j !== i))} className="p-1.5 text-muted hover:text-danger"><Trash2 className="size-4" /></button></div>
            </div>
            {s.type === 'hero' ? (<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input value={s.heading} onChange={(e) => set(i, { heading: e.target.value })} placeholder="Heading" className="sm:col-span-2" />
              <Textarea value={s.subheading ?? ''} onChange={(e) => set(i, { subheading: e.target.value })} rows={2} className="sm:col-span-2" />
              <Input value={s.buttonLabel ?? ''} onChange={(e) => set(i, { buttonLabel: e.target.value })} placeholder="Button label" />
              <Input value={s.buttonHref ?? ''} onChange={(e) => set(i, { buttonHref: e.target.value })} placeholder="#form or https://" />
              <Input value={s.imageUrl ?? ''} onChange={(e) => set(i, { imageUrl: e.target.value })} placeholder="Background image URL (optional)" className="sm:col-span-2" />
            </div>) : null}
            {s.type === 'heading' ? <Input value={s.text} onChange={(e) => set(i, { text: e.target.value })} /> : null}
            {s.type === 'text' ? <Textarea value={s.body} onChange={(e) => set(i, { body: e.target.value })} rows={4} /> : null}
            {s.type === 'image' ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Input value={s.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="Image URL" /><Input value={s.alt ?? ''} onChange={(e) => set(i, { alt: e.target.value })} placeholder="Description" /></div> : null}
            {s.type === 'button' ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Input value={s.label} onChange={(e) => set(i, { label: e.target.value })} /><Input value={s.href} onChange={(e) => set(i, { href: e.target.value })} /></div> : null}
            {s.type === 'form' ? <Select value={s.formId} onChange={(e) => set(i, { formId: e.target.value })}><option value="">Choose a form…</option>{formsList.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select> : null}
            {s.type === 'testimonials' ? (
              <div className="space-y-2">
                {s.items.map((t, k) => <div key={k} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem_2rem]"><Input value={t.quote} onChange={(e) => set(i, { items: s.items.map((x, m) => (m === k ? { ...x, quote: e.target.value } : x)) })} /><Input value={t.name} onChange={(e) => set(i, { items: s.items.map((x, m) => (m === k ? { ...x, name: e.target.value } : x)) })} /><button onClick={() => set(i, { items: s.items.filter((_, m) => m !== k) })} className="text-muted"><Trash2 className="size-4" /></button></div>)}
                <Button size="sm" variant="ghost" onClick={() => set(i, { items: [...s.items, { quote: '', name: '' }] })}><Plus className="size-4" />Testimonial</Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 rounded-2xl border border-dashed border-border p-3">
        <span className="self-center text-sm text-muted">Add section:</span>
        {ADD.map((a) => <Button key={a.type} size="sm" variant="secondary" onClick={() => setSections((s) => [...s, blank(a.type, formsList[0]?.id)])}><Plus className="size-4" />{a.label}</Button>)}
      </div>
    </div>
  );
}
