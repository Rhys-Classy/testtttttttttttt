import Link from 'next/link';
import { readScope, requireContext, businessById } from '@/server/context';
import { listNotifications } from '@/server/services/notifications';
import { markAllReadAction } from '@/server/actions/settings';
import { relativeTime } from '@/lib/dates';
import { PageHeader } from '@/components/ui/page';
import { BusinessBadge } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const ctx = await requireContext();
  const items = await readScope(ctx, (tx) => listNotifications(tx, ctx.user.id, { limit: 100 }));
  const tone = { urgent: 'bg-danger', warning: 'bg-warn', success: 'bg-ok', info: 'bg-accent' } as const;
  return (
    <div>
      <PageHeader title="Notifications" subtitle={<Link href="/settings/notifications" className="text-accent">Choose what you get notified about</Link>}
        actions={<form action={markAllReadAction}><Button type="submit" variant="secondary">Mark all read</Button></form>} />
      {items.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? '#'} className={cn('flex gap-3 px-4 py-3 hover:bg-surface-2', !n.readAt && 'bg-accent-soft/40')}>
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-border' : tone[n.severity])} />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', !n.readAt && 'font-semibold')}>{n.title}</p>
                  {n.body ? <p className="truncate text-xs text-muted">{n.body}</p> : null}
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">{!ctx.current ? <BusinessBadge business={businessById(ctx, n.subAccountId)} /> : null}{relativeTime(n.createdAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="All caught up" />}
    </div>
  );
}
