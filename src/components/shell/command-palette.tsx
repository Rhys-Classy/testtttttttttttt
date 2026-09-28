'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { ArrowRight, Bot, CornerDownLeft, LayoutGrid, Loader2, Search, Sparkles } from 'lucide-react';
import { describeCommand, parseCommand } from '@/lib/commands/parse';
import { formatMoney } from '@/lib/money';
import { runCommandAction, searchAction, switchBusiness, type ClarifyOption, type SearchHit } from '@/server/actions/shell';
import { Icon } from '@/components/icon';
import { toast } from '@/components/toast';
import type { ShellData } from './types';

export function openCommandPalette(initial?: string) {
  window.dispatchEvent(new CustomEvent('bos:command', { detail: { initial } }));
}

export function openAssistant(question?: string) {
  window.dispatchEvent(new CustomEvent('bos:assistant', { detail: { question } }));
}

const TYPE_LABEL: Record<string, string> = {
  contact: 'Contact', company: 'Company', lead: 'Lead', deal: 'Deal', job: 'Job', quote: 'Quote', invoice: 'Invoice', payment: 'Payment', task: 'Task', message: 'Message',
};

const EXAMPLES = [
  'Create invoice for John for $2,500 plus GST',
  'Create task to call Steve tomorrow',
  'Book meeting with John Friday at 2pm',
  'Show overdue invoices',
  'Show leads from Facebook',
  'What should I do today?',
];

