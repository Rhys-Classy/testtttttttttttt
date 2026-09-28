export type OutboundSms = { to: string; body: string };

export interface SmsProvider {
  readonly id: string;
  send(msg: OutboundSms): Promise<{ provider: string; providerMessageId?: string }>;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly id = 'twilio';
  constructor(private cfg: { accountSid: string; authToken: string; fromNumber: string }) {}
  async send(msg: OutboundSms) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: msg.to, From: this.cfg.fromNumber, Body: msg.body }),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) throw new Error(data.message ?? `Twilio error ${res.status}`);
    return { provider: this.id, providerMessageId: data.sid };
  }
}

export class LogSmsProvider implements SmsProvider {
  readonly id = 'log';
  async send(msg: OutboundSms) {
    console.info(`[sms:log] to=${msg.to} body=${JSON.stringify(msg.body.slice(0, 60))}`);
    return { provider: this.id, providerMessageId: `log-${Date.now()}` };
  }
}

/** Twilio request validation: HMAC-SHA1 over URL + sorted params. */
export async function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null) {
  if (!signature) return false;
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
