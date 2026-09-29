/**
 * Turns raw audit rows (written by database triggers and sign-in functions)
 * into sentences a person can read: "Sent invoice INV-1042", "Gave Sam the Staff role".
 */
export type AuditRow = {
  action: string;
  entityType: string | null;
  entityLabel: string | null;
  actor: string;
  actorLabel: string | null;
  actorName: string | null;
  data: Record<string, unknown>;
};

const ENTITY_WORDS: Record<string, string> = {
  contact: 'customer', invoice: 'invoice', quote: 'quote', payment: 'payment', product: 'product', automation: 'automation',
  integration: 'integration', api_key: 'API key', role: 'role', account_member: 'person', business_member: 'access', business: 'business', user: 'account',
};

const PROVIDER_NAMES: Record<string, string> = { stripe: 'Stripe', smtp: 'Email (SMTP)', twilio: 'SMS (Twilio)', anthropic: 'AI assistant', website: 'Website forms', google_ads_leads: 'Google Ads lead forms', google: 'Google' };

const AUTH: Record<string, string> = {
  'auth.login': 'Logged in',
  'auth.logout': 'Logged out',
  'auth.login_failed': 'Failed login attempt (wrong password)',
  'auth.mfa_failed': 'Failed two-step verification code',
  'auth.mfa_enabled': 'Turned on two-step verification',
  'auth.mfa_disabled': 'Turned off two-step verification',
  'auth.password_changed': 'Changed their password',
  'auth.session_revoked': 'Signed out another device',
  'auth.recovery_code_used': 'Logged in with a recovery code',
  'auth.recovery_codes_regenerated': 'Created new recovery codes',
};

/** Friendly field names for "Updated John Smith: email, phone". */
function fieldName(key: string) {
  const special: Record<string, string> = {
    first_name: 'first name', last_name: 'last name', total_cents: 'total', subtotal_cents: 'subtotal', tax_cents: 'GST', amount_paid_cents: 'amount paid',
    price_cents: 'price', cost_cents: 'cost', refunded_cents: 'refunded', due_date: 'due date', issue_date: 'issue date', expiry_date: 'expiry date',
    owner_user_id: 'owner', assigned_user_id: 'assignee', company_id: 'company', custom_fields: 'custom fields', enabled_modules: 'modules',
    prices_include_tax: 'GST inclusive', tax_code: 'tax code', data_scope: 'record access', all_businesses_role_id: 'all-businesses role',
    role_id: 'role', secrets_encrypted: 'credentials', credentials: 'credentials', email_opt_out: 'email opt-out', sms_opt_out: 'SMS opt-out',
    accepted_by_name: 'accepted by', rejection_reason: 'decline reason', archived_at: 'archived', revoked_at: 'revoked',
  };
  return special[key] ?? key.replace(/_at$/, '').replace(/_id$/, '').replace(/_/g, ' ');
}

function money(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${(n / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v);
}

/** "status: draft → sent", money formatted, long values trimmed. */
export function describeChange(key: string, pair: unknown): string {
  const [from, to] = Array.isArray(pair) ? pair : [null, pair];
  const fmt = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (key.endsWith('_cents')) return money(v);
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    const s = String(v);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  };
  if (to === '(changed)' || to === '(updated)') return `${fieldName(key)} changed`;
  return `${fieldName(key)}: ${fmt(from)} → ${fmt(to)}`;
}

export function auditActor(row: Pick<AuditRow, 'actor' | 'actorLabel' | 'actorName'>): string {
  if (row.actor === 'api') return `API key${row.actorLabel ? ` “${row.actorLabel}”` : ''}`;
  if (row.actor === 'public') return row.actorLabel ?? 'Customer (online)';
  if (row.actorName) return row.actorName;
  if (row.actor === 'system') return row.actorLabel ?? 'Automation / system';
  return row.actorLabel ?? 'Someone';
}

