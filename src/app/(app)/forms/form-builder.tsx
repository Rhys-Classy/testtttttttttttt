'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { FormField, FormFieldType, FormSettings } from '@/db/schema';
import { saveFormAction } from '@/server/actions/marketing';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/cn';

const TYPES: { type: FormFieldType; label: string }[] = [
  { type: 'name', label: 'Full name' }, { type: 'first_name', label: 'First name' }, { type: 'last_name', label: 'Last name' },
  { type: 'email', label: 'Email' }, { type: 'phone', label: 'Phone' }, { type: 'address', label: 'Address' },
  { type: 'text', label: 'Short text' }, { type: 'textarea', label: 'Long text' }, { type: 'number', label: 'Number' }, { type: 'date', label: 'Date' },
  { type: 'dropdown', label: 'Dropdown' }, { type: 'radio', label: 'Choice (one)' }, { type: 'checkbox', label: 'Checkboxes' }, { type: 'file', label: 'File upload' },
];

const newId = () => Math.random().toString(36).slice(2, 9);

export function FormBuilder({ initial, businesses, pipelines, customFields, appUrl }: {
  initial: { id?: string; subAccountId?: string; name: string; fields: FormField[]; settings: FormSettings; status: 'draft' | 'published'; publicId?: string };
  businesses: { id: string; name: string }[];
  pipelines: Record<string, { id: string; name: string; stages: { id: string; name: string }[] }[]>;
  customFields: Record<string, { key: string; label: string }[]>;
  appUrl: string;
}) {
  const [subAccountId, setSubAccountId] = useState(initial.subAccountId ?? (businesses.length === 1 ? businesses[0].id : ''));
  const [name, setName] = useState(initial.name);
  const [fields, setFields] = useState<FormField[]>(initial.fields);
  const [settings, setSettings] = useState<FormSettings>(initial.settings);
  const [status, setStatus] = useState(initial.status);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const url = initial.publicId ? `${appUrl}/f/${initial.publicId}` : null;

  const update = (id: string, patch: Partial<FormField>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const add = (type: FormFieldType) => {
    const label = TYPES.find((t) => t.type === type)!.label;
    const f: FormField = { id: `${type}_${newId()}`, type, label, required: ['name', 'email'].includes(type), options: ['dropdown', 'radio', 'checkbox'].includes(type) ? ['Option 1', 'Option 2'] : undefined };
    setFields((fs) => [...fs, f]);
    setSelected(f.id);
  };
  const reorder = (from: number, to: number) => setFields((fs) => { const c = [...fs]; const [x] = c.splice(from, 1); c.splice(to, 0, x); return c; });

  const save = () => start(async () => {
    if (!subAccountId) { toast('Pick a business', 'error'); return; }
    const r = await saveFormAction({ id: initial.id, subAccountId, name, fields, settings, status });
    if (!r.ok) { toast(r.error, 'error'); return; }
    toast('Form saved');
    if (!initial.id && r.data) router.replace(`/forms/${r.data.id}`);
    router.refresh();
  });

  const pls = pipelines[subAccountId] ?? [];
  const cfs = customFields[subAccountId] ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Form name" className="min-w-56 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {!initial.subAccountId && businesses.length > 1 ? <Field label="Business"><Select value={subAccountId} onChange={(e) => setSubAccountId(e.target.value)}><option value="">Choose…</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field> : null}
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'published')} className="w-36"><option value="published">Published</option><option value="draft">Draft</option></Select>
          <Button variant="primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save form'}</Button>
        </div>
        {url ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-accent-soft p-3 text-sm">
            <span className="font-medium text-accent">Public link:</span><a href={url} target="_blank" rel="noreferrer" className="truncate text-accent underline">{url}</a>
            <button onClick={() => { navigator.clipboard.writeText(url); toast('Link copied'); }} className="ml-auto flex items-center gap-1 text-accent"><Copy className="size-4" />Copy</button>
            <button onClick={() => { navigator.clipboard.writeText(`<iframe src="${url}?embed=1" style="width:100%;min-height:640px;border:0" title="${name}"></iframe>`); toast('Embed code copied'); }} className="flex items-center gap-1 text-accent"><Copy className="size-4" />Embed code</button>
          </div>
        ) : null}
        <div className="rounded-3xl border border-border bg-surface p-4">
          {fields.map((f, i) => (
            <div key={f.id} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null && drag !== i) reorder(drag, i); setDrag(null); }}
              onClick={() => setSelected(f.id)}
              className={cn('mb-2 flex cursor-pointer items-start gap-2 rounded-2xl border p-3', selected === f.id ? 'border-accent bg-accent-soft/40' : 'border-transparent hover:border-border')}>
              <GripVertical className="mt-2.5 size-4 shrink-0 cursor-grab text-muted" />
              <div className="flex-1">
                <p className="mb-1.5 text-sm font-medium">{f.label}{f.required ? <span className="text-danger"> *</span> : null}</p>
                <Preview f={f} />
              </div>
              <button onClick={(e) => { e.stopPropagation(); setFields((fs) => fs.filter((x) => x.id !== f.id)); }} className="rounded-lg p-1.5 text-muted hover:text-danger" aria-label="Remove field"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Add field</p>
            <div className="flex flex-wrap gap-1.5">{TYPES.map((t) => <button key={t.type} onClick={() => add(t.type)} className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-xs hover:border-accent hover:text-accent"><Plus className="size-3" />{t.label}</button>)}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {selected ? (() => {
          const f = fields.find((x) => x.id === selected);
          if (!f) return null;
          return (
            <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
              <p className="font-semibold">Field settings</p>
              <Field label="Label"><Input value={f.label} onChange={(e) => update(f.id, { label: e.target.value })} /></Field>
              <Field label="Placeholder"><Input value={f.placeholder ?? ''} onChange={(e) => update(f.id, { placeholder: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.required} onChange={(e) => update(f.id, { required: e.target.checked })} />Required</label>
              {f.options ? <Field label="Options (one per line)"><Textarea rows={4} value={f.options.join('\n')} onChange={(e) => update(f.id, { options: e.target.value.split('\n') })} /></Field> : null}
              {!['name', 'first_name', 'last_name', 'email', 'phone'].includes(f.type) && cfs.length ? (
                <Field label="Save answer to contact field"><Select value={f.customFieldKey ?? ''} onChange={(e) => update(f.id, { customFieldKey: e.target.value || undefined })}><option value="">— don&apos;t save —</option>{cfs.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</Select></Field>
              ) : null}
            </div>
          );
        })() : null}
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
          <p className="font-semibold">When someone submits</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.createLead !== false} onChange={(e) => setSettings({ ...settings, createLead: e.target.checked })} />Create a lead</label>
          <Field label="Lead source"><Select value={settings.leadSource ?? 'website'} onChange={(e) => setSettings({ ...settings, leadSource: e.target.value })}>{['website', 'facebook', 'instagram', 'google', 'referral', 'other'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="Add tags (comma separated)"><Input value={(settings.addTags ?? []).join(', ')} onChange={(e) => setSettings({ ...settings, addTags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
          <Field label="Also create a deal in">
            <Select value={settings.createDeal ? `${settings.createDeal.pipelineId}|${settings.createDeal.stageId}` : ''} onChange={(e) => { const [pipelineId, stageId] = e.target.value.split('|'); setSettings({ ...settings, createDeal: e.target.value ? { pipelineId, stageId } : null }); }}>
              <option value="">— no deal —</option>
              {pls.map((p) => <optgroup key={p.id} label={p.name}>{p.stages.map((s) => <option key={s.id} value={`${p.id}|${s.id}`}>{s.name}</option>)}</optgroup>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.notify !== false} onChange={(e) => setSettings({ ...settings, notify: e.target.checked })} />Notify me</label>
          <Field label="Thank-you message"><Textarea rows={2} value={settings.thankYouMessage ?? ''} onChange={(e) => setSettings({ ...settings, thankYouMessage: e.target.value })} /></Field>
          <Field label="Or redirect to URL"><Input value={settings.redirectUrl ?? ''} onChange={(e) => setSettings({ ...settings, redirectUrl: e.target.value })} placeholder="https://" /></Field>
          <Field label="Button label"><Input value={settings.submitLabel ?? ''} onChange={(e) => setSettings({ ...settings, submitLabel: e.target.value })} placeholder="Send" /></Field>
          <p className="text-xs text-muted">Automations can also run on “Form submitted”.</p>
        </div>
      </div>
    </div>
  );
}

function Preview({ f }: { f: FormField }) {
  const cls = 'pointer-events-none h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm';
  if (f.type === 'textarea' || f.type === 'address') return <div className={cn(cls, 'h-16')} />;
  if (f.type === 'dropdown') return <select className={cls} disabled><option>{f.options?.[0]}</option></select>;
  if (f.type === 'radio' || f.type === 'checkbox') return <div className="flex flex-wrap gap-3 text-sm text-muted">{f.options?.map((o) => <span key={o}>{f.type === 'radio' ? '○' : '☐'} {o}</span>)}</div>;
  if (f.type === 'file') return <div className={cn(cls, 'flex items-center text-muted')}>Choose file…</div>;
  return <div className={cn(cls, 'flex items-center text-muted')}>{f.placeholder}</div>;
}
