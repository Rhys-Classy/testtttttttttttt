'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, StickyNote, X } from 'lucide-react';
import { addNoteAction, logCallAction, tagAction, updateContactAction } from '@/server/actions/crm';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/cn';

export function NoteBox({ subAccountId, contactId }: { subAccountId: string; contactId: string }) {
  const [mode, setMode] = useState<'note' | 'call'>('note');
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () => start(async () => {
    const res = mode === 'note' ? await addNoteAction(subAccountId, contactId, text) : await logCallAction(subAccountId, contactId, text);
    if (!res.ok) { toast(res.error, 'error'); return; }
    setText('');
    toast(res.message ?? 'Saved');
    router.refresh();
  });
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="mb-2 flex gap-1">
        {(['note', 'call'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={cn('flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium', mode === m ? 'bg-accent-soft text-accent' : 'text-muted')}>
            {m === 'note' ? <StickyNote className="size-3.5" /> : <Phone className="size-3.5" />}{m === 'note' ? 'Note' : 'Log a call'}
          </button>
        ))}
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder={mode === 'note' ? 'Add a note…' : 'What was discussed?'} className="min-h-16" />
      <div className="mt-2 flex justify-end"><Button variant="primary" size="sm" disabled={!text.trim() || pending} onClick={save}>{pending ? 'Saving…' : 'Save'}</Button></div>
    </div>
  );
}

export function TagEditor({ subAccountId, contactId, tags }: { subAccountId: string; contactId: string; tags: string[] }) {
  const [value, setValue] = useState('');
  const [, start] = useTransition();
  const router = useRouter();
  const run = (tag: string, remove: boolean) => start(async () => {
    const res = await tagAction(subAccountId, contactId, tag, remove);
    if (!res.ok) toast(res.error, 'error');
    router.refresh();
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs">
          #{t}<button onClick={() => run(t, true)} aria-label={`Remove ${t}`} className="text-muted hover:text-danger"><X className="size-3" /></button>
        </span>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) { run(value.trim(), false); setValue(''); } }}>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="+ tag" className="h-7 w-20 rounded-full border border-dashed border-border bg-transparent px-2.5 text-xs placeholder:text-muted focus:w-32 focus:outline-none" />
      </form>
    </div>
  );
}

type Def = { key: string; label: string; fieldType: string; options: string[] };

export function ContactForm({ contact, defs, subAccountId, companyName }: {
  contact: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null; website: string | null; jobTitle: string | null; status: string; source: string | null; address: Record<string, string | undefined>; customFields: Record<string, unknown> };
  defs: Def[];
  subAccountId: string;
  companyName: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (fd: FormData) => start(async () => {
    const res = await updateContactAction(fd);
    if (!res.ok) { toast(res.error, 'error'); return; }
    toast('Saved');
    setEditing(false);
    router.refresh();
  });
  if (!editing) {
    const rows: [string, React.ReactNode][] = [
      ['Email', contact.email], ['Mobile', contact.phone], ['Company', companyName ? `${contact.jobTitle ? `${contact.jobTitle}, ` : ''}${companyName}` : null],
      ['Address', [contact.address.line1, contact.address.suburb, contact.address.state, contact.address.postcode].filter(Boolean).join(', ') || null],
      ['Source', contact.source], ['Website', contact.website],
      ...defs.map((d) => [d.label, formatCustom(contact.customFields[d.key])] as [string, React.ReactNode]),
    ];
    return (
      <div>
        <dl className="space-y-2.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-3"><dt className="w-28 shrink-0 text-muted">{k}</dt><dd className={cn('min-w-0 flex-1 break-words', !v && 'text-muted')}>{v || '—'}</dd></div>
          ))}
        </dl>
        <Button variant="secondary" size="sm" className="mt-4 w-full" onClick={() => setEditing(true)}>Edit details</Button>
      </div>
    );
  }
  return (
    <form action={submit} className="space-y-3">
      <input type="hidden" name="id" value={contact.id} />
      <input type="hidden" name="subAccountId" value={subAccountId} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="First name"><Input name="firstName" defaultValue={contact.firstName} /></Field>
        <Field label="Last name"><Input name="lastName" defaultValue={contact.lastName} /></Field>
      </div>
      <Field label="Email"><Input name="email" type="email" defaultValue={contact.email ?? ''} /></Field>
      <Field label="Mobile"><Input name="phone" defaultValue={contact.phone ?? ''} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Company"><Input name="company" defaultValue={companyName ?? ''} /></Field>
        <Field label="Role"><Input name="jobTitle" defaultValue={contact.jobTitle ?? ''} /></Field>
      </div>
      <Field label="Street"><Input name="line1" defaultValue={contact.address.line1 ?? ''} /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Suburb"><Input name="suburb" defaultValue={contact.address.suburb ?? ''} /></Field>
        <Field label="State"><Input name="state" defaultValue={contact.address.state ?? ''} /></Field>
        <Field label="Postcode"><Input name="postcode" defaultValue={contact.address.postcode ?? ''} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Status"><Select name="status" defaultValue={contact.status}><option value="lead">Lead</option><option value="customer">Customer</option><option value="inactive">Inactive</option></Select></Field>
        <Field label="Source"><Select name="source" defaultValue={contact.source ?? ''}><option value="">—</option>{['website', 'facebook', 'instagram', 'google', 'referral', 'manual', 'phone', 'sms', 'other'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
      </div>
      <Field label="Website"><Input name="website" defaultValue={contact.website ?? ''} /></Field>
      {defs.map((d) => <CustomInput key={d.key} def={d} value={contact.customFields[d.key]} />)}
      <div className="flex gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={pending} className="flex-1">{pending ? 'Saving…' : 'Save'}</Button></div>
    </form>
  );
}

function formatCustom(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export function CustomInput({ def, value }: { def: Def; value: unknown }) {
  const name = `cf_${def.key}`;
  switch (def.fieldType) {
    case 'select': return <Field label={def.label}><Select name={name} defaultValue={String(value ?? '')}><option value="">—</option>{def.options.map((o) => <option key={o}>{o}</option>)}</Select></Field>;
    case 'multiselect': return (
      <fieldset><legend className="mb-1.5 text-sm font-medium">{def.label}</legend>
        <div className="flex flex-wrap gap-2">{def.options.map((o) => <label key={o} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name={name} value={o} defaultChecked={Array.isArray(value) && value.includes(o)} />{o}</label>)}</div>
      </fieldset>
    );
    case 'checkbox': return <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={value === true} />{def.label}</label>;
    case 'textarea': return <Field label={def.label}><Textarea name={name} defaultValue={String(value ?? '')} rows={2} /></Field>;
    case 'number': return <Field label={def.label}><Input name={name} type="number" step="any" defaultValue={value === null || value === undefined ? '' : String(value)} /></Field>;
    case 'date': return <Field label={def.label}><Input name={name} type="date" defaultValue={String(value ?? '')} /></Field>;
    default: return <Field label={def.label}><Input name={name} defaultValue={String(value ?? '')} /></Field>;
  }
}
