import { createTransport, type Transporter } from 'nodemailer';

export type OutboundEmail = { to: string; subject: string; text: string; html?: string; fromName?: string; replyTo?: string };
export type SendResult = { providerMessageId?: string; provider: string };

export interface EmailProvider {
  readonly id: string;
  send(msg: OutboundEmail): Promise<SendResult>;
}

export class SmtpEmailProvider implements EmailProvider {
  readonly id = 'smtp';
  private transport: Transporter;
  constructor(private cfg: { host: string; port: number; username: string; password: string; fromAddress: string; fromName?: string }) {
    this.transport = createTransport({
      host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.username, pass: cfg.password },
    });
  }
  async send(msg: OutboundEmail): Promise<SendResult> {
    const info = await this.transport.sendMail({
      from: { name: msg.fromName ?? this.cfg.fromName ?? this.cfg.fromAddress, address: this.cfg.fromAddress },
      to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, replyTo: msg.replyTo,
    });
    return { providerMessageId: info.messageId, provider: this.id };
  }
}

/** Platform-wide SMTP fallback from SMTP_URL (smtp://user:pass@host:587?from=...). */
export class SmtpUrlEmailProvider implements EmailProvider {
  readonly id = 'smtp_url';
  private transport: Transporter;
  private from: string;
  constructor(url: string) {
    const u = new URL(url);
    this.from = u.searchParams.get('from') ?? decodeURIComponent(u.username);
    u.searchParams.delete('from');
    this.transport = createTransport(u.toString());
  }
  async send(msg: OutboundEmail): Promise<SendResult> {
    const info = await this.transport.sendMail({ from: msg.fromName ? `"${msg.fromName}" <${this.from}>` : this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, replyTo: msg.replyTo });
    return { providerMessageId: info.messageId, provider: this.id };
  }
}

/** Development: records the message as sent and prints it. Never used in production. */
export class LogEmailProvider implements EmailProvider {
  readonly id = 'log';
  async send(msg: OutboundEmail): Promise<SendResult> {
    console.info(`[email:log] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
    return { provider: this.id, providerMessageId: `log-${Date.now()}` };
  }
}

/** Gmail API send using a stored OAuth refresh token. */
export class GmailEmailProvider implements EmailProvider {
  readonly id = 'gmail';
  constructor(private cfg: { accessToken: string; fromAddress: string; fromName?: string }) {}
  async send(msg: OutboundEmail): Promise<SendResult> {
    const from = msg.fromName ? `"${msg.fromName}" <${this.cfg.fromAddress}>` : this.cfg.fromAddress;
    const raw = [
      `From: ${from}`, `To: ${msg.to}`, `Subject: ${encodeHeader(msg.subject)}`, 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', msg.text,
    ].join('\r\n');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }),
    });
    if (!res.ok) throw new Error(`Gmail send failed (${res.status})`);
    const data = (await res.json()) as { id?: string };
    return { provider: this.id, providerMessageId: data.id };
  }
}

function encodeHeader(v: string) {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`;
}
