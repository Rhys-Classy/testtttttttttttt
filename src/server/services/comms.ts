import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { contacts, conversations, messages, type Channel } from '@/db/schema';
import { Scope, ValidationError, byTenant, cleanStr, emit, logActivity, must } from './_common';
import { contactName, findContactByIdentity, createContact, touchContact } from './crm';
import { notify } from './notifications';

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;
const OPT_IN = /^\s*(start|unstop|subscribe)\s*$/i;

export async function getOrCreateConversation(tx: Tx, scope: Scope, contactId: string | null, channel: Channel, subject?: string | null) {
  if (contactId) {
    const [existing] = await tx.select().from(conversations).where(and(
      eq(conversations.subAccountId, scope.subAccountId), eq(conversations.contactId, contactId), eq(conversations.channel, channel),
    )).orderBy(desc(conversations.lastMessageAt)).limit(1);
    if (existing) return existing;
  }
  const [row] = await tx.insert(conversations).values({
    subAccountId: scope.subAccountId, contactId, channel, subject: cleanStr(subject), unread: false,
  }).returning();
  return row;
}

/**
 * Queue an outbound email/SMS. Delivery happens in the worker (never inside the DB
 * transaction), so a slow provider can't hold locks or roll back business changes.
 */
export async function queueMessage(tx: Tx, scope: Scope, input: {
  contactId: string;
  channel: 'email' | 'sms';
  subject?: string | null;
  body: string;
  scheduledAt?: Date | null;
  conversationId?: string;
  campaignId?: string | null;
  workflowRunId?: string | null;
}): Promise<Message> {
  const body = cleanStr(input.body);
  if (!body) throw new ValidationError('Message is empty.');
  const [contact] = await tx.select().from(contacts).where(byTenant(contacts, scope, input.contactId));
  must(contact, 'Contact');
  const to = input.channel === 'email' ? contact.email : contact.phone;
  if (!to) throw new ValidationError(`${contactName(contact)} has no ${input.channel === 'email' ? 'email address' : 'mobile number'}.`);
  const optedOut = input.channel === 'email' ? contact.emailOptOut : contact.smsOptOut;
  const conversation = input.conversationId
    ? must((await tx.select().from(conversations).where(byTenant(conversations, scope, input.conversationId)))[0], 'Conversation')
    : await getOrCreateConversation(tx, scope, contact.id, input.channel, input.subject);
  const scheduled = input.scheduledAt && input.scheduledAt.getTime() > Date.now() + 30_000;
  const [msg] = await tx.insert(messages).values({
    subAccountId: scope.subAccountId,
    conversationId: conversation.id,
    contactId: contact.id,
    direction: 'outbound',
    channel: input.channel,
    subject: cleanStr(input.subject),
    body,
    toAddress: to,
    status: optedOut ? 'failed' : scheduled ? 'scheduled' : 'queued',
    error: optedOut ? 'Contact has opted out' : null,
    scheduledAt: scheduled ? input.scheduledAt : null,
    createdByUserId: scope.userId,
    campaignId: input.campaignId ?? null,
    workflowRunId: input.workflowRunId ?? null,
  }).returning();
  await tx.update(conversations).set({
    lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 160), lastDirection: 'outbound', updatedAt: new Date(),
    status: conversation.status === 'closed' ? 'closed' : 'open',
  }).where(byTenant(conversations, scope, conversation.id));
  if (!optedOut) await touchContact(tx, scope, contact.id);
  await logActivity(tx, scope, { contactId: contact.id, entityType: 'message', entityId: msg.id, type: input.channel, summary: `${input.channel === 'email' ? 'Email' : 'SMS'} ${scheduled ? 'scheduled' : 'sent'}: ${input.subject ?? body.slice(0, 80)}` });
  return msg;
}

/** Log a phone call or other offline touchpoint in the thread. */
export async function logCall(tx: Tx, scope: Scope, input: { contactId: string; direction: 'inbound' | 'outbound'; summary: string; durationSeconds?: number }) {
  const conversation = await getOrCreateConversation(tx, scope, input.contactId, 'call');
  const [msg] = await tx.insert(messages).values({
    subAccountId: scope.subAccountId, conversationId: conversation.id, contactId: input.contactId,
    direction: input.direction, channel: 'call', body: input.summary, status: 'logged',
    durationSeconds: input.durationSeconds ?? null, createdByUserId: scope.userId, sentAt: new Date(),
  }).returning();
  await tx.update(conversations).set({ lastMessageAt: new Date(), lastMessagePreview: `Call: ${input.summary.slice(0, 140)}`, lastDirection: input.direction })
    .where(byTenant(conversations, scope, conversation.id));
  await touchContact(tx, scope, input.contactId);
  await logActivity(tx, scope, { contactId: input.contactId, entityType: 'message', entityId: msg.id, type: 'call', summary: `Call: ${input.summary.slice(0, 120)}` });
  return msg;
}

