import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { Address, createdAt, pk, ts, updatedAt } from './_shared';

/* ------------------------------------------------------------------ */
/* Users, sessions, master accounts                                    */
/* ------------------------------------------------------------------ */

export const users = pgTable('users', {
  id: pk(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').notNull().default('Australia/Melbourne'),
  /** TOTP secret, AES-256-GCM encrypted. The runtime role cannot SELECT this column. */
  mfaSecretEncrypted: text('mfa_secret_encrypted'),
  mfaEnabledAt: ts('mfa_enabled_at'),
  /** Last accepted TOTP time step: stops a code being replayed. */
  mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
  /** sha256 of unused one-time recovery codes. */
  mfaRecoveryHashes: text('mfa_recovery_hashes').array().notNull().default([]),
  passwordChangedAt: ts('password_changed_at'),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

/** Columns the runtime role may read on `users` (secrets are read via SECURITY DEFINER functions only). */
export const publicUserColumns = {
  id: users.id, email: users.email, name: users.name, timezone: users.timezone,
  mfaEnabledAt: users.mfaEnabledAt, lastLoginAt: users.lastLoginAt, passwordChangedAt: users.passwordChangedAt,
  createdAt: users.createdAt,
} as const;

export const sessions = pgTable('sessions', {
  id: pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  /** Sliding idle timeout: sessions unused for longer than the account's idle limit are rejected. */
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('sessions_token_hash_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]);

/** The master account. One login sees every business under it. */
export const accounts = pgTable('accounts', {
  id: pk(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
  settings: jsonb('settings').$type<AccountSettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type AccountSettings = {
  defaultTimezone?: string;
  aiEnabled?: boolean;
  /** Everyone must set up two-step verification before using the app. */
  requireMfa?: boolean;
  /** Sign out after this many minutes without activity (default 7 days). */
  sessionIdleMinutes?: number;
};

/**
 * Roles are per master account: five starting roles (Admin, Manager, Staff,
 * Accountant, Viewer) plus any the owner adds. Permissions are editable.
 * The account owner is not a role: owners always have full access.
 */
export const roles = pgTable('roles', {
  id: pk(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  /** Set for the starting roles ('admin', 'manager', 'staff', 'accountant', 'viewer'); null for custom roles. */
  key: text('key'),
  name: text('name').notNull(),
  description: text('description'),
  permissions: text('permissions').array().notNull().default([]),
  /** 'assigned' = only customers/jobs/tasks/appointments assigned to the person. */
  dataScope: text('data_scope').$type<'all' | 'assigned'>().notNull().default('all'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('roles_account_name_uq').on(t.accountId, t.name),
  uniqueIndex('roles_account_key_uq').on(t.accountId, t.key),
  uniqueIndex('roles_account_id_uq').on(t.accountId, t.id),
]);

export type AccountRole = 'owner' | 'member';

export const accountMembers = pgTable('account_members', {
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'owner' = full access to every business. 'member' = access comes from roles. */
  role: text('role').$type<AccountRole>().notNull().default('member'),
  /** Optional: this role in EVERY business of the account, including ones added later. */
  allBusinessesRoleId: uuid('all_businesses_role_id').references((): AnyPgColumn => roles.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.accountId, t.userId] }), index('account_members_user_idx').on(t.userId)]);

/* ------------------------------------------------------------------ */
/* Sub-accounts (businesses)                                           */
/* ------------------------------------------------------------------ */

export type SubAccountBranding = {
  primaryColor?: string;
  logoUrl?: string;
  invoiceAccent?: string;
  quoteAccent?: string;
  invoiceFooter?: string;
  quoteFooter?: string;
};

/** Per-business words for things, e.g. { contact: 'Client' } for a support provider. */
export type Terminology = Partial<Record<'contact' | 'contacts' | 'deal' | 'deals' | 'job' | 'jobs', string>>;

export const subAccounts = pgTable('sub_accounts', {
  id: pk(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  shortName: text('short_name'),
  color: text('color').notNull().default('#4f46e5'),
  tradingName: text('trading_name'),
  legalName: text('legal_name'),
  abn: text('abn'),
  acn: text('acn'),
  address: jsonb('address').$type<Address>().notNull().default({}),
  phone: text('phone'),
  email: text('email'),
  website: text('website'),
  branding: jsonb('branding').$type<SubAccountBranding>().notNull().default({}),
  terminology: jsonb('terminology').$type<Terminology>().notNull().default({}),
  // Regional + tax configuration
  region: text('region').notNull().default('AU'),
  currency: text('currency').notNull().default('AUD'),
  timezone: text('timezone').notNull().default('Australia/Melbourne'),
  locale: text('locale').notNull().default('en-AU'),
  taxRegime: text('tax_regime').notNull().default('AU_GST'),
  taxRegistered: boolean('tax_registered').notNull().default(true),
  pricesIncludeTax: boolean('prices_include_tax').notNull().default(false),
  // Numbering + terms
  invoicePrefix: text('invoice_prefix').notNull().default('INV-'),
  nextInvoiceNumber: integer('next_invoice_number').notNull().default(1001),
  quotePrefix: text('quote_prefix').notNull().default('Q-'),
  nextQuoteNumber: integer('next_quote_number').notNull().default(1001),
  jobPrefix: text('job_prefix').notNull().default('JOB-'),
  nextJobNumber: integer('next_job_number').notNull().default(1001),
  orderPrefix: text('order_prefix').notNull().default('ORD-'),
  nextOrderNumber: integer('next_order_number').notNull().default(1001),
  paymentTermsDays: integer('payment_terms_days').notNull().default(14),
  quoteValidityDays: integer('quote_validity_days').notNull().default(30),
  invoiceTerms: text('invoice_terms'),
  quoteTerms: text('quote_terms'),
  bankDetails: text('bank_details'),
  enabledModules: text('enabled_modules').array().notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: ts('archived_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('sub_accounts_account_slug_uq').on(t.accountId, t.slug),
  index('sub_accounts_account_idx').on(t.accountId),
]);

/**
 * A person's role in ONE business (e.g. a head installer who is Staff in
 * Classy Kitchen Facelifts only). Overrides an all-businesses role for that business.
 */
export const subAccountMembers = pgTable('sub_account_members', {
  subAccountId: uuid('sub_account_id').notNull().references(() => subAccounts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.subAccountId, t.userId] }), index('sub_account_members_user_idx').on(t.userId)]);

/**
 * API keys for the REST API (/api/v1). Each key belongs to ONE business and
 * carries its own permission list. Only a sha256 of the key is stored.
 */
export const apiKeys = pgTable('api_keys', {
  id: pk(),
  subAccountId: uuid('sub_account_id').notNull().references(() => subAccounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** First characters of the key, shown so people can tell keys apart. */
  prefix: text('prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  permissions: text('permissions').array().notNull().default([]),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  lastUsedAt: ts('last_used_at'),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('api_keys_hash_uq').on(t.keyHash), index('api_keys_sub_account_idx').on(t.subAccountId)]);

/* ------------------------------------------------------------------ */
/* Integrations: Master Account -> (optional) Sub Account -> Integration */
/* ------------------------------------------------------------------ */

export type IntegrationScope = 'global' | 'sub_account';
export type IntegrationStatus = 'connected' | 'error' | 'disconnected' | 'pending';

export const integrations = pgTable('integrations', {
  id: pk(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  /** 'global' = used platform-wide (AI provider, storage). 'sub_account' = owned by exactly one business. */
  scope: text('scope').$type<IntegrationScope>().notNull(),
  /** Required when scope = 'sub_account', must be null when scope = 'global' (DB check constraint). */
  subAccountId: uuid('sub_account_id').references(() => subAccounts.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  label: text('label'),
  status: text('status').$type<IntegrationStatus>().notNull().default('pending'),
  /** Non-secret configuration, safe to show in the UI (account ids, from address, calendar id...). */
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  /** AES-256-GCM encrypted JSON blob of secrets. Never sent to the browser. */
  secretsEncrypted: text('secrets_encrypted'),
  lastError: text('last_error'),
  connectedAt: ts('connected_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('integrations_sub_account_idx').on(t.subAccountId),
  index('integrations_account_idx').on(t.accountId),
]);

/* ------------------------------------------------------------------ */
/* Per-user preferences                                                */
/* ------------------------------------------------------------------ */

export const userNotificationPrefs = pgTable('user_notification_prefs', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  inApp: boolean('in_app').notNull().default(true),
  email: boolean('email').notNull().default(false),
  sms: boolean('sms').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.userId, t.eventType] })]);
