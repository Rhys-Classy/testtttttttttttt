import { bigserial, boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './_shared';
import { subAccountId } from './tenant';
import { accounts, subAccounts } from './platform';

export type Channel = 'email' | 'sms' | 'call' | 'chat' | 'facebook' | 'instagram';

export const conversations = pgTable('conversations', {
  id: pk(),
  subAccountId: subAccountId(),
  contactId: uuid('contact_id'),
  channel: text('channel').$type<Channel>().notNull(),
  subject: text('subject'),
  status: text('status').$type<'open' | 'snoozed' | 'closed'>().notNull().default('open'),
  assignedUserId: uuid('assigned_user_id'),
  snoozedUntil: ts('snoozed_until'),
  unread: boolean('unread').notNull().default(true),
  lastMessageAt: ts('last_message_at'),
  lastMessagePreview: text('last_message_preview'),
  lastDirection: text('last_direction').$type<'inbound' | 'outbound'>(),
  externalThreadId: text('external_thread_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('conversations_tenant_uq').on(t.subAccountId, t.id),
  index('conversations_inbox_idx').on(t.subAccountId, t.status, t.lastMessageAt),
  index('conversations_contact_idx').on(t.subAccountId, t.contactId, t.channel),
  index('conversations_assigned_idx').on(t.subAccountId, t.assignedUserId),
]);

export type MessageStatus = 'scheduled' | 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'received' | 'logged';

export const messages = pgTable('messages', {
  id: pk(),
  subAccountId: subAccountId(),
  conversationId: uuid('conversation_id').notNull(),
  contactId: uuid('contact_id'),
  direction: text('direction').$type<'inbound' | 'outbound'>().notNull(),
  channel: text('channel').$type<Channel>().notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  bodyHtml: text('body_html'),
  fromAddress: text('from_address'),
  toAddress: text('to_address'),
  status: text('status').$type<MessageStatus>().notNull().default('queued'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  attachments: jsonb('attachments').$type<{ documentId: string; filename: string }[]>().notNull().default([]),
  /** For call records. */
  durationSeconds: integer('duration_seconds'),
  isInternalNote: boolean('is_internal_note').notNull().default(false),
  scheduledAt: ts('scheduled_at'),
  sentAt: ts('sent_at'),
  error: text('error'),
  /** Delivery attempts so far; transient failures are retried with backoff. */
  attempts: integer('attempts').notNull().default(0),
  createdByUserId: uuid('created_by_user_id'),
  campaignId: uuid('campaign_id'),
  workflowRunId: uuid('workflow_run_id'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('messages_tenant_uq').on(t.subAccountId, t.id),
  index('messages_conversation_idx').on(t.subAccountId, t.conversationId, t.createdAt),
  index('messages_scheduled_idx').on(t.status, t.scheduledAt),
]);

export const messageTemplates = pgTable('message_templates', {
  id: pk(),
  subAccountId: subAccountId(),
  channel: text('channel').$type<'email' | 'sms'>().notNull(),
  name: text('name').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  isSignature: boolean('is_signature').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('message_templates_tenant_uq').on(t.subAccountId, t.id)]);

/* ------------------------------------------------------------------ */
/* Marketing                                                           */
/* ------------------------------------------------------------------ */

export type SegmentRule =
  | { field: 'tag'; op: 'has' | 'not_has'; value: string }
  | { field: 'source'; op: 'eq' | 'neq'; value: string }
  | { field: 'status'; op: 'eq' | 'neq'; value: string }
  | { field: 'pipeline_stage'; op: 'in'; value: string }
  | { field: 'pipeline'; op: 'in'; value: string }
  | { field: 'has_paid_invoice'; op: 'eq'; value: boolean }
  | { field: 'has_overdue_invoice'; op: 'eq'; value: boolean }
  | { field: 'custom'; key: string; op: 'eq' | 'neq' | 'contains'; value: string };

export type Segment = { match: 'all' | 'any'; rules: SegmentRule[] };

export type CampaignStats = { recipients: number; sent: number; delivered: number; failed: number; opened: number; clicked: number; optedOut: number };

export const campaigns = pgTable('campaigns', {
  id: pk(),
  subAccountId: subAccountId(),
  name: text('name').notNull(),
  channel: text('channel').$type<'email' | 'sms'>().notNull(),
  status: text('status').$type<'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'>().notNull().default('draft'),
  segment: jsonb('segment').$type<Segment>().notNull().default({ match: 'all', rules: [] }),
  subject: text('subject'),
  body: text('body').notNull().default(''),
  scheduledAt: ts('scheduled_at'),
  sentAt: ts('sent_at'),
  stats: jsonb('stats').$type<CampaignStats>().notNull()
    .default({ recipients: 0, sent: 0, delivered: 0, failed: 0, opened: 0, clicked: 0, optedOut: 0 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('campaigns_tenant_uq').on(t.subAccountId, t.id)]);

export const campaignRecipients = pgTable('campaign_recipients', {
  id: pk(),
  subAccountId: subAccountId(),
  campaignId: uuid('campaign_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  messageId: uuid('message_id'),
  status: text('status').$type<'pending' | 'sent' | 'failed' | 'skipped'>().notNull().default('pending'),
  openedAt: ts('opened_at'),
  clickedAt: ts('clicked_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('campaign_recipients_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('campaign_recipients_unique').on(t.subAccountId, t.campaignId, t.contactId),
]);

export type FormFieldType =
  | 'name' | 'first_name' | 'last_name' | 'email' | 'phone' | 'address' | 'text' | 'textarea' | 'number' | 'date'
  | 'dropdown' | 'checkbox' | 'radio' | 'file' | 'custom';

export type FormField = {
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  /** For 'custom': the custom field key on the contact to write into. */
  customFieldKey?: string;
};

export type FormSettings = {
  submitLabel?: string;
  thankYouMessage?: string;
  redirectUrl?: string;
  createLead?: boolean;
  leadSource?: string;
  addTags?: string[];
  createDeal?: { pipelineId: string; stageId: string } | null;
  notify?: boolean;
};

export const forms = pgTable('forms', {
  id: pk(),
  subAccountId: subAccountId(),
  name: text('name').notNull(),
  publicId: text('public_id').notNull(),
  fields: jsonb('fields').$type<FormField[]>().notNull().default([]),
  settings: jsonb('settings').$type<FormSettings>().notNull().default({ createLead: true, notify: true }),
  status: text('status').$type<'draft' | 'published'>().notNull().default('published'),
  submissionCount: integer('submission_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('forms_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('forms_public_id_uq').on(t.publicId),
]);

export const formSubmissions = pgTable('form_submissions', {
  id: pk(),
  subAccountId: subAccountId(),
  formId: uuid('form_id').notNull(),
  contactId: uuid('contact_id'),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('form_submissions_tenant_uq').on(t.subAccountId, t.id),
  index('form_submissions_form_idx').on(t.subAccountId, t.formId, t.createdAt),
]);

export type LandingSection =
  | { id: string; type: 'hero'; heading: string; subheading?: string; buttonLabel?: string; buttonHref?: string; imageUrl?: string }
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'text'; body: string }
  | { id: string; type: 'image'; url: string; alt?: string }
  | { id: string; type: 'button'; label: string; href: string }
  | { id: string; type: 'form'; formId: string }
  | { id: string; type: 'testimonials'; items: { quote: string; name: string }[] };

export const landingPages = pgTable('landing_pages', {
  id: pk(),
  subAccountId: subAccountId(),
  name: text('name').notNull(),
  publicId: text('public_id').notNull(),
  title: text('title').notNull(),
  sections: jsonb('sections').$type<LandingSection[]>().notNull().default([]),
  style: jsonb('style').$type<{ accent?: string; background?: string; font?: 'sans' | 'serif' }>().notNull().default({}),
  published: boolean('published').notNull().default(false),
  views: integer('views').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('landing_pages_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('landing_pages_public_id_uq').on(t.publicId),
]);

/* ------------------------------------------------------------------ */
/* Automation                                                          */
/* ------------------------------------------------------------------ */

export const workflows = pgTable('workflows', {
  id: pk(),
  subAccountId: subAccountId(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').$type<'draft' | 'active' | 'paused'>().notNull().default('draft'),
  /** { type: 'lead.created', config: {...} } see src/lib/automation/types.ts */
  trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull(),
  steps: jsonb('steps').$type<unknown[]>().notNull().default([]),
  settings: jsonb('settings').$type<{ stopOnReply?: boolean; allowReentry?: boolean }>().notNull()
    .default({ stopOnReply: true, allowReentry: false }),
  runCount: integer('run_count').notNull().default(0),
  lastRunAt: ts('last_run_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('workflows_tenant_uq').on(t.subAccountId, t.id)]);

export type WorkflowRunStatus = 'running' | 'waiting' | 'completed' | 'stopped' | 'failed';

export const workflowRuns = pgTable('workflow_runs', {
  id: pk(),
  subAccountId: subAccountId(),
  workflowId: uuid('workflow_id').notNull(),
  contactId: uuid('contact_id'),
  status: text('status').$type<WorkflowRunStatus>().notNull().default('running'),
  /** The event that started the run plus any variables collected along the way. */
  context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
  /** Path of the next step to execute, e.g. [2, 'yes', 0]. */
  cursor: jsonb('cursor').$type<(number | string)[]>().notNull().default([0]),
  nextRunAt: ts('next_run_at'),
  lockedUntil: ts('locked_until'),
  log: jsonb('log').$type<{ at: string; stepId: string; type: string; ok: boolean; message?: string }[]>().notNull().default([]),
  error: text('error'),
  startedAt: createdAt(),
  finishedAt: ts('finished_at'),
}, (t) => [
  uniqueIndex('workflow_runs_tenant_uq').on(t.subAccountId, t.id),
  index('workflow_runs_due_idx').on(t.status, t.nextRunAt),
  index('workflow_runs_contact_idx').on(t.subAccountId, t.contactId, t.status),
]);

/**
 * Transactional outbox. Services insert domain events in the same transaction as the change;
 * the worker picks them up to run automations and notifications.
 */
export const events = pgTable('events', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  id: uuid('id').notNull().defaultRandom(),
  subAccountId: subAccountId(),
  type: text('type').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  contactId: uuid('contact_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  actorUserId: uuid('actor_user_id'),
  attempts: integer('attempts').notNull().default(0),
  lockedUntil: ts('locked_until'),
  processedAt: ts('processed_at'),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('events_id_uq').on(t.id),
  index('events_pending_idx').on(t.processedAt, t.seq),
]);

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'urgent';

export const notifications = pgTable('notifications', {
  id: pk(),
  subAccountId: subAccountId(),
  /** Null = everyone with access to the business. */
  userId: uuid('user_id'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  severity: text('severity').$type<NotificationSeverity>().notNull().default('info'),
  readAt: ts('read_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('notifications_tenant_uq').on(t.subAccountId, t.id),
  index('notifications_unread_idx').on(t.subAccountId, t.readAt, t.createdAt),
]);

/**
 * Append-only history. Rows are written by database triggers (entity changes)
 * and SECURITY DEFINER functions (sign-ins, explicit events); the runtime role
 * cannot update or delete them.
 */
export const auditLog = pgTable('audit_log', {
  id: pk(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  /** Null for account-level events (sign-in, roles, team). */
  subAccountId: uuid('sub_account_id').references(() => subAccounts.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id'),
  /** 'user' | 'system' | 'public' | 'api' */
  actor: text('actor').notNull().default('user'),
  /** e.g. API key name or "Customer (online)". */
  actorLabel: text('actor_label'),
  /** e.g. 'invoice.created', 'invoice.updated', 'auth.login'. */
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  /** Human label captured at the time, e.g. "INV-1042" or "John Smith". */
  entityLabel: text('entity_label'),
  /** { changed: { field: [from, to] } } for updates; secrets are never recorded. */
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  ip: text('ip'),
  createdAt: createdAt(),
}, (t) => [
  index('audit_log_entity_idx').on(t.subAccountId, t.entityType, t.entityId),
  index('audit_log_sub_account_time_idx').on(t.subAccountId, t.createdAt),
  index('audit_log_account_time_idx').on(t.accountId, t.createdAt),
]);
