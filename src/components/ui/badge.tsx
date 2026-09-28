import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral', sent: 'accent', viewed: 'accent', accepted: 'ok', rejected: 'danger', expired: 'warn',
  partially_paid: 'warn', paid: 'ok', overdue: 'danger', cancelled: 'neutral',
  succeeded: 'ok', failed: 'danger', pending: 'warn', refunded: 'neutral', partially_refunded: 'warn',
  new: 'accent', contacted: 'warn', qualified: 'ok', unqualified: 'neutral', converted: 'ok',
  lead: 'accent', customer: 'ok', inactive: 'neutral',
  open: 'accent', won: 'ok', lost: 'neutral',
  enquiry: 'neutral', quoted: 'accent', booked: 'accent', scheduled: 'accent', in_progress: 'warn', waiting: 'warn', completed: 'ok',
  todo: 'neutral', done: 'ok', snoozed: 'neutral',
  active: 'ok', paused: 'warn', published: 'ok',
  connected: 'ok', error: 'danger', disconnected: 'neutral',
  confirmed: 'ok', no_show: 'danger', running: 'accent', stopped: 'neutral',
  queued: 'neutral', sending: 'accent', delivered: 'ok', received: 'accent', logged: 'neutral',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'} className={className}>{status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}
