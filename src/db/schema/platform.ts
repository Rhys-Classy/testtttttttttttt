import {
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

export const sessions = pgTable('sessions', {
  id: pk(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  userAgent: text('user_agent'),
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
};

export type AccountRole = 'owner' | 'admin' | 'member';

export const accountMembers = pgTable('account_members', {
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<AccountRole>().notNull().default('member'),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.accountId, t.userId] })]);

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

export type SubAccountRole = 'admin' | 'staff' | 'viewer';

/** Access for users who are not account owners/admins (e.g. a head installer who only sees one business). */
export const subAccountMembers = pgTable('sub_account_members', {
  subAccountId: uuid('sub_account_id').notNull().references(() => subAccounts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<SubAccountRole>().notNull().default('staff'),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.subAccountId, t.userId] })]);

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
