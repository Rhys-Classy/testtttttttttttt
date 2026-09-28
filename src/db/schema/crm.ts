import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { Address, cents, createdAt, customFields, pk, tags, ts, updatedAt } from './_shared';
import { subAccountId } from './tenant';

export type ContactStatus = 'lead' | 'customer' | 'inactive';
export type LeadSource =
  | 'website' | 'facebook' | 'instagram' | 'google' | 'referral' | 'manual' | 'phone' | 'sms' | 'other';

export const companies = pgTable('companies', {
  id: pk(),
  subAccountId: subAccountId(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  website: text('website'),
  abn: text('abn'),
  address: jsonb('address').$type<Address>().notNull().default({}),
  tags: tags(),
  customFields: customFields(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: ts('archived_at'),
}, (t) => [
  uniqueIndex('companies_tenant_uq').on(t.subAccountId, t.id),
  index('companies_name_idx').on(t.subAccountId, t.name),
]);

export const contacts = pgTable('contacts', {
  id: pk(),
  subAccountId: subAccountId(),
  companyId: uuid('company_id'),
  jobTitle: text('job_title'),
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull().default(''),
  email: text('email'),
  phone: text('phone'),
  address: jsonb('address').$type<Address>().notNull().default({}),
  website: text('website'),
  tags: tags(),
  source: text('source').$type<LeadSource>(),
  ownerUserId: uuid('owner_user_id'),
  status: text('status').$type<ContactStatus>().notNull().default('lead'),
  leadScore: integer('lead_score').notNull().default(0),
  lastContactedAt: ts('last_contacted_at'),
  nextContactAt: ts('next_contact_at'),
  emailOptOut: boolean('email_opt_out').notNull().default(false),
  smsOptOut: boolean('sms_opt_out').notNull().default(false),
  stripeCustomerId: text('stripe_customer_id'),
  customFields: customFields(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: ts('archived_at'),
}, (t) => [
  uniqueIndex('contacts_tenant_uq').on(t.subAccountId, t.id),
  index('contacts_email_idx').on(t.subAccountId, t.email),
  index('contacts_phone_idx').on(t.subAccountId, t.phone),
  index('contacts_company_idx').on(t.subAccountId, t.companyId),
  index('contacts_owner_idx').on(t.subAccountId, t.ownerUserId),
]);

/** Notes can hang off any record (contact, deal, job, invoice...). */
export const notes = pgTable('notes', {
  id: pk(),
  subAccountId: subAccountId(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  contactId: uuid('contact_id'),
  body: text('body').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  authorUserId: uuid('author_user_id'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('notes_tenant_uq').on(t.subAccountId, t.id),
  index('notes_entity_idx').on(t.subAccountId, t.entityType, t.entityId),
  index('notes_contact_idx').on(t.subAccountId, t.contactId),
]);

/** Timeline of everything that happened to a contact/record. Written by services, never edited. */
export const activities = pgTable('activities', {
  id: pk(),
  subAccountId: subAccountId(),
  contactId: uuid('contact_id'),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  type: text('type').notNull(),
  summary: text('summary').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  actorUserId: uuid('actor_user_id'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('activities_tenant_uq').on(t.subAccountId, t.id),
  index('activities_contact_idx').on(t.subAccountId, t.contactId, t.createdAt),
  index('activities_entity_idx').on(t.subAccountId, t.entityType, t.entityId),
]);

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';

export const leads = pgTable('leads', {
  id: pk(),
  subAccountId: subAccountId(),
  contactId: uuid('contact_id').notNull(),
  title: text('title'),
  source: text('source').$type<LeadSource>().notNull().default('manual'),
  status: text('status').$type<LeadStatus>().notNull().default('new'),
  assignedUserId: uuid('assigned_user_id'),
  valueCents: cents('value_cents').notNull().default(0),
  probability: integer('probability').notNull().default(10),
  lastContactedAt: ts('last_contacted_at'),
  nextAction: text('next_action'),
  nextActionAt: ts('next_action_at'),
  notes: text('notes'),
  dealId: uuid('deal_id'),
  formSubmissionId: uuid('form_submission_id'),
  customFields: customFields(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('leads_tenant_uq').on(t.subAccountId, t.id),
  index('leads_status_idx').on(t.subAccountId, t.status),
  index('leads_contact_idx').on(t.subAccountId, t.contactId),
  index('leads_assigned_idx').on(t.subAccountId, t.assignedUserId),
]);

export const pipelines = pgTable('pipelines', {
  id: pk(),
  subAccountId: subAccountId(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('pipelines_tenant_uq').on(t.subAccountId, t.id)]);

export type StageKind = 'open' | 'won' | 'lost';

export const pipelineStages = pgTable('pipeline_stages', {
  id: pk(),
  subAccountId: subAccountId(),
  pipelineId: uuid('pipeline_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<StageKind>().notNull().default('open'),
  probability: integer('probability').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [
  uniqueIndex('pipeline_stages_tenant_uq').on(t.subAccountId, t.id),
  index('pipeline_stages_pipeline_idx').on(t.subAccountId, t.pipelineId, t.sortOrder),
]);

export type DealStatus = 'open' | 'won' | 'lost';

export const deals = pgTable('deals', {
  id: pk(),
  subAccountId: subAccountId(),
  pipelineId: uuid('pipeline_id').notNull(),
  stageId: uuid('stage_id').notNull(),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  title: text('title').notNull(),
  valueCents: cents('value_cents').notNull().default(0),
  probability: integer('probability'),
  expectedCloseDate: date('expected_close_date', { mode: 'string' }),
  assignedUserId: uuid('assigned_user_id'),
  status: text('status').$type<DealStatus>().notNull().default('open'),
  source: text('source').$type<LeadSource>(),
  wonAt: ts('won_at'),
  lostAt: ts('lost_at'),
  lostReason: text('lost_reason'),
  stageChangedAt: ts('stage_changed_at').defaultNow(),
  sortOrder: integer('sort_order').notNull().default(0),
  customFields: customFields(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('deals_tenant_uq').on(t.subAccountId, t.id),
  index('deals_stage_idx').on(t.subAccountId, t.pipelineId, t.stageId),
  index('deals_contact_idx').on(t.subAccountId, t.contactId),
  index('deals_assigned_idx').on(t.subAccountId, t.assignedUserId),
]);

export type CustomFieldType =
  | 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'url' | 'email' | 'phone';

/** Custom field definitions live in rows, values live in each record's custom_fields jsonb. No migrations needed. */
export const customFieldDefinitions = pgTable('custom_field_definitions', {
  id: pk(),
  subAccountId: subAccountId(),
  entityType: text('entity_type').$type<'contact' | 'company' | 'deal' | 'job' | 'lead'>().notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  fieldType: text('field_type').$type<CustomFieldType>().notNull().default('text'),
  options: jsonb('options').$type<string[]>().notNull().default([]),
  required: boolean('required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('custom_field_definitions_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('custom_field_definitions_key_uq').on(t.subAccountId, t.entityType, t.key),
]);

/** Staff/support workers who may not have a login (used by the Staff module). */
export const staffMembers = pgTable('staff_members', {
  id: pk(),
  subAccountId: subAccountId(),
  userId: uuid('user_id'),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  role: text('role'),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('staff_members_tenant_uq').on(t.subAccountId, t.id)]);