export function CommandPalette({ data }: { data: ShellData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [clarify, setClarify] = useState<{ question: string; options: ClarifyOption[] } | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => { setOpen(false); setValue(''); setHits([]); setClarify(null); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === '/' && !open && !(e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); setOpen(true); }
    };
    const onOpen = (e: Event) => { setOpen(true); const initial = (e as CustomEvent).detail?.initial; if (initial) setValue(initial); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('bos:command', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('bos:command', onOpen); };
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 10); }, [open]);

  const parsed = useMemo(() => parseCommand(value, { tzOffsetMinutes: data.tzOffsetMinutes }), [value, data.tzOffsetMinutes]);
  const isAction = !['search'].includes(parsed.intent) && value.trim().length > 0;

  // Live search as you type (debounced).
  useEffect(() => {
    const q = parsed.intent === 'search' ? parsed.query : value.length >= 2 && !isAction ? value : '';
    if (!q || q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => { searchAction(q).then(setHits).catch(() => setHits([])); }, 180);
    return () => clearTimeout(t);
  }, [value, parsed, isAction]);

  const run = (pick?: ClarifyOption['pick']) => {
    start(async () => {
      if (parsed.intent === 'ask') {
        close();
        openAssistant(parsed.question);
        return;
      }
      const outcome = await runCommandAction(value, pick ?? {});
      switch (outcome.kind) {
        case 'navigate': close(); router.push(outcome.href); break;
        case 'done': close(); toast(outcome.message, 'ok'); if (outcome.href) router.push(outcome.href); router.refresh(); break;
        case 'clarify': setClarify({ question: outcome.question, options: outcome.options }); break;
        case 'ask': close(); openAssistant(outcome.question); break;
        case 'search': setValue(outcome.query); break;
        case 'error': toast(outcome.message, 'error'); break;
      }
    });
  };

  const go = (href: string) => { close(); router.push(href); };
  const pickBusiness = (id: string) => start(async () => { await switchBusiness(id); close(); router.refresh(); });

  const q = value.toLowerCase().trim();
  const navMatches = data.nav.filter((n) => !q || n.label.toLowerCase().includes(q)).slice(0, q ? 5 : 8);
  const bizMatches = data.businesses.filter((b) => !q || b.name.toLowerCase().includes(q) || (b.shortName ?? '').toLowerCase().includes(q));

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-3 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Command centre">
      <button className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-label="Close" onClick={close} />
      <Command shouldFilter={false} loop className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); if (clarify) setClarify(null); else close(); } }}>
        <div className="flex items-center gap-3 border-b border-border px-4">
          {pending ? <Loader2 className="size-5 animate-spin text-muted" /> : <Search className="size-5 text-muted" />}
          <Command.Input ref={inputRef} value={value} onValueChange={(v) => { setValue(v); setClarify(null); }}
            placeholder={data.currentId ? 'Search or tell me what to do…' : 'Search all businesses or tell me what to do…'}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted" />
          <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-xs text-muted sm:block">Esc</kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          {clarify ? (
            <Command.Group heading={clarify.question} className="cmdk-group">
              {clarify.options.map((o, i) => (
                <Item key={i} onSelect={() => run(o.pick)} icon={o.color ? <span className="size-3 rounded-full" style={{ backgroundColor: o.color }} /> : <ArrowRight className="size-4" />} title={o.label} subtitle={o.sublabel} />
              ))}
            </Command.Group>
          ) : (
            <>
              {isAction ? (
                <Command.Group heading="Do it" className="cmdk-group">
                  <Item onSelect={() => run()} icon={parsed.intent === 'ask' ? <Bot className="size-4" /> : <Sparkles className="size-4" />}
                    title={describeCommand(parsed, (c) => formatMoney(c), (iso) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}
                    subtitle={['create_invoice', 'create_quote'].includes(parsed.intent) ? 'Creates a draft for you to review before sending' : undefined}
                    hint={<CornerDownLeft className="size-3.5" />} />
                </Command.Group>
              ) : null}
              {hits.length ? (
                <Command.Group heading="Results" className="cmdk-group">
                  {hits.map((h) => (
                    <Item key={`${h.type}-${h.id}`} onSelect={() => go(h.href)} title={h.title}
                      subtitle={<>{TYPE_LABEL[h.type]}{h.subtitle ? ` · ${h.subtitle}` : ''}</>}
                      icon={<span className="size-2.5 rounded-full" style={{ backgroundColor: h.business?.color }} />}
                      hint={<span className="text-xs text-muted">{h.business?.shortName ?? h.business?.name}</span>} />
                  ))}
                </Command.Group>
              ) : null}
              {!value ? (
                <Command.Group heading="Try saying" className="cmdk-group">
                  {EXAMPLES.map((ex) => <Item key={ex} onSelect={() => setValue(ex)} icon={<Sparkles className="size-4" />} title={ex} />)}
                </Command.Group>
              ) : null}
              {navMatches.length ? (
                <Command.Group heading="Go to" className="cmdk-group">
                  {navMatches.map((n) => <Item key={n.key} onSelect={() => go(n.href)} icon={<Icon name={n.icon} className="size-4" />} title={n.label} />)}
                </Command.Group>
              ) : null}
              {bizMatches.length ? (
                <Command.Group heading="Switch business" className="cmdk-group">
                  {!q || 'all businesses'.includes(q) ? <Item onSelect={() => pickBusiness('all')} icon={<LayoutGrid className="size-4" />} title="All Businesses" /> : null}
                  {bizMatches.map((b) => <Item key={b.id} onSelect={() => pickBusiness(b.id)} icon={<span className="size-3 rounded-full" style={{ backgroundColor: b.color }} />} title={b.name} hint={b.id === data.currentId ? <span className="text-xs text-accent">Current</span> : undefined} />)}
                </Command.Group>
              ) : null}
              <Command.Empty className="px-4 py-8 text-center text-sm text-muted">Nothing found. Press Enter to ask the assistant.</Command.Empty>
            </>
          )}
        </Command.List>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
          <span>{data.currentId ? `In ${data.businesses.find((b) => b.id === data.currentId)?.name}` : 'All Businesses'}</span>
          <span className="hidden sm:inline">↑↓ to move · Enter to run · Ctrl/⌘ K to toggle</span>
        </div>
      </Command>
      <style>{`.cmdk-group [cmdk-group-heading]{padding:8px 12px 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}`}</style>
    </div>
  );
}

function Item({ onSelect, icon, title, subtitle, hint }: { onSelect: () => void; icon?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Command.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-sm data-[selected=true]:bg-surface-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle ? <span className="block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
      {hint ? <span className="shrink-0 text-muted">{hint}</span> : null}
    </Command.Item>
  );
}
