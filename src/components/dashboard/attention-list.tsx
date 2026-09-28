'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Bell, CalendarClock, Check, ChevronRight, CreditCard, FileText, Hammer, Mail, MessageSquare, Phone, Sparkles, SquareCheck } from 'lucide-react';
import { completeTaskAction } from '@/server/actions/tasks';
import { sendReminderAction } from '@/server/actions/finance';
import { BusinessBadge } from '@/components/business-badge';
import { toast } from '@/components/toast';
import { cn } from '@/lib/cn';
import type { AttentionItem } from '@/server/queries/dashboard';

type Biz = { id: string; name: string; shortName: string | null; color: string };

const KIND_ICON: Record<AttentionItem['kind'], React.ComponentType<{ className?: string }>> = {
  invoice_overdue: AlertTriangle, payment_failed: CreditCard, task_overdue: SquareCheck, reply_needed: MessageSquare, new_lead: Sparkles,
  quote_followup: FileText, job_tomorrow: Hammer, appointment_soon: CalendarClock, task_today: SquareCheck,
};

/** NOW: the few things that need a human, each with a one-tap action. */
export function AttentionList({ items, businesses, showBusiness, limit = 7 }: { items: AttentionItem[]; businesses: Biz[]; showBusiness: boolean; limit?: number }) {
  const [all, setAll] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const router = useRouter();
  const visible = items.filter((i) => !hidden.has(i.id));
  const shown = all ? visible : visible.slice(0, limit);

  if (!visible.length) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-ok-soft px-4 py-4 text-sm text-ok">
        <Check className="size-5" />
        <span className="font-medium">Nothing urgent. You&apos;re on top of it.</span>
      </div>
    );
  }

  const act = (item: AttentionItem) => {
    const a = item.action!;
    if (a.type === 'call') { window.location.href = `tel:${a.value}`; return; }
    if (a.type === 'email') { window.location.href = `mailto:${a.value}`; return; }
    setHidden((h) => new Set(h).add(item.id));
    start(async () => {
      const res = a.type === 'complete_task' ? await completeTaskAction(item.subAccountId, a.id) : await sendReminderAction(item.subAccountId, a.id);
      if (!res.ok) { toast(res.error, 'error'); setHidden((h) => { const n = new Set(h); n.delete(item.id); return n; }); return; }
      toast(a.type === 'complete_task' ? 'Done' : 'Reminder sent');
      router.refresh();
    });
  };

  return (
    <div>
      <ul className="divide-y divide-border">
        {shown.map((item) => {
          const I = KIND_ICON[item.kind] ?? Bell;
          const biz = businesses.find((b) => b.id === item.subAccountId);
          return (
            <li key={item.id} className="flex items-center gap-3 py-2.5">
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl',
                item.severity === 'urgent' ? 'bg-danger-soft text-danger' : item.severity === 'high' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted')}>
                <I className="size-5" />
              </span>
              <Link href={item.href} className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
                <p className="flex items-center gap-2 truncate text-xs text-muted">
                  {showBusiness ? <BusinessBadge business={biz} /> : null}
                  <span className="truncate">{item.subtitle}</span>
                </p>
              </Link>
              {item.action ? (
                <button onClick={() => act(item)} className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium hover:bg-accent-soft hover:text-accent">
                  {item.action.type === 'call' ? <><Phone className="size-4" />Call</> : item.action.type === 'email' ? <><Mail className="size-4" />Email</> : item.action.type === 'complete_task' ? <><Check className="size-4" />Done</> : <><Bell className="size-4" />Remind</>}
                </button>
              ) : (
                <Link href={item.href} className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2" aria-label="Open"><ChevronRight className="size-4" /></Link>
              )}
            </li>
          );
        })}
      </ul>
      {visible.length > limit ? (
        <button onClick={() => setAll((a) => !a)} className="mt-2 text-sm font-medium text-accent">{all ? 'Show less' : `Show all ${visible.length}`}</button>
      ) : null}
    </div>
  );
}
