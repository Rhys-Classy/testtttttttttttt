'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown, ArrowUp, Bell, CalendarPlus, CheckSquare, Clock, FilePlus, FileText, GitBranch, Globe, Mail, MessageSquare, MoveRight,
  Pencil, Plus, Square, Tag, Trash2, X, Zap,
} from 'lucide-react';
import { ACTIONS, CONDITION_FIELDS, TRIGGERS, describeStep, newStepId, type Condition, type Step, type StepType, type Trigger } from '@/lib/automation/types';
import { TEMPLATE_VARIABLES } from '@/lib/template';
import { saveWorkflowAction } from '@/server/actions/marketing';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/cn';

type Path = (number | 'yes' | 'no')[];
type Ctx = { forms: { id: string; name: string }[]; stages: string[]; customFields: { key: string; label: string }[] };

const ICONS: Record<StepType, React.ComponentType<{ className?: string }>> = {
  wait: Clock, send_email: Mail, send_sms: MessageSquare, create_task: CheckSquare, add_tag: Tag, remove_tag: Tag, update_field: Pencil,
  move_deal: MoveRight, create_invoice: FilePlus, create_quote: FileText, create_appointment: CalendarPlus, notify: Bell, webhook: Globe,
  http_request: Globe, condition: GitBranch, stop: Square,
};

function defaultConfig(type: StepType): Step {
  const id = newStepId();
  switch (type) {
    case 'wait': return { id, type, config: { amount: 1, unit: 'days' } };
    case 'send_email': return { id, type, config: { subject: '', body: 'Hi {{contact.first_name|there}},\n\n' } };
    case 'send_sms': return { id, type, config: { body: 'Hi {{contact.first_name|there}}, ' } };
    case 'create_task': return { id, type, config: { title: 'Follow up {{contact.name}}', dueInDays: 0, priority: 'normal' } };
    case 'add_tag': case 'remove_tag': return { id, type, config: { tag: '' } } as Step;
    case 'update_field': return { id, type, config: { field: 'status', value: 'customer' } };
    case 'move_deal': return { id, type, config: { stageName: '' } };
    case 'create_invoice': case 'create_quote': return { id, type, config: { description: '', amountCents: 0, taxCode: 'GST', send: false } } as Step;
    case 'create_appointment': return { id, type, config: { title: 'Follow-up call', inDays: 1, hour: 10, durationMinutes: 30 } };
    case 'notify': return { id, type, config: { title: '' } };
    case 'webhook': return { id, type, config: { url: 'https://' } };
    case 'http_request': return { id, type, config: { url: 'https://', method: 'POST', body: '' } };
    case 'condition': return { id, type, config: { match: 'all', conditions: [{ field: 'contact.replied', op: 'eq', value: 'no' }] }, yes: [], no: [] };
    case 'stop': return { id, type, config: {} } as Step;
  }
}

/* ---------- tree helpers (immutable) ---------- */
function listAt(steps: Step[], parent: Path): Step[] {
  let list = steps;
  for (let i = 0; i < parent.length; i += 2) {
    const s = list[parent[i] as number];
    if (s?.type !== 'condition') return [];
    list = s[parent[i + 1] as 'yes' | 'no'] ?? [];
  }
  return list;
}
function updateList(steps: Step[], parent: Path, fn: (l: Step[]) => Step[]): Step[] {
  if (!parent.length) return fn(steps);
  const [idx, branch, ...rest] = parent as [number, 'yes' | 'no', ...Path];
  return steps.map((s, i) => (i === idx && s.type === 'condition' ? { ...s, [branch]: updateList(s[branch] ?? [], rest, fn) } : s));
}