export async function addInternalNote(tx: Tx, scope: Scope, conversationId: string, body: string) {
  const [conv] = await tx.select().from(conversations).where(byTenant(conversations, scope, conversationId));
  must(conv, 'Conversation');
  const [msg] = await tx.insert(messages).values({
    subAccountId: scope.subAccountId, conversationId, contactId: conv.contactId, direction: 'outbound',
    channel: conv.channel, body, status: 'logged', isInternalNote: true, createdByUserId: scope.userId,
  }).returning();
  return msg;
}

/**
 * Inbound message from any provider. Matches (or creates) the contact inside this
 * business, handles STOP/START opt-out for SMS, emits message.received.
 */
export async function recordInbound(tx: Tx, scope: Scope, input: {
  channel: Channel;
  from: string;
  to?: string | null;
  body: string;
  subject?: string | null;
  fromName?: string | null;
  provider?: string;
  providerMessageId?: string | null;
  externalThreadId?: string | null;
}) {
  if (input.providerMessageId) {
    const [dupe] = await tx.select({ id: messages.id }).from(messages).where(and(
      eq(messages.subAccountId, scope.subAccountId), eq(messages.providerMessageId, input.providerMessageId),
    )).limit(1);
    if (dupe) return { duplicate: true as const };
  }
  const identity = input.channel === 'email' ? { email: input.from } : { phone: input.from };
  let contact = await findContactByIdentity(tx, scope, identity);
  if (!contact) {
    contact = await createContact(tx, scope, {
      name: input.fromName ?? undefined,
      ...identity,
      source: input.channel === 'sms' ? 'sms' : input.channel === 'facebook' ? 'facebook' : input.channel === 'instagram' ? 'instagram' : 'other',
    });
  }
  if (input.channel === 'sms') {
    if (OPT_OUT.test(input.body)) await tx.update(contacts).set({ smsOptOut: true }).where(byTenant(contacts, scope, contact.id));
    else if (OPT_IN.test(input.body)) await tx.update(contacts).set({ smsOptOut: false }).where(byTenant(contacts, scope, contact.id));
  }
  const conversation = await getOrCreateConversation(tx, scope, contact.id, input.channel, input.subject);
  const [msg] = await tx.insert(messages).values({
    subAccountId: scope.subAccountId, conversationId: conversation.id, contactId: contact.id, direction: 'inbound',
    channel: input.channel, subject: cleanStr(input.subject), body: input.body, fromAddress: input.from, toAddress: input.to ?? null,
    status: 'received', provider: input.provider ?? null, providerMessageId: input.providerMessageId ?? null, sentAt: new Date(),
  }).returning();
  await tx.update(conversations).set({
    status: 'open', unread: true, snoozedUntil: null, lastMessageAt: new Date(), lastMessagePreview: input.body.slice(0, 160),
    lastDirection: 'inbound', externalThreadId: input.externalThreadId ?? conversation.externalThreadId, updatedAt: new Date(),
  }).where(byTenant(conversations, scope, conversation.id));
  await touchContact(tx, scope, contact.id);
  await logActivity(tx, scope, { contactId: contact.id, entityType: 'message', entityId: msg.id, type: input.channel, summary: `Received ${input.channel}: ${input.body.slice(0, 100)}` });
  await emit(tx, scope, 'message.received', { entityType: 'message', entityId: msg.id, contactId: contact.id, payload: { channel: input.channel, body: input.body.slice(0, 500) } });
  await notify(tx, scope, { type: 'message.received', title: `New ${input.channel === 'sms' ? 'SMS' : input.channel} from ${contactName(contact)}`, body: input.body.slice(0, 140), link: `/inbox?c=${conversation.id}` });
  return { duplicate: false as const, message: msg, contact, conversation };
}

export async function updateConversation(tx: Tx, scope: Scope, id: string, patch: Partial<Pick<Conversation, 'status' | 'assignedUserId' | 'snoozedUntil' | 'unread'>>) {
  const [row] = await tx.update(conversations).set({ ...patch, updatedAt: new Date() }).where(byTenant(conversations, scope, id)).returning();
  return must(row, 'Conversation');
}
