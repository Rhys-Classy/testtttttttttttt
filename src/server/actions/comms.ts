'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { conversations } from '@/db/schema';
import { inBusiness, requireContext } from '@/server/context';
import { addInternalNote, queueMessage, updateConversation } from '@/server/services/comms';
import { createDeal, contactName, getContact } from '@/server/services/crm';
import { createTask } from '@/server/services/work';
import { snoozeUntil } from '@/server/services/work';
import { ValidationError } from '@/server/services/_common';
import { attempt, optStr, str } from './_util';

export async function sendMessageAction(fd: FormData) {
  const ctx = await requireContext();
  const subAccountId = str(fd, 'subAccountId');
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const contactId = str(fd, 'contactId');
    if (!contactId) throw new ValidationError('No recipient.');
    const when = optStr(fd, 'scheduledAt');
    const msg = await queueMessage(tx, s, {
      contactId, channel: (str(fd, 'channel') || 'sms') as 'email' | 'sms', subject: optStr(fd, 'subject'), body: str(fd, 'body'),
      conversationId: optStr(fd, 'conversationId') ?? undefined, scheduledAt: when ? new Date(when) : null,
    });
    await tx.update(conversations).set({ unread: false }).where(and(eq(conversations.subAccountId, s.subAccountId), eq(conversations.id, msg.conversationId)));
    return { conversationId: msg.conversationId };
  }), optStr(fd, 'scheduledAt') ? 'Scheduled' : 'Sent');
  revalidatePath('/inbox');
  return res;
}

export async function internalNoteAction(subAccountId: string, conversationId: string, body: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => addInternalNote(tx, s, conversationId, body)).then(() => undefined), 'Note added');
  revalidatePath('/inbox');
  return res;
}

export async function conversationAction(subAccountId: string, id: string, op: 'close' | 'reopen' | 'assign_me' | 'unassign' | 'snooze_1h' | 'snooze_tomorrow' | 'read' | 'unread') {
  const ctx = await requireContext();
  const tz = ctx.businesses.find((b) => b.id === subAccountId)?.timezone ?? ctx.tz;
  const patch = {
    close: { status: 'closed' as const, unread: false }, reopen: { status: 'open' as const }, assign_me: { assignedUserId: ctx.user.id }, unassign: { assignedUserId: null },
    snooze_1h: { status: 'snoozed' as const, snoozedUntil: snoozeUntil('1h', tz), unread: false }, snooze_tomorrow: { status: 'snoozed' as const, snoozedUntil: snoozeUntil('tomorrow', tz), unread: false },
    read: { unread: false }, unread: { unread: true },
  }[op];
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => updateConversation(tx, s, id, patch)).then(() => undefined));
  revalidatePath('/inbox');
  return res;
}

export async function conversationToTaskAction(subAccountId: string, contactId: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const c = await getContact(tx, s, contactId);
    await createTask(tx, s, { title: `Follow up ${contactName(c)}`, contactId, dueAt: new Date(), priority: 'high' });
  }), 'Task created');
  revalidatePath('/', 'layout');
  return res;
}

export async function conversationToDealAction(subAccountId: string, contactId: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    const c = await getContact(tx, s, contactId);
    await createDeal(tx, s, { title: contactName(c), contactId });
  }), 'Deal created');
  revalidatePath('/pipeline');
  return res;
}