export function WorkflowBuilder({ initial, businesses, ctxByBusiness }: {
  initial: { id?: string; subAccountId?: string; name: string; description?: string; trigger: Trigger; steps: Step[]; settings: { stopOnReply?: boolean; allowReentry?: boolean }; status?: string };
  businesses: { id: string; name: string }[];
  ctxByBusiness: Record<string, Ctx>;
}) {
  const [subAccountId, setSubAccountId] = useState(initial.subAccountId ?? (businesses.length === 1 ? businesses[0].id : ''));
  const [name, setName] = useState(initial.name);
  const [trigger, setTrigger] = useState<Trigger>(initial.trigger);
  const [steps, setSteps] = useState<Step[]>(initial.steps);
  const [settings, setSettings] = useState(initial.settings);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ parent: Path; index: number } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const c = ctxByBusiness[subAccountId] ?? { forms: [], stages: [], customFields: [] };

  const insert = (parent: Path, index: number, type: StepType) => {
    const step = defaultConfig(type);
    setSteps((s) => updateList(s, parent, (l) => [...l.slice(0, index), step, ...l.slice(index)]));
    setAdding(null);
    setEditing(step.id);
  };
  const patch = (parent: Path, index: number, next: Step) => setSteps((s) => updateList(s, parent, (l) => l.map((x, i) => (i === index ? next : x))));
  const remove = (parent: Path, index: number) => setSteps((s) => updateList(s, parent, (l) => l.filter((_, i) => i !== index)));
  const move = (parent: Path, index: number, dir: -1 | 1) => setSteps((s) => updateList(s, parent, (l) => {
    const j = index + dir;
    if (j < 0 || j >= l.length) return l;
    const copy = [...l];
    [copy[index], copy[j]] = [copy[j], copy[index]];
    return copy;
  }));

  const save = (activate?: boolean) => start(async () => {
    if (!subAccountId) { toast('Pick a business', 'error'); return; }
    const r = await saveWorkflowAction({ id: initial.id, subAccountId, name, description: initial.description, trigger, steps, settings, activate });
    if (!r.ok) { toast(r.error, 'error'); return; }
    toast(activate === undefined ? 'Saved' : activate ? 'Saved and switched on' : 'Saved and paused');
    if (!initial.id && r.data) router.replace(`/automations/${r.data.id}`);
    router.refresh();
  });

  const renderList = (list: Step[], parent: Path, depth: number): React.ReactNode => (
    <div className={cn('flex flex-col items-center', depth > 0 && 'w-full')}>
      <AddPoint onClick={() => setAdding({ parent, index: 0 })} active={adding?.index === 0 && JSON.stringify(adding.parent) === JSON.stringify(parent)} />
      {adding && adding.index === 0 && JSON.stringify(adding.parent) === JSON.stringify(parent) ? <ActionPicker onPick={(t) => insert(parent, 0, t)} onClose={() => setAdding(null)} /> : null}
      {list.map((step, i) => {
        const I = ICONS[step.type];
        const isEditing = editing === step.id;
        return (
          <div key={step.id} className="flex w-full flex-col items-center">
            <div className={cn('w-full max-w-md rounded-2xl border bg-surface shadow-sm', isEditing ? 'border-accent' : 'border-border')}>
              <div className="flex items-center gap-3 p-3">
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', step.type === 'wait' ? 'bg-surface-2 text-muted' : step.type === 'condition' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}><I className="size-4" /></span>
                <button onClick={() => setEditing(isEditing ? null : step.id)} className="min-w-0 flex-1 text-left">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted">{ACTIONS.find((a) => a.type === step.type)?.label}</p>
                  <p className="truncate text-sm font-medium">{describeStep(step)}</p>
                </button>
                <div className="flex shrink-0">
                  <button onClick={() => move(parent, i, -1)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Move up"><ArrowUp className="size-3.5" /></button>
                  <button onClick={() => move(parent, i, 1)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Move down"><ArrowDown className="size-3.5" /></button>
                  <button onClick={() => remove(parent, i)} className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger" aria-label="Delete"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
              {isEditing ? <div className="border-t border-border p-3"><StepEditor step={step} onChange={(s) => patch(parent, i, s)} c={c} /></div> : null}
            </div>
            {step.type === 'condition' ? (
              <div className="mt-2 grid w-full grid-cols-1 gap-3 md:grid-cols-2">
                {(['yes', 'no'] as const).map((branch) => (
                  <div key={branch} className={cn('rounded-2xl border border-dashed p-2', branch === 'yes' ? 'border-ok/40' : 'border-danger/30')}>
                    <p className={cn('text-center text-xs font-semibold uppercase', branch === 'yes' ? 'text-ok' : 'text-danger')}>{branch === 'yes' ? 'Yes' : 'No'}</p>
                    {renderList(step[branch] ?? [], [...parent, i, branch], depth + 1)}
                  </div>
                ))}
              </div>
            ) : null}
            <AddPoint onClick={() => setAdding({ parent, index: i + 1 })} active={adding?.index === i + 1 && JSON.stringify(adding.parent) === JSON.stringify(parent)} />
            {adding && adding.index === i + 1 && JSON.stringify(adding.parent) === JSON.stringify(parent) ? <ActionPicker onPick={(t) => insert(parent, i + 1, t)} onClose={() => setAdding(null)} /> : null}
          </div>
        );
      })}
    </div>
  );

  const tDef = TRIGGERS.find((t) => t.type === trigger.type);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Automation name" className="min-w-60 flex-1"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {!initial.subAccountId && businesses.length > 1 ? (
          <Field label="Business"><Select value={subAccountId} onChange={(e) => setSubAccountId(e.target.value)}><option value="">Choose…</option>{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        ) : null}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => save()}>Save</Button>
          {initial.status === 'active'
            ? <Button variant="secondary" disabled={pending} onClick={() => save(false)}>Pause</Button>
            : <Button variant="primary" disabled={pending} onClick={() => save(true)}><Zap className="size-4" />Save & turn on</Button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!settings.stopOnReply} onChange={(e) => setSettings({ ...settings, stopOnReply: e.target.checked })} />Stop when the customer replies</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!settings.allowReentry} onChange={(e) => setSettings({ ...settings, allowReentry: e.target.checked })} />Allow the same person to go through again while running</label>
      </div>

      <div className="rounded-3xl bg-surface-2 p-4 sm:p-6">
        <div className="mx-auto w-full max-w-md rounded-2xl border-2 border-accent bg-surface p-4 shadow-sm">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent"><Zap className="size-4" />When this happens</p>
          <Select value={trigger.type} onChange={(e) => setTrigger({ type: e.target.value as Trigger['type'], config: {} })}>
            {[...new Set(TRIGGERS.map((t) => t.group))].map((g) => (
              <optgroup key={g} label={g}>{TRIGGERS.filter((t) => t.group === g).map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</optgroup>
            ))}
          </Select>
          <div className="mt-2 space-y-2">
            {tDef?.configFields?.includes('source') ? <Select value={trigger.config?.source ?? ''} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, source: e.target.value || undefined } })}><option value="">Any source</option>{['website', 'facebook', 'instagram', 'google', 'referral', 'phone', 'sms', 'manual'].map((s) => <option key={s} value={s}>Only from {s}</option>)}</Select> : null}
            {tDef?.configFields?.includes('tag') ? <Input placeholder="Tag name (e.g. VIP)" value={trigger.config?.tag ?? ''} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, tag: e.target.value || undefined } })} /> : null}
            {tDef?.configFields?.includes('formId') ? <Select value={trigger.config?.formId ?? ''} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, formId: e.target.value || undefined } })}><option value="">Any form</option>{c.forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select> : null}
            {tDef?.configFields?.includes('stageName') ? <Select value={trigger.config?.stageName ?? ''} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, stageName: e.target.value || undefined } })}><option value="">Any stage</option>{c.stages.map((s) => <option key={s} value={s}>Moved to {s}</option>)}</Select> : null}
            {tDef?.configFields?.includes('channel') ? <Select value={trigger.config?.channel ?? ''} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, channel: e.target.value || undefined } })}><option value="">Any channel</option><option value="sms">SMS</option><option value="email">Email</option></Select> : null}
            {tDef?.configFields?.includes('jobStatus') ? <Select value={trigger.config?.jobStatus ?? ''} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, jobStatus: e.target.value || undefined } })}><option value="">Any status</option>{['booked', 'scheduled', 'in_progress', 'waiting', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>Changed to {s.replace('_', ' ')}</option>)}</Select> : null}
            {trigger.type === 'schedule' ? (
              <div className="grid grid-cols-3 gap-2">
                <Select value={trigger.config?.every ?? 'day'} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, every: e.target.value as 'day' } })}><option value="day">Every day</option><option value="weekday">Weekdays</option><option value="week">Weekly</option></Select>
                <Input type="time" value={trigger.config?.at ?? '09:00'} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, at: e.target.value } })} />
                {trigger.config?.every === 'week' ? <Select value={String(trigger.config?.weekday ?? 1)} onChange={(e) => setTrigger({ ...trigger, config: { ...trigger.config, weekday: Number(e.target.value) } })}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select> : null}
              </div>
            ) : null}
          </div>
        </div>
        {renderList(steps, [], 0)}
        <div className="mx-auto mt-1 w-fit rounded-full bg-surface px-4 py-1.5 text-xs font-medium text-muted">End</div>
      </div>
    </div>
  );
}