export function auditSentence(row: AuditRow): string {
  if (AUTH[row.action]) return AUTH[row.action];
  const [entity, verb] = row.action.split('.');
  const word = ENTITY_WORDS[entity] ?? entity.replace(/_/g, ' ');
  const label = row.entityLabel ?? '';
  const changed = (row.data?.changed ?? {}) as Record<string, unknown>;
  const changedKeys = Object.keys(changed).filter((k) => k !== 'role' && k !== 'total');
  const roleName = typeof changed.role === 'string' ? changed.role : null;

  switch (entity) {
    case 'account_member':
      if (verb === 'created') return `Added ${label} to the account${roleName ? ` as ${roleName} in every business` : ''}`;
      if (verb === 'deleted') return `Removed ${label} from the account`;
      return `Changed ${label}’s all-businesses role${roleName ? ` to ${roleName}` : ''}`;
    case 'business_member':
      if (verb === 'created') return `Gave ${label} the ${roleName ?? ''} role`.replace('  ', ' ');
      if (verb === 'deleted') return `Removed ${label}’s access`;
      return `Changed ${label}’s role${roleName ? ` to ${roleName}` : ''}`;
    case 'integration': {
      const name = PROVIDER_NAMES[label] ?? label;
      if (verb === 'created' || verb === 'connected') return `Connected ${name}`;
      if (verb === 'disconnected' || verb === 'deleted') return `Disconnected ${name}`;
      if (verb === 'error') return `${name} reported a problem`;
      return `Updated ${name} settings`;
    }
    case 'api_key':
      if (changed.revoked_at) return `Revoked API key “${label}”`;
      if (verb === 'created') return `Created API key “${label}”`;
      return `Updated API key “${label}”`;
    case 'role':
      if (verb === 'created') return `Created role ${label}`;
      if (verb === 'deleted') return `Deleted role ${label}`;
      return `Changed what the ${label} role can do`;
    case 'invoice': {
      const map: Record<string, string> = {
        created: `Created invoice ${label}${changed.total ? ` (${changed.total})` : ''}`, sent: `Sent invoice ${label}`, viewed: `Customer opened invoice ${label}`,
        paid: `Invoice ${label} paid in full`, partially_paid: `Part payment on invoice ${label}`, overdue: `Invoice ${label} became overdue`,
        cancelled: `Cancelled invoice ${label}`, cancel: `Cancelled invoice ${label}`, draft: `Invoice ${label} moved back to draft`, deleted: `Deleted invoice ${label}`,
      };
      return map[verb] ?? `Changed invoice ${label}`;
    }
    case 'quote': {
      const who = typeof (changed.accepted_by_name as unknown[] | undefined)?.[1] === 'string' ? ` by ${(changed.accepted_by_name as string[])[1]}` : '';
      const map: Record<string, string> = {
        created: `Created quote ${label}${changed.total ? ` (${changed.total})` : ''}`, sent: `Sent quote ${label}`, viewed: `Customer opened quote ${label}`,
        accepted: `Quote ${label} accepted${who}`, accept: `Quote ${label} accepted`.replace('  ', ' '), rejected: `Quote ${label} declined`, expired: `Quote ${label} expired`, deleted: `Deleted quote ${label}`,
      };
      return map[verb] ?? `Changed quote ${label}`;
    }
    case 'payment': {
      const map: Record<string, string> = {
        created: `Payment of ${label.trim()} recorded`, succeeded: `Payment of ${label.trim()} succeeded`, failed: `Payment of ${label.trim()} failed`,
        refunded: `Refunded payment of ${label.trim()}`, refund: `Refunded a payment`, partially_refunded: `Part-refunded payment of ${label.trim()}`, pending: `Payment of ${label.trim()} pending`,
      };
      return map[verb] ?? `Changed payment of ${label.trim()}`;
    }
    case 'automation': {
      const map: Record<string, string> = { created: `Created automation “${label}”`, active: `Switched on automation “${label}”`, paused: `Paused automation “${label}”`, draft: `Automation “${label}” back to draft`, deleted: `Deleted automation “${label}”` };
      return map[verb] ?? `Edited automation “${label}”`;
    }
  }
  if (verb === 'created') return `Added ${word} ${label}`.trim();
  if (verb === 'deleted') return `Deleted ${word} ${label}`.trim();
  if (verb === 'archived') return `Archived ${word} ${label}`.trim();
  if (verb === 'restored') return `Restored ${word} ${label}`.trim();
  if (verb === 'updated') return `Updated ${label || word}${changedKeys.length ? `: ${changedKeys.map(fieldName).join(', ')}` : ''}`;
  return `${label || word}: ${verb.replace(/_/g, ' ')}`;
}

/** Extra detail lines for an update: "email: a@x → b@x". */
export function auditDetails(row: Pick<AuditRow, 'data'>): string[] {
  const changed = (row.data?.changed ?? {}) as Record<string, unknown>;
  return Object.entries(changed).filter(([k]) => k !== 'role' && k !== 'total').map(([k, v]) => describeChange(k, v));
}

export const AUDIT_FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'auth', label: 'Sign-ins' },
  { value: 'contact', label: 'Customers' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'quote', label: 'Quotes' },
  { value: 'payment', label: 'Payments & refunds' },
  { value: 'automation', label: 'Automations' },
  { value: 'integration', label: 'Integrations & API keys' },
  { value: 'access', label: 'Team & permissions' },
  { value: 'business', label: 'Business settings' },
] as const;
