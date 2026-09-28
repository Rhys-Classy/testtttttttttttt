import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { notifications, userNotificationPrefs, type NotificationSeverity } from '@/db/schema';
import type { Scope } from './_common';
import { pgArray } from '@/db/sql';

export const NOTIFICATION_TYPES: { type: string; label: string }[] = [
  { type: 'lead.created', label: 'New lead' },
  { type: 'message.received', label: 'New message' },
  { type: 'invoice.overdue', label: 'Invoice overdue' },
  { type: 'payment.received', label: 'Payment received' },
  { type: 'payment.failed', label: 'Payment failed' },
  { type: 'appointment.upcoming', label: 'Appointment coming up' },
  { type: 'task.overdue', label: 'Task overdue / reminder' },
  { type: 'quote.accepted', label: 'Quote accepted' },
  { type: 'quote.rejected', label: 'Quote declined' },
  { type: 'form.submitted', label: 'Form submitted' },
  { type: 'automation.error', label: 'Automation error' },
];

export async function notify(
  tx: Tx,
  scope: Scope,
  n: { type: string; title: string; body?: string; link?: string; severity?: NotificationSeverity; userId?: string | null },
) {
  await tx.insert(notifications).values({
    subAccountId: scope.subAccountId,
    userId: n.userId ?? null,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    severity: n.severity ?? 'info',
  });
}

/** Unread notifications for a user across the businesses visible in this context, minus muted types. */
export async function listNotifications(tx: Tx, userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const muted = await tx.select({ t: userNotificationPrefs.eventType }).from(userNotificationPrefs)
    .where(and(eq(userNotificationPrefs.userId, userId), eq(userNotificationPrefs.inApp, false)));
  const mutedTypes = muted.map((m) => m.t);
  const conds = [or(isNull(notifications.userId), eq(notifications.userId, userId))];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  if (mutedTypes.length) conds.push(sql`${notifications.type} <> all(${pgArray(mutedTypes, 'text')})`);
  return tx.select().from(notifications).where(and(...conds)).orderBy(sql`${notifications.createdAt} desc`).limit(opts.limit ?? 50);
}

export async function markNotificationsRead(tx: Tx, ids: string[] | 'all') {
  const now = new Date();
  if (ids === 'all') {
    await tx.update(notifications).set({ readAt: now }).where(isNull(notifications.readAt));
  } else if (ids.length) {
    await tx.update(notifications).set({ readAt: now }).where(sql`${notifications.id} = any(${pgArray(ids)})`);
  }
}
