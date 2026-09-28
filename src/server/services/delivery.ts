import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { withSystem } from '@/db/context';
import { messages } from '@/db/schema';
import { env } from '@/lib/env';
import {
  LogEmailProvider, SmtpEmailProvider, SmtpUrlEmailProvider, type EmailProvider,
} from '@/lib/integrations/email';
import { LogSmsProvider, TwilioSmsProvider, type SmsProvider } from '@/lib/integrations/sms';
import { getBusiness, type Scope } from './_common';
import { getBusinessCredentials } from './integrations';
import { pgArray } from '@/db/sql';

export async function resolveEmailProvider(tx: Tx, scope: Scope): Promise<EmailProvider | null> {
  const creds = await getBusinessCredentials(tx, scope, ['smtp']);
  if (creds?.integration.provider === 'smtp') {
    return new SmtpEmailProvider({
      host: creds.config.host, port: Number(creds.config.port || 465), username: creds.config.username,
      password: creds.secrets.password, fromAddress: creds.config.fromAddress, fromName: creds.config.fromName,
    });
  }
  if (env().SMTP_URL) return new SmtpUrlEmailProvider(env().SMTP_URL!);
  if (env().NODE_ENV !== 'production') return new LogEmailProvider();
  return null;
}

export async function resolveSmsProvider(tx: Tx, scope: Scope): Promise<SmsProvider | null> {
  const creds = await getBusinessCredentials(tx, scope, ['twilio']);
  if (creds) return new TwilioSmsProvider({ accountSid: creds.config.accountSid, authToken: creds.secrets.authToken, fromNumber: creds.config.fromNumber });
  if (env().NODE_ENV !== 'production') return new LogSmsProvider();
  return null;
}

const MAX_ATTEMPTS = 4;

export function isPermanentFailure(error: string | null) {
  return !!error && /no recipient|no (email|sms) provider|not supported|invalid.*(address|number)|unsubscribed|opted out|authenticat|credentials|not a valid/i.test(error);
}

/**
 * Worker: send queued + due scheduled messages for one business. Claiming and
 * recording happen in short transactions; the network call happens between them.
 */
export async function deliverDueMessages(subAccountId: string, limit = 25): Promise<{ sent: number; failed: number }> {
  const scope: Scope = { subAccountId, userId: null, actor: 'system' };
  const prepared = await withSystem(subAccountId, async (tx) => {
    const claimed = await tx.execute<{ id: string }>(sql`
      update messages set status = 'sending'
      where id in (
        select id from messages
        where sub_account_id = ${subAccountId} and direction = 'outbound'
          and (status = 'queued' or (status = 'scheduled' and scheduled_at <= now()))
        order by created_at limit ${limit} for update skip locked
      ) returning id`);
    if (!claimed.rows.length) return null;
    const ids = claimed.rows.map((r) => r.id);
    const rows = await tx.select().from(messages).where(and(eq(messages.subAccountId, subAccountId), sql`${messages.id} = any(${pgArray(ids)})`));
    const b = await getBusiness(tx, subAccountId);
    return { rows, business: b, email: await resolveEmailProvider(tx, scope), sms: await resolveSmsProvider(tx, scope) };
  });
  if (!prepared) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  for (const m of prepared.rows) {
    let result: { provider: string; providerMessageId?: string } | null = null;
    let error: string | null = null;
    try {
      if (!m.toAddress) throw new Error('No recipient address.');
      if (m.channel === 'email') {
        if (!prepared.email) throw new Error('No email provider connected for this business.');
        result = await prepared.email.send({ to: m.toAddress, subject: m.subject ?? '(no subject)', text: m.body, fromName: prepared.business.tradingName ?? prepared.business.name, replyTo: prepared.business.email ?? undefined });
      } else if (m.channel === 'sms') {
        if (!prepared.sms) throw new Error('No SMS provider connected for this business.');
        result = await prepared.sms.send({ to: m.toAddress, body: m.body });
      } else {
        throw new Error(`Sending ${m.channel} messages is not supported yet.`);
      }
      sent++;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      failed++;
    }
    // Network/provider hiccups are retried (1, 2, 4 minutes); missing setup or a bad address is not.
    const attempts = m.attempts + 1;
    const retry = !result && attempts < MAX_ATTEMPTS && !isPermanentFailure(error);
    await withSystem(subAccountId, (tx) => tx.update(messages).set(result
      ? { status: 'sent', sentAt: new Date(), provider: result.provider, providerMessageId: result.providerMessageId ?? null, error: null, attempts }
      : retry
        ? { status: 'scheduled', scheduledAt: new Date(Date.now() + 2 ** (attempts - 1) * 60_000), error: `Retrying: ${error}`, attempts }
        : { status: 'failed', error, attempts })
      .where(and(eq(messages.subAccountId, subAccountId), eq(messages.id, m.id))));
  }
  return { sent, failed };
}
