'use client';

import Link from 'next/link';
import { useOptimistic, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { moveDealAction } from '@/server/actions/crm';
import { toast } from '@/components/toast';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/cn';

export type BoardStage = { id: string; name: string; kind: string };
export type BoardDeal = { id: string; subAccountId: string; stageId: string; title: string; contact: string | null; contactId: string | null; valueCents: number; daysInStage: number; highlight?: boolean };

/** Drag a card to move it. On phones, use the stage picker on each card. */
export function Board({ stages, deals, view }: { stages: BoardStage[]; deals: BoardDeal[]; view: 'board' | 'list' }) {
  const [, start] = useTransition();
  const router = useRouter();
  const [optimistic, move] = useOptimistic(deals, (state, a: { id: string; stageId: string }) => state.map((d) => (d.id === a.id ? { ...d, stageId: a.stageId, daysInStage: 0 } : d)));

  const moveTo = (deal: BoardDeal, stageId: string) => {
    if (deal.stageId === stageId) return;
    start(async () => {
      move({ id: deal.id, stageId });
      const res = await moveDealAction(deal.subAccountId, deal.id, stageId);
      if (!res.ok) toast(res.error, 'error');
      else toast(`Moved to ${stages.find((s) => s.id === stageId)?.name}`);
      router.refresh();
    });
  };

  if (view === 'list') {
    return (
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {optimistic.map((d) => (
          <li key={d.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-3', d.highlight && 'bg-accent-soft')}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d.title}</p>
              <p className="text-xs text-muted">{d.contactId ? <Link href={`/contacts/${d.contactId}`} className="hover:underline">{d.contact}</Link> : 'No contact'} · {d.daysInStage}d in stage</p>
            </div>
            <span className="text-sm font-semibold tabular-nums">{formatMoney(d.valueCents)}</span>
            <StageSelect stages={stages} value={d.stageId} onChange={(s) => moveTo(d, s)} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
      {stages.map((s) => {
        const items = optimistic.filter((d) => d.stageId === s.id);
        const total = items.reduce((a, d) => a + d.valueCents, 0);
        return (
          <div key={s.id} className="flex w-72 shrink-0 snap-start flex-col rounded-2xl bg-surface-2 p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { const id = e.dataTransfer.getData('text/deal'); const d = optimistic.find((x) => x.id === id); if (d) moveTo(d, s.id); }}>
            <div className="flex items-baseline justify-between px-2 pb-2 pt-1">
              <p className={cn('text-sm font-semibold', s.kind === 'won' && 'text-ok', s.kind === 'lost' && 'text-muted')}>{s.name}</p>
              <p className="text-xs text-muted">{items.length} · {formatMoney(total, 'AUD', 'en-AU', { compact: true })}</p>
            </div>
            <div className="flex min-h-24 flex-col gap-2">
              {items.map((d) => (
                <div key={d.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/deal', d.id)}
                  className={cn('cursor-grab rounded-xl border border-border bg-surface p-3 shadow-sm active:cursor-grabbing', d.highlight && 'ring-2 ring-accent')}>
                  <p className="text-sm font-medium leading-snug">{d.title}</p>
                  {d.contactId ? <Link href={`/contacts/${d.contactId}`} className="mt-0.5 block truncate text-xs text-muted hover:underline">{d.contact}</Link> : null}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-semibold tabular-nums">{formatMoney(d.valueCents)}</span>
                    <span className={cn('text-xs', d.daysInStage > 14 ? 'text-warn' : 'text-muted')}>{d.daysInStage}d</span>
                  </div>
                  <div className="mt-2 md:hidden"><StageSelect stages={stages} value={d.stageId} onChange={(st) => moveTo(d, st)} /></div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StageSelect({ stages, value, onChange }: { stages: BoardStage[]; value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-surface px-2 text-xs sm:w-auto" aria-label="Move to stage">
      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}
