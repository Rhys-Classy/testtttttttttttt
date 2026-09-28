'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, Check, Circle } from 'lucide-react';
import { completeTaskAction, reopenTaskAction, snoozeTaskAction } from '@/server/actions/tasks';
import { BusinessBadge } from '@/components/business-badge';
import { toast } from '@/components/toast';
import { cn } from '@/lib/cn';

export type TaskRowData = {
  id: string;
  subAccountId: string;
  title: string;
  done: boolean;
  priority: string;
  dueLabel?: string | null;
  overdue?: boolean;
  contact?: string | null;
  href?: string | null;
  business?: { name: string; shortName: string | null; color: string } | null;
};

/** One tap to complete. Snooze without opening anything. */
export function TaskRow({ task, showBusiness }: { task: TaskRowData; showBusiness?: boolean }) {
  const [done, setDone] = useState(task.done);
  const [menu, setMenu] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();

  const toggle = () => {
    const next = !done;
    setDone(next);
    start(async () => {
      const res = next ? await completeTaskAction(task.subAccountId, task.id) : await reopenTaskAction(task.subAccountId, task.id);
      if (!res.ok) { setDone(!next); toast(res.error, 'error'); return; }
      if (next) toast(`Done: ${task.title}`);
      router.refresh();
    });
  };

  const snooze = (opt: string) => {
    setMenu(false);
    start(async () => {
      const res = await snoozeTaskAction(task.subAccountId, task.id, opt);
      if (!res.ok) toast(res.error, 'error'); else { toast('Snoozed'); router.refresh(); }
    });
  };

  return (
    <div className={cn('group relative flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2', done && 'opacity-60')}>
      <button onClick={toggle} aria-label={done ? 'Mark not done' : 'Mark done'}
        className={cn('flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          done ? 'border-ok bg-ok text-white' : task.priority === 'urgent' || task.priority === 'high' ? 'border-danger/60 hover:bg-danger-soft' : 'border-border hover:border-accent hover:bg-accent-soft')}>
        {done ? <Check className="size-4" /> : <Circle className="size-0" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', done && 'line-through')}>{task.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {showBusiness && task.business ? <BusinessBadge business={task.business} /> : null}
          {task.dueLabel ? <span className={cn(task.overdue && !done && 'font-medium text-danger')}>{task.dueLabel}</span> : null}
          {task.contact ? <span className="truncate">{task.contact}</span> : null}
        </p>
      </div>
      {!done ? (
        <div className="relative">
          <button onClick={() => setMenu((m) => !m)} className="flex size-9 items-center justify-center rounded-xl text-muted opacity-100 hover:bg-surface md:opacity-0 md:group-hover:opacity-100" aria-label="Snooze">
            <AlarmClock className="size-4" />
          </button>
          {menu ? (
            <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
              {[['1h', '1 hour'], ['3h', '3 hours'], ['tomorrow', 'Tomorrow 9am'], ['next_week', 'Next week']].map(([v, l]) => (
                <button key={v} onClick={() => snooze(v)} className="block w-full px-3 py-2.5 text-left text-sm hover:bg-surface-2">{l}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
