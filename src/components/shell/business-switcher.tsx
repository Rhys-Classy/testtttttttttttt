'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, LayoutGrid } from 'lucide-react';
import { switchBusiness } from '@/server/actions/shell';
import { cn } from '@/lib/cn';
import type { ShellBusiness } from './types';

/** "All Businesses ▾" — the most important control in the app. */
export function BusinessSwitcher({ businesses, currentId, compact }: { businesses: ShellBusiness[]; currentId: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const current = businesses.find((b) => b.id === currentId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const choose = (id: string) => {
    setOpen(false);
    start(async () => {
      await switchBusiness(id);
      router.refresh();
    });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border border-border bg-surface text-left font-semibold transition-colors hover:bg-surface-2',
          compact ? 'h-10 px-3 text-sm' : 'h-12 px-3 text-sm',
          pending && 'opacity-60',
        )}
      >
        {current ? (
          <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: current.color }} />
        ) : (
          <LayoutGrid className="size-4 shrink-0 text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate">{current ? current.name : 'All Businesses'}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </button>
      {open ? (
        <div role="listbox" className="absolute left-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-xl">
          <Option active={!current} onClick={() => choose('all')} label="All Businesses" sub={`${businesses.length} businesses`} icon={<LayoutGrid className="size-4 text-muted" />} />
          <div className="my-1 h-px bg-border" />
          {businesses.map((b) => (
            <Option key={b.id} active={b.id === currentId} onClick={() => choose(b.id)} label={b.name}
              icon={<span className="size-3 rounded-full" style={{ backgroundColor: b.color }} />} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Option({ active, onClick, label, sub, icon }: { active: boolean; onClick: () => void; label: string; sub?: string; icon: React.ReactNode }) {
  return (
    <button type="button" role="option" aria-selected={active} onClick={onClick}
      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-2', active && 'bg-surface-2 font-semibold')}>
      <span className="flex size-5 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub ? <span className="block text-xs font-normal text-muted">{sub}</span> : null}
      </span>
      {active ? <Check className="size-4 text-accent" /> : null}
    </button>
  );
}