function AddPoint({ onClick, active }: { onClick: () => void; active: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="h-4 w-px bg-border" />
      <button onClick={onClick} className={cn('flex size-8 items-center justify-center rounded-full border bg-surface transition-colors', active ? 'border-accent text-accent' : 'border-border text-muted hover:border-accent hover:text-accent')} aria-label="Add step"><Plus className="size-4" /></button>
      <div className="h-4 w-px bg-border" />
    </div>
  );
}

function ActionPicker({ onPick, onClose }: { onPick: (t: StepType) => void; onClose: () => void }) {
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  return (
    <div className="mb-2 w-full max-w-md rounded-2xl border border-accent bg-surface p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">Add a step</p><button onClick={onClose} className="text-muted"><X className="size-4" /></button></div>
      {groups.map((g) => (
        <div key={g} className="mb-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{g}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {ACTIONS.filter((a) => a.group === g).map((a) => {
              const I = ICONS[a.type];
              return <button key={a.type} onClick={() => onPick(a.type)} className="flex h-10 items-center gap-2 rounded-xl bg-surface-2 px-3 text-left text-sm hover:bg-accent-soft hover:text-accent"><I className="size-4" />{a.label}</button>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Vars() {
  return <p className="text-xs text-muted">Insert: {TEMPLATE_VARIABLES.slice(0, 8).map((v) => <code key={v} className="mr-1 rounded bg-surface-2 px-1">{`{{${v}}}`}</code>)}</p>;
}

function StepEditor({ step, onChange, c }: { step: Step; onChange: (s: Step) => void; c: Ctx }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...step, config: { ...step.config, ...patch } } as Step);
  switch (step.type) {
    case 'wait': return (
      <div className="grid grid-cols-2 gap-2">
        <Input type="number" min={1} value={step.config.amount} onChange={(e) => set({ amount: Number(e.target.value) })} />
        <Select value={step.config.unit} onChange={(e) => set({ unit: e.target.value })}><option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option></Select>
      </div>
    );
    case 'send_email': return (<div className="space-y-2"><Input placeholder="Subject" value={step.config.subject} onChange={(e) => set({ subject: e.target.value })} /><Textarea rows={5} value={step.config.body} onChange={(e) => set({ body: e.target.value })} /><Vars /></div>);
    case 'send_sms': return (<div className="space-y-2"><Textarea rows={3} value={step.config.body} onChange={(e) => set({ body: e.target.value })} /><p className="text-xs text-muted">{step.config.body.length} characters</p><Vars /></div>);
    case 'create_task': return (
      <div className="space-y-2">
        <Input value={step.config.title} onChange={(e) => set({ title: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Due in (days)"><Input type="number" min={0} value={step.config.dueInDays ?? 0} onChange={(e) => set({ dueInDays: Number(e.target.value) })} /></Field>
          <Field label="Priority"><Select value={step.config.priority ?? 'normal'} onChange={(e) => set({ priority: e.target.value })}>{['low', 'normal', 'high', 'urgent'].map((p) => <option key={p}>{p}</option>)}</Select></Field>
        </div>
      </div>
    );
    case 'add_tag': case 'remove_tag': return <Input placeholder="Tag" value={step.config.tag} onChange={(e) => set({ tag: e.target.value })} />;
    case 'update_field': return (
      <div className="grid grid-cols-2 gap-2">
        <Select value={step.config.field} onChange={(e) => set({ field: e.target.value })}>
          <option value="status">Contact status</option><option value="source">Lead source</option><option value="lead_score">Lead score</option>
          {c.customFields.map((f) => <option key={f.key} value={`custom.${f.key}`}>{f.label}</option>)}
        </Select>
        <Input value={step.config.value} onChange={(e) => set({ value: e.target.value })} placeholder="Value" />
      </div>
    );
    case 'move_deal': return <Select value={step.config.stageName} onChange={(e) => set({ stageName: e.target.value })}><option value="">Choose stage…</option>{c.stages.map((s) => <option key={s}>{s}</option>)}</Select>;
    case 'create_invoice': case 'create_quote': return (
      <div className="space-y-2">
        <Input placeholder="Description" value={step.config.description} onChange={(e) => set({ description: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <Input inputMode="decimal" placeholder="Amount ex GST" defaultValue={step.config.amountCents ? (step.config.amountCents / 100).toFixed(2) : ''} onChange={(e) => set({ amountCents: Math.round(Number(e.target.value.replace(/[$,]/g, '')) * 100) || 0 })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!step.config.send} onChange={(e) => set({ send: e.target.checked })} />Send automatically</label>
        </div>
      </div>
    );
    case 'create_appointment': return (
      <div className="space-y-2">
        <Input value={step.config.title} onChange={(e) => set({ title: e.target.value })} />
        <div className="grid grid-cols-3 gap-2">
          <Field label="In days"><Input type="number" min={0} value={step.config.inDays} onChange={(e) => set({ inDays: Number(e.target.value) })} /></Field>
          <Field label="Hour"><Input type="number" min={0} max={23} value={step.config.hour} onChange={(e) => set({ hour: Number(e.target.value) })} /></Field>
          <Field label="Minutes"><Input type="number" min={5} value={step.config.durationMinutes ?? 60} onChange={(e) => set({ durationMinutes: Number(e.target.value) })} /></Field>
        </div>
      </div>
    );
    case 'notify': return (<div className="space-y-2"><Input placeholder="Title" value={step.config.title} onChange={(e) => set({ title: e.target.value })} /><Input placeholder="Details (optional)" value={step.config.body ?? ''} onChange={(e) => set({ body: e.target.value })} /></div>);
    case 'webhook': return (<div className="space-y-1"><Input value={step.config.url} onChange={(e) => set({ url: e.target.value })} /><p className="text-xs text-muted">We POST the contact, event and business as JSON (works with Zapier, Make, GoHighLevel inbound webhooks).</p></div>);
    case 'http_request': return (
      <div className="space-y-2">
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <Select value={step.config.method} onChange={(e) => set({ method: e.target.value })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</Select>
          <Input value={step.config.url} onChange={(e) => set({ url: e.target.value })} />
        </div>
        <Textarea rows={3} placeholder='{"name": "{{contact.name}}"}' value={step.config.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
      </div>
    );
    case 'condition': {
      const conds = step.config.conditions;
      const setConds = (next: Condition[]) => set({ conditions: next });
      return (
        <div className="space-y-2">
          <Select value={step.config.match} onChange={(e) => set({ match: e.target.value })}><option value="all">All of these are true</option><option value="any">Any of these is true</option></Select>
          {conds.map((cond, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_1fr_2rem] gap-1.5">
              <Select value={cond.field} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}>
                {CONDITION_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                {c.customFields.map((f) => <option key={f.key} value={`custom.${f.key}`}>{f.label}</option>)}
              </Select>
              <Select value={cond.op} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, op: e.target.value as Condition['op'] } : x)))}>
                {[['eq', 'is'], ['neq', 'is not'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['contains', 'contains'], ['has_tag', 'has tag'], ['not_has_tag', "doesn't have tag"], ['is_set', 'is set'], ['not_set', 'is empty']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Input value={String(cond.value ?? '')} onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <button onClick={() => setConds(conds.filter((_, j) => j !== i))} className="text-muted hover:text-danger" aria-label="Remove condition"><X className="size-4" /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setConds([...conds, { field: 'contact.tags', op: 'has_tag', value: '' }])}><Plus className="size-4" />Condition</Button>
        </div>
      );
    }
    case 'stop': return <p className="text-sm text-muted">The automation ends here.</p>;
  }
}
