/**
 * Tiny, safe template renderer for emails/SMS: {{contact.first_name}}, {{invoice.total}}.
 * No code execution, unknown keys render as empty strings (or a fallback: {{contact.first_name|there}}).
 */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)(?:\|([^}]*))?\s*\}\}/g, (_, path: string, fallback?: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), vars);
    if (value === undefined || value === null || value === '') return fallback?.trim() ?? '';
    return String(value);
  });
}

export const TEMPLATE_VARIABLES = [
  'contact.first_name', 'contact.last_name', 'contact.name', 'contact.email', 'contact.phone',
  'business.name', 'business.phone', 'business.email', 'business.website',
  'invoice.number', 'invoice.total', 'invoice.balance', 'invoice.due_date', 'invoice.link',
  'quote.number', 'quote.total', 'quote.link',
  'appointment.title', 'appointment.when',
];
