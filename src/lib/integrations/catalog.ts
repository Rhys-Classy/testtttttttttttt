/**
 * Every integration the platform knows about. `scope` says who owns a connection:
 *  - 'sub_account': each business connects its own (its own Stripe, its own Gmail...)
 *  - 'global': one connection for the whole master account (AI provider, storage)
 */

export type IntegrationCategory = 'payments' | 'email' | 'sms' | 'calendar' | 'social' | 'website' | 'ai' | 'storage' | 'accounting';

export type IntegrationField = {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
};

export type ProviderDef = {
  id: string;
  label: string;
  category: IntegrationCategory;
  scope: 'sub_account' | 'global';
  auth: 'api_key' | 'oauth' | 'webhook';
  description: string;
  fields: IntegrationField[];
  /** 'ready' = fully working. 'oauth_app_required' = works once OAuth client credentials are set in env. */
  status: 'ready' | 'oauth_app_required' | 'planned';
  docsUrl?: string;
};

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'stripe', label: 'Stripe', category: 'payments', scope: 'sub_account', auth: 'api_key', status: 'ready',
    description: 'Card payments, Pay Now links on invoices, refunds and receipts. Each business connects its own Stripe account.',
    fields: [
      { key: 'publishableKey', label: 'Publishable key', placeholder: 'pk_live_…' },
      { key: 'secretKey', label: 'Secret key', secret: true, required: true, placeholder: 'sk_live_… or rk_live_…', help: 'A restricted key with Checkout, Customers, PaymentIntents and Refunds access is best.' },
      { key: 'webhookSecret', label: 'Webhook signing secret', secret: true, placeholder: 'whsec_…', help: 'Create a webhook in Stripe pointing at the URL shown after connecting.' },
      { key: 'connectedAccountId', label: 'Connected account id (Stripe Connect, optional)', placeholder: 'acct_…' },
    ],
    docsUrl: 'https://docs.stripe.com/keys',
  },
  {
    id: 'smtp', label: 'Email (SMTP)', category: 'email', scope: 'sub_account', auth: 'api_key', status: 'ready',
    description: 'Send email from any mailbox (Google Workspace / Gmail app password, Microsoft 365, or a transactional provider).',
    fields: [
      { key: 'host', label: 'SMTP host', required: true, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', required: true, placeholder: '465' },
      { key: 'username', label: 'Username', required: true },
      { key: 'password', label: 'Password / app password', secret: true, required: true },
      { key: 'fromAddress', label: 'From address', required: true, placeholder: 'hello@yourbusiness.com.au' },
      { key: 'fromName', label: 'From name' },
    ],
  },
  {
    id: 'gmail', label: 'Gmail', category: 'email', scope: 'sub_account', auth: 'oauth', status: 'oauth_app_required',
    description: 'Send and receive as your Gmail / Google Workspace address. Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.',
    fields: [{ key: 'fromAddress', label: 'Mailbox' }],
  },
  {
    id: 'microsoft', label: 'Microsoft 365 / Outlook', category: 'email', scope: 'sub_account', auth: 'oauth', status: 'planned',
    description: 'Send and receive via Microsoft Graph. Until then, use SMTP with smtp.office365.com.',
    fields: [],
  },
  {
    id: 'twilio', label: 'SMS (Twilio)', category: 'sms', scope: 'sub_account', auth: 'api_key', status: 'ready',
    description: 'Two-way SMS. Inbound messages land in the inbox; STOP/START handled automatically.',
    fields: [
      { key: 'accountSid', label: 'Account SID', required: true, placeholder: 'AC…' },
      { key: 'authToken', label: 'Auth token', secret: true, required: true },
      { key: 'fromNumber', label: 'Sending number', required: true, placeholder: '+614…' },
    ],
  },
  {
    id: 'google_calendar', label: 'Google Calendar', category: 'calendar', scope: 'sub_account', auth: 'oauth', status: 'oauth_app_required',
    description: 'Push appointments to a Google calendar. Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.',
    fields: [{ key: 'calendarId', label: 'Calendar id', placeholder: 'primary' }],
  },
  {
    id: 'microsoft_calendar', label: 'Microsoft Calendar', category: 'calendar', scope: 'sub_account', auth: 'oauth', status: 'planned',
    description: 'Push appointments to Outlook via Microsoft Graph.', fields: [],
  },
  {
    id: 'facebook', label: 'Facebook Messenger + Lead Ads', category: 'social', scope: 'sub_account', auth: 'oauth', status: 'planned',
    description: 'Messenger conversations in the inbox and Lead Ads as new leads.', fields: [],
  },
  {
    id: 'instagram', label: 'Instagram DMs', category: 'social', scope: 'sub_account', auth: 'oauth', status: 'planned',
    description: 'Instagram direct messages in the inbox.', fields: [],
  },
  {
    id: 'website', label: 'Website forms (webhook)', category: 'website', scope: 'sub_account', auth: 'webhook', status: 'ready',
    description: 'Post any website form (Webflow, WordPress, GoHighLevel, Zapier) to a secret URL to create leads.',
    fields: [{ key: 'defaultSource', label: 'Lead source', placeholder: 'website' }],
  },
  {
    id: 'anthropic', label: 'AI assistant (Claude)', category: 'ai', scope: 'global', auth: 'api_key', status: 'ready',
    description: 'Powers the assistant across all businesses. One key for the whole account.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true, required: true, placeholder: 'sk-ant-…' },
      { key: 'model', label: 'Model', placeholder: 'claude-opus-5-5' },
    ],
  },
  {
    id: 's3', label: 'File storage (S3 compatible)', category: 'storage', scope: 'global', auth: 'api_key', status: 'planned',
    description: 'Store documents in S3 / R2 / Backblaze instead of local disk.', fields: [],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  payments: 'Payments', email: 'Email', sms: 'SMS', calendar: 'Calendar', social: 'Social', website: 'Website',
  ai: 'AI', storage: 'Storage', accounting: 'Accounting',
};
