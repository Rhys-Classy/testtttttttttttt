'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, Archive, Briefcase, CheckSquare, Clock, Inbox as InboxIcon, Lock, Send, UserCheck } from 'lucide-react';
import { conversationAction, conversationToDealAction, conversationToTaskAction, internalNoteAction, sendMessageAction } from '@/server/actions/comms';
import { toast } from '@/components/toast';
import { cn } from '@/lib/cn';

type Template = { id: string; channel: string; name: string; subject: string | null; body: string };

export function Composer({ subAccountId, contactId, conversationId, channel: initialChannel, canEmail, canSms, templates, firstName, businessName }: {
  subAccountId: string; contactId: string; conversationId?: string; channel: 'email' | 'sms'; canEmail: boolean; canSms: boolean; templates: Template[]; firstName: string; businessName: string;
}) {
  const [channel, setChannel] = useState<'email' | 'sms' | 'note'>(initialChannel);
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [when, setWhen] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const fill = (t: Template) => {
    const r = (s: string) => s.replace(/\{\{\s*contact\.first_name(?:\|([^}]*))?\s*\}\}/g, (_, f) => firstName || f || '').replace(/\{\{\s*business\.name\s*\}\}/g, businessName);
    setBody(r(t.body));
    if (t.subject) setSubject(r(t.subject));
  };
  const submit = () => start(async () => {
    if (channel === 'note') {
      if (!conversationId) return;
      const r = await internalNoteAction(subAccountId, conversationId, body);
      if (!r.ok) { toast(r.error, 'error'); return; }
    } else {
      const fd = new FormData();
      fd.set('subAccountId', subAccountId); fd.set('contactId', contactId); fd.set('channel', channel); fd.set('body', body);
      if (subject) fd.set('subject', subject);
      if (conversationId) fd.set('conversationId', conversationId);
      if (when) fd.set('scheduledAt', new Date(when).toISOString());
      const r = await sendMessageAction(fd);
      if (!r.ok) { toast(r.error, 'error'); return; }
      toast(r.message ?? 'Sent');
      if (!conversationId && r.data?.conversationId) router.push(`/inbox?c=${r.data.conversationId}`);
    }
    setBody(''); setSubject(''); setWhen('');
    router.refresh();
  });
  const smsCount = channel === 'sms' ? Math.ceil(Math.max(body.length, 1) / 160) : 0;
  return (
    <div className="border-t border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {canSms ? <Tab active={channel === 'sms'} onClick={() => setChannel('sms')}>SMS</Tab> : null}
        {canEmail ? <Tab active={channel === 'email'} onClick={() => setChannel('email')}>Email</Tab> : null}
        {conversationId ? <Tab active={channel === 'note'} onClick={() => setChannel('note')}><Lock className="size-3" />Internal note</Tab> : null}
        {templates.filter((t) => t.channel === channel).length ? (
          <select onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) fill(t); e.target.value = ''; }} className="ml-auto h-8 rounded-lg border border-border bg-surface px-2 text-xs" defaultValue="">
            <option value="" disabled>Templates…</option>
            {templates.filter((t) => t.channel === channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        ) : null}
      </div>
      {channel === 'email' ? <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="mb-2 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" /> : null}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder={channel === 'note' ? 'Only your team sees this…' : `Write ${channel === 'sms' ? 'an SMS' : 'an email'}…`}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim()) submit(); }}
        className={cn('w-full rounded-xl border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none', channel === 'note' ? 'bg-warn-soft' : 'bg-surface')} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {channel !== 'note' ? (
          <label className="flex items-center gap-1.5 text-xs text-muted"><Clock className="size-3.5" />
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs" aria-label="Schedule for later" />
          </label>
        ) : null}
        {smsCount ? <span className="text-xs text-muted">{body.length} chars · {smsCount} SMS</span> : null}
        <button disabled={pending || !body.trim()} onClick={submit} className="ml-auto flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50">
          <Send className="size-4" />{channel === 'note' ? 'Add note' : when ? 'Schedule' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={cn('flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium', active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2')}>{children}</button>;
}

export function ThreadActions({ subAccountId, id, contactId, status, assignedToMe }: { subAccountId: string; id: string; contactId: string | null; status: string; assignedToMe: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, msg?: string) => start(async () => {
    const r = await fn(); if (!r.ok) toast(r.error ?? 'Error', 'error'); else { if (msg || r.message) toast(msg ?? r.message!); router.refresh(); }
  });
  const btn = 'flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text disabled:opacity-50';
  return (
    <div className="flex flex-wrap gap-1">
      {status === 'closed'
        ? <button disabled={pending} className={btn} onClick={() => run(() => conversationAction(subAccountId, id, 'reopen'), 'Reopened')}><InboxIcon className="size-4" />Reopen</button>
        : <button disabled={pending} className={btn} onClick={() => run(() => conversationAction(subAccountId, id, 'close'), 'Closed')}><Archive className="size-4" />Close</button>}
      <button disabled={pending} className={btn} onClick={() => run(() => conversationAction(subAccountId, id, 'snooze_tomorrow'), 'Snoozed until tomorrow')}><AlarmClock className="size-4" />Snooze</button>
      <button disabled={pending} className={btn} onClick={() => run(() => conversationAction(subAccountId, id, assignedToMe ? 'unassign' : 'assign_me'), assignedToMe ? 'Unassigned' : 'Assigned to you')}><UserCheck className="size-4" />{assignedToMe ? 'Unassign' : 'Assign to me'}</button>
      {contactId ? <button disabled={pending} className={btn} onClick={() => run(() => conversationToTaskAction(subAccountId, contactId))}><CheckSquare className="size-4" />Task</button> : null}
      {contactId ? <button disabled={pending} className={btn} onClick={() => run(() => conversationToDealAction(subAccountId, contactId))}><Briefcase className="size-4" />Deal</button> : null}
    </div>
  );
}
