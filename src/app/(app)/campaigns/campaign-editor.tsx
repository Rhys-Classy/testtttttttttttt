'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Send, Users, X } from 'lucide-react';
import type { Segment, SegmentRule } from '@/db/schema';
import { saveCampaignAction, segmentPreviewAction } from '@/server/actions/marketing';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';

type Opts = { tags: string[]; pipelines: { id: string; name: string }[]; stages: { id: string; name: string }[]; customFields: { key: string; label: string }[] };

export function CampaignEditor({ initial, businesses, optsBy, locked }: {
  initial: { id?: string; subAccountId?: string; name: string; channel: 'email' | 'sms'; subject: string; body: string; segment: Segment };
  businesses: { id: string; name: string }[];
  optsBy: Record<string, Opts>;
  locked?: boolean;
}) {
  const [subAccountId, setSubAccountId] = useState(initial.subAccountId ?? (businesses.length === 1 ? businesses[0].id : ''));
  const [name, setName] = useState(initial.name);
  const [channel, setChannel] = useState(initial.channel);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [segment, setSegment] = useState<Segment>(initial.segment);
  const [sendAt, setSendAt] = useState('');
  const [count, setCount] = useState<{ total: number; reachable: number } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const o = optsBy[subAccountId] ?? { tags: [], pipelines: [], stages: [], customFields: [] };

  useEffect(() => {
    if (!subAccountId) return;
    const t = setTimeout(() => segmentPreviewAction(subAccountId, segment, channel).then((r) => r.ok && r.data && setCount(r.data)), 250);
    return () => clearTimeout(t);
  }, [subAccountId, segment, channel]);

  const setRule = (i: number, r: SegmentRule) => setSegment({ ...segment, rules: segment.rules.map((x, j) => (j === i ? r : x)) });
  const save = (intent: 'save' | 'schedule' | 'send') => start(async () => {
    if (!subAccountId) { toast('Pick a business', 'error'); return; }
    if (intent === 'send' && !confirm(`Send to ${count?.reachable ?? 0} people now?`)) return;
    const r = await saveCampaignAction({ id: initial.id, subAccountId, name, channel, subject, body, segment, sendAt: sendAt ? new Date(sendAt).toISOString() : null, intent });
    if (!r.ok) { toast(r.error, 'error'); return; }
    toast(r.message ?? 'Saved');
    router.push(r.data ? `/campaigns/${r.data.id}` : '/campaigns');
    router.refresh();
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label="Campaign name"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} /></Field>
          <Field label="Channel"><Select value={channel} onChange={(e) => setChannel(e.target.value as 'email' | 'sms')} disabled={locked}><option value="email">Email</option><option value="sms">SMS</option></Select></Field>
        </div>
        {!initial.subAccountId && businesses.length > 1 ? <Field label="Business"><Select value={subAccountId} onChange={(e) => setSubAccountId(e.target.value)}><option value="">Choose…</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field> : null}
        {channel === 'email' ? <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={locked} /></Field> : null}
        <Field label="Message" hint={channel === 'sms' ? `${body.length} characters · "Reply STOP to opt out" is added automatically` : 'An unsubscribe line is added automatically. Use {{contact.first_name}} to personalise.'}>
          <Textarea rows={channel === 'sms' ? 4 : 10} value={body} onChange={(e) => setBody(e.target.value)} disabled={locked} />
        </Field>
      </div>
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="mb-2 font-semibold">Who gets it</p>
          <Select value={segment.match} onChange={(e) => setSegment({ ...segment, match: e.target.value as 'all' | 'any' })} disabled={locked}><option value="all">Match all rules</option><option value="any">Match any rule</option></Select>
          <div className="mt-2 space-y-2">
            {segment.rules.map((r, i) => (
              <div key={i} className="flex gap-1.5">
                <div className="grid flex-1 gap-1.5">
                  <Select value={r.field} disabled={locked} onChange={(e) => {
                    const f = e.target.value as SegmentRule['field'];
                    setRule(i, f === 'tag' ? { field: 'tag', op: 'has', value: o.tags[0] ?? '' } : f === 'source' ? { field: 'source', op: 'eq', value: 'website' } : f === 'status' ? { field: 'status', op: 'eq', value: 'customer' }
                      : f === 'pipeline' ? { field: 'pipeline', op: 'in', value: o.pipelines[0]?.id ?? '' } : f === 'pipeline_stage' ? { field: 'pipeline_stage', op: 'in', value: o.stages[0]?.id ?? '' }
                      : f === 'has_paid_invoice' ? { field: 'has_paid_invoice', op: 'eq', value: true } : f === 'has_overdue_invoice' ? { field: 'has_overdue_invoice', op: 'eq', value: true }
                      : { field: 'custom', key: o.customFields[0]?.key ?? '', op: 'eq', value: '' });
                  }}>
                    <option value="tag">Tag</option><option value="source">Lead source</option><option value="status">Status</option><option value="pipeline">In pipeline</option><option value="pipeline_stage">At stage</option>
                    <option value="has_paid_invoice">Has paid an invoice</option><option value="has_overdue_invoice">Has an overdue invoice</option><option value="custom">Custom field</option>
                  </Select>
                  {r.field === 'tag' ? <div className="flex gap-1.5"><Select value={r.op} disabled={locked} onChange={(e) => setRule(i, { ...r, op: e.target.value as 'has' })}><option value="has">has</option><option value="not_has">doesn&apos;t have</option></Select><Input list="seg-tags" value={r.value} disabled={locked} onChange={(e) => setRule(i, { ...r, value: e.target.value })} /></div> : null}
                  {r.field === 'source' ? <div className="flex gap-1.5"><Select value={r.op} disabled={locked} onChange={(e) => setRule(i, { ...r, op: e.target.value as 'eq' })}><option value="eq">is</option><option value="neq">is not</option></Select><Select value={r.value} disabled={locked} onChange={(e) => setRule(i, { ...r, value: e.target.value })}>{['website', 'facebook', 'instagram', 'google', 'referral', 'phone', 'sms', 'manual', 'other'].map((x) => <option key={x}>{x}</option>)}</Select></div> : null}
                  {r.field === 'status' ? <Select value={r.value} disabled={locked} onChange={(e) => setRule(i, { ...r, value: e.target.value })}><option value="lead">Lead</option><option value="customer">Customer</option><option value="inactive">Inactive</option></Select> : null}
                  {r.field === 'pipeline' ? <Select value={r.value} disabled={locked} onChange={(e) => setRule(i, { ...r, value: e.target.value })}>{o.pipelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select> : null}
                  {r.field === 'pipeline_stage' ? <Select value={r.value} disabled={locked} onChange={(e) => setRule(i, { ...r, value: e.target.value })}>{o.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select> : null}
                  {r.field === 'has_paid_invoice' || r.field === 'has_overdue_invoice' ? <Select value={String(r.value)} disabled={locked} onChange={(e) => setRule(i, { ...r, value: e.target.value === 'true' })}><option value="true">Yes</option><option value="false">No</option></Select> : null}
                  {r.field === 'custom' ? <div className="grid grid-cols-2 gap-1.5"><Select value={r.key} disabled={locked} onChange={(e) => setRule(i, { ...r, key: e.target.value })}>{o.customFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Select><Input value={r.value} disabled={locked} onChange={(e) => setRule(i, { ...r, value: e.target.value })} /></div> : null}
                </div>
                {!locked ? <button onClick={() => setSegment({ ...segment, rules: segment.rules.filter((_, j) => j !== i) })} className="text-muted"><X className="size-4" /></button> : null}
              </div>
            ))}
            <datalist id="seg-tags">{o.tags.map((t) => <option key={t} value={t} />)}</datalist>
            {!locked ? <Button size="sm" variant="ghost" onClick={() => setSegment({ ...segment, rules: [...segment.rules, { field: 'tag', op: 'has', value: o.tags[0] ?? '' }] })}><Plus className="size-4" />Add rule</Button> : null}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent"><Users className="size-4" />{count ? <><b>{count.reachable}</b> will receive it{count.total !== count.reachable ? <span className="opacity-70"> ({count.total - count.reachable} can&apos;t: no {channel === 'sms' ? 'mobile' : 'email'} or opted out)</span> : null}</> : 'Counting…'}</div>
        </div>
        {!locked ? (
          <div className="space-y-2 rounded-2xl border border-border bg-surface p-4">
            <Button variant="secondary" className="w-full" disabled={pending} onClick={() => save('save')}>Save draft</Button>
            <div className="flex gap-2"><Input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} /><Button variant="secondary" disabled={pending || !sendAt} onClick={() => save('schedule')}>Schedule</Button></div>
            <Button variant="primary" className="w-full" disabled={pending || !count?.reachable} onClick={() => save('send')}><Send className="size-4" />Send now</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
