/**
 * Marketing provider abstraction (ad platforms, external email marketing tools).
 * NOT IMPLEMENTED YET: campaigns currently send through each business's own email/SMS
 * providers. These entries exist so the integration settings and docs show what's planned.
 */
export interface MarketingProvider {
  readonly key: string;
  readonly label: string;
  readonly status: 'not_implemented';
  /** Push a segment of contacts to an external audience. */
  syncAudience?(audienceId: string, contacts: { email?: string | null; phone?: string | null; firstName?: string }[]): Promise<{ synced: number }>;
  /** Pull new leads (e.g. Facebook Lead Ads). */
  fetchLeads?(since: Date): Promise<{ name?: string; email?: string; phone?: string; raw: unknown }[]>;
}

export const MARKETING_PROVIDERS: MarketingProvider[] = [
  { key: 'meta_lead_ads', label: 'Facebook / Instagram Lead Ads', status: 'not_implemented' },
  { key: 'google_ads', label: 'Google Ads conversions', status: 'not_implemented' },
  { key: 'mailchimp', label: 'Mailchimp audience sync', status: 'not_implemented' },
];
