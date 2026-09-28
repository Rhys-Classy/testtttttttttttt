'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Check, Loader2, Send, X } from 'lucide-react';
import { toast } from '@/components/toast';
import { cn } from '@/lib/cn';

type Pending = { id: string; tool: string; input: Record<string, unknown>; summary: string; business: string };
type Msg = { role: 'user' | 'assistant'; content: string; pending?: Pending[] };

const SUGGESTIONS = ['What should I do today?', 'Who owes me money?', "Show me leads that haven't been contacted in 3 days", 'Give me a summary of all my businesses'];

/** Slide-over chat. The assistant only acts through permission-checked tools; money/customer actions need a Confirm tap. */
export function AssistantPanel({ currentBusiness }: { currentBusiness: string | null }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: 'user' as const, content: q }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }) });
      const data = await res.json();
      setMsgs((m) => [...m, { role: 'assistant', content: data.text ?? data.error ?? 'Something went wrong.', pending: data.pending ?? [] }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Could not reach the assistant.' }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onOpen = (e: Event) => { setOpen(true); const q = (e as CustomEvent).detail?.question; if (q) void send(q); };
    window.addEventListener('bos:assistant', onOpen);
    return () => window.removeEventListener('bos:assistant', onOpen);
  });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  const confirm = async (p: Pending) => {
    setDone((d) => ({ ...d, [p.id]: true }));
    const res = await fetch('/api/assistant/confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: p.tool, input: p.input }) });
    const data = await res.json();
    if (data.ok) { toast(data.message, 'ok'); if (data.href) router.push(data.href); router.refresh(); }
    else { toast(data.error ?? 'Could not do that', 'error'); setDone((d) => ({ ...d, [p.id]: false })); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65] flex justify-end" role="dialog" aria-modal="true" aria-label="Assistant">
      <button className="absolute inset-0 bg-black/30" aria-label="Close" onClick={() => setOpen(false)} />
      <div className="pb-safe relative flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><Bot className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Assistant</p>
            <p className="truncate text-xs text-muted">{currentBusiness ? `Working in ${currentBusiness}` : 'All businesses'}</p>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!msgs.length ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">Ask anything about your businesses. I can look things up, and prepare invoices, quotes, bookings and messages for you to confirm.</p>
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="block w-full rounded-2xl border border-border px-4 py-3 text-left text-sm hover:bg-surface-2">{s}</button>)}
            </div>
          ) : null}
          {msgs.map((m, i) => (
            <div key={i} className={cn('max-w-[90%] rounded-2xl px-4 py-3 text-sm', m.role === 'user' ? 'ml-auto bg-accent text-accent-fg' : 'bg-surface-2')}>
              <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
              {m.pending?.map((p) => (
                <div key={p.id} className="mt-3 rounded-xl border border-border bg-surface p-3 text-text">
                  <p className="text-xs font-medium text-muted">{p.business}</p>
                  <p className="mt-0.5 text-sm">{p.summary}</p>
                  <button disabled={done[p.id]} onClick={() => confirm(p)} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-50">
                    <Check className="size-4" />{done[p.id] ? 'Done' : 'Confirm'}
                  </button>
                </div>
              ))}
            </div>
          ))}
          {busy ? <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Thinking…</div> : null}
          <div ref={endRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="flex gap-2 border-t border-border p-3">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask or tell me to do something…" autoFocus
            className="h-12 flex-1 rounded-xl border border-border bg-surface px-4 text-sm placeholder:text-muted focus:border-accent focus:outline-none" />
          <button disabled={busy || !input.trim()} className="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-fg disabled:opacity-50" aria-label="Send"><Send className="size-5" /></button>
        </form>
      </div>
    </div>
  );
}
