import { and, eq, gte, inArray, isNull, lt, lte, ne } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { appointments, campaigns, contacts, tasks } from '@/db/schema';
import { formatDateTime } from '@/lib/dates';
import { type Scope, byTenant, getBusiness } from './_common';
import { contactName } from './crm';
import { queueMessage } from './comms';
import { notify } from './notifications';
import { dispatchCampaign } from './marketing';

/** Task reminders + "due now" nudges become notifications. */
export async function taskReminders(tx: Tx, scope: Scope, now = new Date()) {
  const due = await tx.select().from(tasks).where(and(
    eq(tasks.subAccountId, scope.subAccountId), inArray(tasks.status, ['todo', 'in_progress']), isNull(tasks.reminderSentAt),
    lte(tasks.reminderAt, now),
  ));
  for (const t of due) {
    await notify(tx, scope, { type: 'task.overdue', severity: t.priority === 'urgent' ? 'urgent' : 'info', title: `Reminder: ${t.title}`, link: `/tasks?t=${t.id}`, userId: t.assigneeUserId });
    await tx.update(tasks).set({ reminderSentAt: now }).where(byTenant(tasks, scope, t.id));
  }
  return due.length;
}

/**
 * Appointment reminders: SMS (or email) to the customer ~24h before, and an in-app
 * heads-up for the team 1h before. Each fires once (reminder_sent_at).
 */
export async function appointmentReminders(tx: Tx, scope: Scope, now = new Date()) {
  const b = await getBusiness(tx, scope.subAccountId);
  const soon = await tx.select({ a: appointments, c: contacts }).from(appointments)
    .leftJoin(contacts, and(eq(contacts.id, appointments.contactId), eq(contacts.subAccountId, appointments.subAccountId)))
    .where(and(
      eq(appointments.subAccountId, scope.subAccountId), ne(appointments.status, 'cancelled'), isNull(appointments.reminderSentAt),
      gte(appointments.startsAt, now), lt(appointments.startsAt, new Date(now.getTime() + 24 * 3_600_000)),
    ));
  let sent = 0;
  for (const { a, c } of soon) {
    const when = formatDateTime(a.startsAt, b.timezone);
    if (c && (c.phone || c.email)) {
      const channel = c.phone && !c.smsOptOut ? 'sms' : c.email ? 'email' : null;
      if (channel) {
        await queueMessage(tx, scope, {
          contactId: c.id, channel, subject: `Reminder: ${a.title}`,
          body: `Hi ${c.firstName || 'there'}, a reminder of your appointment with ${b.shortName && channel === 'sms' ? b.shortName : b.tradingName ?? b.name}: ${when}${a.location ? ` at ${a.location}` : ''}. Reply if you need to change it.`,
        }).catch(() => undefined);
        sent++;
      }
    }
    await notify(tx, scope, { type: 'appointment.upcoming', title: `Coming up: ${a.title}`, body: `${when}${c ? ` · ${contactName(c)}` : ''}`, link: '/calendar' });
    await tx.update(appointments).set({ reminderSentAt: now }).where(byTenant(appointments, scope, a.id));
  }
  return sent;
}

export async function dispatchDueCampaigns(tx: Tx, scope: Scope, now = new Date()) {
  const due = await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.subAccountId, scope.subAccountId), eq(campaigns.status, 'scheduled'), lte(campaigns.scheduledAt, now)));
  let n = 0;
  for (const c of due) n += await dispatchCampaign(tx, scope, c.id);
  return n;
}
