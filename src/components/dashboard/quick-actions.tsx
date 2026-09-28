'use client';

import Link from 'next/link';
import { CalendarPlus, CheckSquare, FilePlus, FileText, MessageSquare, Sparkles, UserPlus, Workflow } from 'lucide-react';
import { openQuickAdd } from '@/components/shell/quick-add';

type Key = 'lead' | 'contact' | 'quote' | 'invoice' | 'task' | 'appointment' | 'message' | 'automation';
const ACTIONS: { key: Key; label: string; icon: typeof Sparkles; kind?: 'lead' | 'contact' | 'quote' | 'invoice' | 'task' | 'appointment'; href?: string; module?: string }[] = [
  { key: 'lead', label: 'Add lead', icon: Sparkles, kind: 'lead', module: 'leads' },
  { key: 'contact', label: 'Add customer', icon: UserPlus, kind: 'contact' },
  { key: 'quote', label: 'Create quote', icon: FileText, kind: 'quote', module: 'quotes' },
  { key: 'invoice', label: 'Create invoice', icon: FilePlus, kind: 'invoice', module: 'invoices' },
  { key: 'task', label: 'Add task', icon: CheckSquare, kind: 'task' },
  { key: 'appointment', label: 'Book appointment', icon: CalendarPlus, kind: 'appointment', module: 'calendar' },
  { key: 'message', label: 'Send message', icon: MessageSquare, href: '/inbox?compose=1', module: 'inbox' },
  { key: 'automation', label: 'New automation', icon: Workflow, href: '/automations/new', module: 'automations' },
];

/** Big, obvious buttons. Hidden when no business in view uses that module. */
export function QuickActions({ modules, allowed }: { modules: string[]; allowed: Record<Key, boolean> }) {
  const set = new Set(modules);
  const items = ACTIONS.filter((a) => allowed[a.key] && (!a.module || set.has(a.module)));
  const cls = 'flex h-14 shrink-0 items-center gap-3 rounded-2xl border border-border bg-surface px-4 text-sm font-medium transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent';
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
      {items.map((a) => a.href ? (
        <Link key={a.label} href={a.href} className={cls}><a.icon className="size-5 text-accent" />{a.label}</Link>
      ) : (
        <button key={a.label} onClick={() => openQuickAdd(a.kind!)} className={cls}><a.icon className="size-5 text-accent" />{a.label}</button>
      ))}
    </div>
  );
}
