import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { Address, cents, createdAt, customFields, pk, ts, updatedAt } from './_shared';
import { subAccountId } from './tenant';

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'snoozed';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskRecurrence = 'daily' | 'weekdays' | 'weekly' | 'fortnightly' | 'monthly' | null;

export const tasks = pgTable('tasks', {
  id: pk(),
  subAccountId: subAccountId(),
  title: text('title').notNull(),
  description: text('description'),
  type: text('type').notNull().default('todo'),
  /** When it's due. If allDay, only the date part (in business timezone) matters. */
  dueAt: ts('due_at'),
  allDay: boolean('all_day').notNull().default(true),
  priority: text('priority').$type<TaskPriority>().notNull().default('normal'),
  status: text('status').$type<TaskStatus>().notNull().default('todo'),
  snoozedUntil: ts('snoozed_until'),
  contactId: uuid('contact_id'),
  dealId: uuid('deal_id'),
  jobId: uuid('job_id'),
  invoiceId: uuid('invoice_id'),
  assigneeUserId: uuid('assignee_user_id'),
  recurrence: text('recurrence').$type<Exclude<TaskRecurrence, null>>(),
  reminderAt: ts('reminder_at'),
  reminderSentAt: ts('reminder_sent_at'),
  completedAt: ts('completed_at'),
  source: text('source').$type<'manual' | 'automation' | 'assistant' | 'system'>().notNull().default('manual'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('tasks_tenant_uq').on(t.subAccountId, t.id),
  index('tasks_due_idx').on(t.subAccountId, t.status, t.dueAt),
  index('tasks_assignee_idx').on(t.assigneeUserId, t.status),
  index('tasks_contact_idx').on(t.subAccountId, t.contactId),
]);

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export const appointments = pgTable('appointments', {
  id: pk(),
  subAccountId: subAccountId(),
  title: text('title').notNull(),
  kind: text('kind').$type<'appointment' | 'event' | 'job_visit' | 'reminder'>().notNull().default('appointment'),
  contactId: uuid('contact_id'),
  dealId: uuid('deal_id'),
  jobId: uuid('job_id'),
  staffId: uuid('staff_id'),
  assignedUserId: uuid('assigned_user_id'),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  location: text('location'),
  notes: text('notes'),
  status: text('status').$type<AppointmentStatus>().notNull().default('scheduled'),
  externalProvider: text('external_provider'),
  externalEventId: text('external_event_id'),
  reminderSentAt: ts('reminder_sent_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('appointments_tenant_uq').on(t.subAccountId, t.id),
  index('appointments_starts_idx').on(t.subAccountId, t.startsAt),
  index('appointments_assigned_idx').on(t.subAccountId, t.assignedUserId),
  index('appointments_contact_idx').on(t.subAccountId, t.contactId),
]);

export type JobStatus =
  | 'enquiry' | 'quoted' | 'booked' | 'scheduled' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';

export const jobs = pgTable('jobs', {
  id: pk(),
  subAccountId: subAccountId(),
  number: text('number').notNull(),
  title: text('title').notNull(),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  dealId: uuid('deal_id'),
  quoteId: uuid('quote_id'),
  status: text('status').$type<JobStatus>().notNull().default('booked'),
  scheduledStart: ts('scheduled_start'),
  scheduledEnd: ts('scheduled_end'),
  address: jsonb('address').$type<Address>().notNull().default({}),
  valueCents: cents('value_cents').notNull().default(0),
  assignedUserId: uuid('assigned_user_id'),
  notes: text('notes'),
  completedAt: ts('completed_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  customFields: customFields(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('jobs_tenant_uq').on(t.subAccountId, t.id),
  uniqueIndex('jobs_number_uq').on(t.subAccountId, t.number),
  index('jobs_status_idx').on(t.subAccountId, t.status),
  index('jobs_assigned_idx').on(t.subAccountId, t.assignedUserId),
  index('jobs_contact_idx').on(t.subAccountId, t.contactId),
]);

export type DocumentEntity = 'business' | 'contact' | 'company' | 'deal' | 'job' | 'invoice' | 'quote';

export const documents = pgTable('documents', {
  id: pk(),
  subAccountId: subAccountId(),
  entityType: text('entity_type').$type<DocumentEntity>().notNull().default('business'),
  entityId: uuid('entity_id'),
  contactId: uuid('contact_id'),
  kind: text('kind').$type<'photo' | 'document'>().notNull().default('document'),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  /** Opaque key inside the storage driver. Never a public URL; files are streamed through an access-checked route. */
  storageKey: text('storage_key').notNull(),
  uploadedByUserId: uuid('uploaded_by_user_id'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('documents_tenant_uq').on(t.subAccountId, t.id),
  index('documents_entity_idx').on(t.subAccountId, t.entityType, t.entityId),
  index('documents_contact_idx').on(t.subAccountId, t.contactId),
]);
