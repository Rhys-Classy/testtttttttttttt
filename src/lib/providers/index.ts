/**
 * One place to see every provider abstraction and what implements it.
 * Credentials always come from the business's (or the account's) encrypted
 * integration row on the server; nothing here is ever sent to the browser.
 *
 *   Payment    → Stripe (implemented)
 *   Email      → SMTP / SMTP URL / Gmail API (implemented; Gmail OAuth flow not yet), Log (development)
 *   SMS        → Twilio (implemented), Log (development)
 *   Calendar   → ICS feed (implemented); Google / Microsoft two-way sync (not implemented)
 *   Marketing  → interface only (not implemented)
 *   AI         → Anthropic Claude (implemented)
 */
export type { PaymentProvider, CheckoutInput } from './payment';
export { stripePaymentProvider } from './payment';
export type { EmailProvider, OutboundEmail, SendResult } from '@/lib/integrations/email';
export { SmtpEmailProvider, SmtpUrlEmailProvider, GmailEmailProvider, LogEmailProvider } from '@/lib/integrations/email';
export type { SmsProvider as SMSProvider, OutboundSms } from '@/lib/integrations/sms';
export { TwilioSmsProvider, LogSmsProvider } from '@/lib/integrations/sms';
export type { CalendarProvider, CalendarEvent } from './calendar';
export { icsCalendarProvider, googleCalendarProvider, microsoftCalendarProvider } from './calendar';
export type { MarketingProvider } from './marketing';
export { MARKETING_PROVIDERS } from './marketing';
export type { AIProvider } from './ai';
export { AnthropicAIProvider } from './ai';
