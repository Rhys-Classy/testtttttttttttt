'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { appointmentStatusAction } from '@/server/actions/work';
import { toast } from '@/components/toast';
import { cn } from '@/lib/cn';

export type CalEvent = {
  id: string;
  kind: 'appointment' | 'job' | 'task';
  subAccountId: string;
  title: string;
  time: string | null;
  endTime?: string | null;
  sub?: string | null;
  color: string;
  href?: string;
  status?: string;
  business?: string;
  /** Sort key (ms since epoch); all-day items use 0. */
  at: number;
};

export function EventChip({ e, compact }: { e: CalEvent; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (status: 'confirmed' | 'completed' | 'cancelled' | 'no_show') => start(async () => {
    const r = await appointmentStatusAction(e.subAccountId, e.id, status);
    if (!r.ok) toast(r.error, 'error'); else { toast('Updated'); setOpen(false); router.refresh(); }
  });
  const body = (
    <>
      <span className="font-medium">{e.time ? <span className="tabular-nums">{e.time} </span> : null}{e.title}</span>
      {!compact && e.sub ? <span className="block truncate opacity-75">{e.sub}</span> : null}
    </>
  );
  const cls = cn('block w-full truncate rounded-lg border-l-4 px-2 py-1 text-left text-xs', e.status === 'cancelled' && 'line-through opacity-50', e.kind === 'task' ? 'bg-surface' : 'bg-surface-2');
  if (e.kind !== 'appointment') return <Link href={e.href ?? '#'} className={cls} style={{ borderLeftColor: e.color }}>{body}</Link>;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={cls} style={{ borderLeftColor: e.color }}>{body}</button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-60 rounded-xl border border-border bg-surface p-3 text-sm shadow-xl">
          <p className="font-medium">{e.title}</p>
          <p className="text-xs text-muted">{e.time}{e.endTime ? `–${e.endTime}` : ''}{e.business ? ` · ${e.business}` : ''}</p>
          {e.sub ? <p className="mt-1 text-xs">{e.sub}</p> : null}
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {(['confirmed', 'completed', 'no_show', 'cancelled'] as const).map((s) => (
              <button key={s} disabled={pending} onClick={() => set(s)} className={cn('h-8 rounded-lg border border-border text-xs', e.status === s && 'border-accent bg-accent-soft text-accent')}>{s === 'no_show' ? 'No-show' : s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          {e.href ? <Link href={e.href} className="mt-2 block text-xs text-accent">Open contact</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
