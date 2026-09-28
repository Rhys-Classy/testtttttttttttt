'use client';

import Link from 'next/link';
import { CalendarPlus, CheckSquare, FilePlus, FileText, MessageSquare, Sparkles, UserPlus, Workflow } from 'lucide-react';
import { openQuickAdd } from '@/components/shell/quick-add';

const ACTIONS = [
  { label: 'Add lead', icon: Sparkles, kind: 'lead' as const, module: 'leads' },
  { label: 'Add customer', icon: UserPlus, kind: 'contact' as const },
  { label: 'Create quote', icon: FileText, kind: 'quote' as const, module: 'quotes' },
  { label: 'Create invoice', icon: FilePlus, kind: 'invoice' as const, module: 'invoices' },
  { label: 'Add task', icon: CheckSquare, kind: 'task' as const },
  { label: 'Book appointment', icon: CalendarPlus, kind: 'appointment' as const, module: 'calendar' },
  { label: 'Send message', icon: MessageSquare, href: '/inbox?compose=1', module: 'inbox' },
  { label: 'New automation', icon: Workflow, href: '/automations/new', module: 'automations' },
];

/** Big, obvious buttons. Hidden when no business in view uses that module. */
export function QuickActions({ modules }: { modules: string[] }) {
  const set = new Set(modules);
  const items = ACTIONS.filter((a) => !a.module || set.has(a.module));
  const cls = 'flex h-14 shrink-0 items-center gap-3 rounded-2xl border border-border bg-surface px-4 text-sm font-medium transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent';
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
      {items.map((a) => a.href ? (
        <Link key={a.label} href={a.href} className={cls}><a.icon className="size-5 text-accent" />{a.label}</Link>
      ) : (
        <button key={a.label} onClick={() => openQuickAdd(a.kind)} className={cls}><a.icon className="size-5 text-accent" />{a.label}</button>
      ))}
    </div>
  );
}
