import { and, eq, lte } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import {
  appointments, documents, jobs, staffMembers, tasks,
  type AppointmentStatus, type JobStatus, type TaskPriority, type TaskRecurrence,
} from '@/db/schema';
import { addDaysKey, todayKey, weekRange, zonedParts, zonedTimeToUtc } from '@/lib/dates';
import { Scope, ValidationError, byTenant, cleanStr, emit, getBusiness, logActivity, must, nextNumber } from './_common';

export type Task = typeof tasks.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Job = typeof jobs.$inferSelect;

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

export type TaskInput = {
  title: string;
  description?: string | null;
  type?: string;
  dueAt?: Date | null;
  allDay?: boolean;
  priority?: TaskPriority;
  contactId?: string | null;
  dealId?: string | null;
  jobId?: string | null;
  invoiceId?: string | null;
  assigneeUserId?: string | null;
  recurrence?: Exclude<TaskRecurrence, null> | null;
  reminderAt?: Date | null;
  source?: Task['source'];
};

export async function createTask(tx: Tx, scope: Scope, input: TaskInput): Promise<Task> {
  const title = cleanStr(input.title);
  if (!title) throw new ValidationError('What needs doing?');
  const [row] = await tx.insert(tasks).values({
    subAccountId: scope.subAccountId,
    title,
    description: cleanStr(input.description),
    type: input.type ?? guessTaskType(title),
    dueAt: input.dueAt ?? null,
    allDay: input.allDay ?? true,
    priority: input.priority ?? 'normal',
    contactId: input.contactId ?? null,
    dealId: input.dealId ?? null,
    jobId: input.jobId ?? null,
    invoiceId: input.invoiceId ?? null,
    assigneeUserId: input.assigneeUserId ?? scope.userId,
    recurrence: input.recurrence ?? null,
    reminderAt: input.reminderAt ?? null,
    source: input.source ?? (scope.actor === 'system' ? 'automation' : 'manual'),
  }).returning();
  if (row.contactId) {
    await logActivity(tx, scope, { contactId: row.contactId, entityType: 'task', entityId: row.id, type: 'task', summary: `Task: ${title}` });
  }
  return row;
}

export function guessTaskType(title: string): string {
  const t = title.toLowerCase();
  if (/^(call|ring|phone)\b/.test(t)) return 'call';
  if (/^(email|reply)\b/.test(t)) return 'email';
  if (/^(text|sms)\b/.test(t)) return 'sms';
  if (/\b(follow ?up|chase)\b/.test(t)) return 'follow_up';
  if (/\b(quote|estimate)\b/.test(t)) return 'quote';
  if (/\binvoice\b/.test(t)) return 'invoice';
  return 'todo';
}

export async function getTask(tx: Tx, scope: Scope, id: string) {
  const [row] = await tx.select().from(tasks).where(byTenant(tasks, scope, id));
  return must(row, 'Task');
}

function nextOccurrence(from: Date, recurrence: Exclude<TaskRecurrence, null>, tz: string): Date {
  const p = zonedParts(from, tz);
  const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  let nextKey: string;
  switch (recurrence) {
    case 'daily': nextKey = addDaysKey(key, 1); break;
    case 'weekdays': {
      nextKey = addDaysKey(key, 1);
      while ([0, 6].includes(new Date(`${nextKey}T00:00:00Z`).getUTCDay())) nextKey = addDaysKey(nextKey, 1);
      break;
    }
    case 'weekly': nextKey = addDaysKey(key, 7); break;
    case 'fortnightly': nextKey = addDaysKey(key, 14); break;
    case 'monthly': {
      const m = p.month === 12 ? 1 : p.month + 1;
      const y = p.month === 12 ? p.year + 1 : p.year;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      nextKey = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(p.day, lastDay)).padStart(2, '0')}`;
      break;
    }
  }
  const [y, m, d] = nextKey.split('-').map(Number);
  return zonedTimeToUtc(y, m, d, p.hour, p.minute, tz);
}

/** One click. Recurring tasks roll forward automatically. */
export async function completeTask(tx: Tx, scope: Scope, id: string) {
  const task = await getTask(tx, scope, id);
  if (task.status === 'done') return { task, next: null };
  const [done] = await tx.update(tasks).set({ status: 'done', completedAt: new Date(), snoozedUntil: null, updatedAt: new Date() })
    .where(byTenant(tasks, scope, id)).returning();
  let next: Task | null = null;
  if (task.recurrence) {
    const b = await getBusiness(tx, scope.subAccountId);
    const base = task.dueAt ?? new Date();
    next = await createTask(tx, scope, {
      title: task.title, description: task.description, type: task.type, priority: task.priority,
      dueAt: nextOccurrence(base, task.recurrence, b.timezone), allDay: task.allDay, contactId: task.contactId,
      dealId: task.dealId, jobId: task.jobId, assigneeUserId: task.assigneeUserId, recurrence: task.recurrence, source: task.source,
    });
  }
  if (task.contactId) await logActivity(tx, scope, { contactId: task.contactId, entityType: 'task', entityId: id, type: 'task_done', summary: `Done: ${task.title}` });
  await emit(tx, scope, 'task.completed', { entityType: 'task', entityId: id, contactId: task.contactId, payload: { title: task.title } });
  return { task: done, next };
}

export async function reopenTask(tx: Tx, scope: Scope, id: string) {
  const [row] = await tx.update(tasks).set({ status: 'todo', completedAt: null, updatedAt: new Date() }).where(byTenant(tasks, scope, id)).returning();
  return must(row, 'Task');
}

export type SnoozeOption = '1h' | '3h' | 'tomorrow' | 'next_week' | { until: Date };

export function snoozeUntil(option: SnoozeOption, tz: string, now = new Date()): Date {
  if (typeof option === 'object') return option.until;
  if (option === '1h') return new Date(now.getTime() + 3_600_000);
  if (option === '3h') return new Date(now.getTime() + 3 * 3_600_000);
  const today = todayKey(tz, now);
  const key = option === 'tomorrow' ? addDaysKey(today, 1) : addDaysKey(weekRange(today, tz).startKey, 7);
  const [y, m, d] = key.split('-').map(Number);
  return zonedTimeToUtc(y, m, d, 9, 0, tz);
}

export async function snoozeTask(tx: Tx, scope: Scope, id: string, option: SnoozeOption) {
  const b = await getBusiness(tx, scope.subAccountId);
  const until = snoozeUntil(option, b.timezone);
  const task = await getTask(tx, scope, id);
  const [row] = await tx.update(tasks).set({
    status: 'snoozed', snoozedUntil: until,
    // Keep the task in "My Day" on the day it comes back.
    dueAt: task.dueAt && task.dueAt < until ? until : task.dueAt ?? until,
    reminderSentAt: null,
    updatedAt: new Date(),
  }).where(byTenant(tasks, scope, id)).returning();
  return row;
}

export async function updateTask(tx: Tx, scope: Scope, id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'dueAt' | 'allDay' | 'priority' | 'status' | 'assigneeUserId' | 'recurrence' | 'reminderAt' | 'contactId'>>) {
  const extra: Partial<Task> = {};
  if (patch.status && patch.status !== 'snoozed') extra.snoozedUntil = null;
  const [row] = await tx.update(tasks).set({ ...patch, ...extra, updatedAt: new Date() }).where(byTenant(tasks, scope, id)).returning();
  return must(row, 'Task');
}

/** Worker: wake snoozed tasks whose time has come. */
export async function wakeSnoozedTasks(tx: Tx, scope: Scope, now = new Date()) {
  const rows = await tx.update(tasks).set({ status: 'todo', snoozedUntil: null })
    .where(and(eq(tasks.subAccountId, scope.subAccountId), eq(tasks.status, 'snoozed'), lte(tasks.snoozedUntil, now)))
    .returning({ id: tasks.id });
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* Appointments                                                        */
/* ------------------------------------------------------------------ */

export type AppointmentInput = {
  title: string;
  startsAt: Date;
  endsAt?: Date;
  durationMinutes?: number;
  contactId?: string | null;
  dealId?: string | null;
  jobId?: string | null;
  staffId?: string | null;
  location?: string | null;
  notes?: string | null;
  kind?: Appointment['kind'];
  assignedUserId?: string | null;
};

export async function createAppointment(tx: Tx, scope: Scope, input: AppointmentInput): Promise<Appointment> {
  const title = cleanStr(input.title);
  if (!title) throw new ValidationError('Appointment needs a title.');
  const endsAt = input.endsAt ?? new Date(input.startsAt.getTime() + (input.durationMinutes ?? 60) * 60_000);
  if (endsAt <= input.startsAt) throw new ValidationError('End time must be after the start.');
  const [row] = await tx.insert(appointments).values({
    subAccountId: scope.subAccountId,
    title,
    kind: input.kind ?? 'appointment',
    startsAt: input.startsAt,
    endsAt,
    contactId: input.contactId ?? null,
    dealId: input.dealId ?? null,
    jobId: input.jobId ?? null,
    staffId: input.staffId ?? null,
    location: cleanStr(input.location),
    notes: cleanStr(input.notes),
    assignedUserId: input.assignedUserId ?? scope.userId,
  }).returning();
  if (row.contactId) await logActivity(tx, scope, { contactId: row.contactId, entityType: 'appointment', entityId: row.id, type: 'appointment', summary: `Booked: ${title}` });
  await emit(tx, scope, 'appointment.booked', { entityType: 'appointment', entityId: row.id, contactId: row.contactId, payload: { startsAt: row.startsAt.toISOString(), title } });
  return row;
}

export async function updateAppointment(tx: Tx, scope: Scope, id: string, patch: Partial<Pick<Appointment, 'title' | 'startsAt' | 'endsAt' | 'location' | 'notes' | 'status' | 'contactId' | 'staffId'>>) {
  const [current] = await tx.select().from(appointments).where(byTenant(appointments, scope, id));
  must(current, 'Appointment');
  const [row] = await tx.update(appointments).set({ ...patch, reminderSentAt: patch.startsAt ? null : current.reminderSentAt, updatedAt: new Date() })
    .where(byTenant(appointments, scope, id)).returning();
  if (patch.status === 'cancelled' && current.status !== 'cancelled') {
    await emit(tx, scope, 'appointment.cancelled', { entityType: 'appointment', entityId: id, contactId: current.contactId, payload: { title: current.title } });
    if (current.contactId) await logActivity(tx, scope, { contactId: current.contactId, entityType: 'appointment', entityId: id, type: 'appointment', summary: `Cancelled: ${current.title}` });
  }
  return row;
}

export const cancelAppointment = (tx: Tx, scope: Scope, id: string) => updateAppointment(tx, scope, id, { status: 'cancelled' as AppointmentStatus });

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export const JOB_STATUSES: { key: JobStatus; label: string }[] = [
  { key: 'enquiry', label: 'Enquiry' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'booked', label: 'Booked' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export async function createJob(tx: Tx, scope: Scope, input: {
  title: string; contactId?: string | null; companyId?: string | null; dealId?: string | null; quoteId?: string | null;
  status?: JobStatus; scheduledStart?: Date | null; scheduledEnd?: Date | null; valueCents?: number; notes?: string | null;
  address?: Record<string, string>; assignedUserId?: string | null;
}): Promise<Job> {
  const title = cleanStr(input.title);
  if (!title) throw new ValidationError('Job needs a title.');
  const [job] = await tx.insert(jobs).values({
    subAccountId: scope.subAccountId,
    number: await nextNumber(tx, scope, 'job'),
    title,
    contactId: input.contactId ?? null,
    companyId: input.companyId ?? null,
    dealId: input.dealId ?? null,
    quoteId: input.quoteId ?? null,
    status: input.status ?? (input.scheduledStart ? 'scheduled' : 'booked'),
    scheduledStart: input.scheduledStart ?? null,
    scheduledEnd: input.scheduledEnd ?? null,
    valueCents: input.valueCents ?? 0,
    notes: cleanStr(input.notes),
    address: input.address ?? {},
    assignedUserId: input.assignedUserId ?? null,
  }).returning();
  await logActivity(tx, scope, { contactId: job.contactId, entityType: 'job', entityId: job.id, type: 'job', summary: `Job ${job.number} created: ${title}` });
  await emit(tx, scope, 'job.created', { entityType: 'job', entityId: job.id, contactId: job.contactId, payload: { number: job.number } });
  return job;
}

export async function getJob(tx: Tx, scope: Scope, id: string) {
  const [row] = await tx.select().from(jobs).where(byTenant(jobs, scope, id));
  return must(row, 'Job');
}

export async function setJobStatus(tx: Tx, scope: Scope, id: string, status: JobStatus) {
  const job = await getJob(tx, scope, id);
  if (job.status === status) return job;
  const [row] = await tx.update(jobs).set({ status, completedAt: status === 'completed' ? new Date() : null, updatedAt: new Date() })
    .where(byTenant(jobs, scope, id)).returning();
  const label = JOB_STATUSES.find((s) => s.key === status)?.label ?? status;
  await logActivity(tx, scope, { contactId: job.contactId, entityType: 'job', entityId: id, type: 'status', summary: `Job ${job.number} → ${label}` });
  await emit(tx, scope, 'job.status_changed', { entityType: 'job', entityId: id, contactId: job.contactId, payload: { from: job.status, to: status } });
  return row;
}

export async function scheduleJob(tx: Tx, scope: Scope, id: string, start: Date, end: Date) {
  const job = await getJob(tx, scope, id);
  const [row] = await tx.update(jobs).set({
    scheduledStart: start, scheduledEnd: end, status: ['enquiry', 'quoted', 'booked'].includes(job.status) ? 'scheduled' : job.status, updatedAt: new Date(),
  }).where(byTenant(jobs, scope, id)).returning();
  return row;
}

/* ------------------------------------------------------------------ */
/* Documents (metadata; bytes live in the storage driver)              */
/* ------------------------------------------------------------------ */

export async function createDocumentRecord(tx: Tx, scope: Scope, input: {
  entityType: typeof documents.$inferInsert['entityType']; entityId?: string | null; contactId?: string | null;
  filename: string; mimeType: string; sizeBytes: number; storageKey: string;
}) {
  const [row] = await tx.insert(documents).values({
    subAccountId: scope.subAccountId,
    entityType: input.entityType ?? 'business',
    entityId: input.entityId ?? null,
    contactId: input.contactId ?? null,
    kind: input.mimeType.startsWith('image/') ? 'photo' : 'document',
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storageKey: input.storageKey,
    uploadedByUserId: scope.userId,
  }).returning();
  return row;
}

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

export async function createStaffMember(tx: Tx, scope: Scope, input: { name: string; email?: string | null; phone?: string | null; role?: string | null }) {
  const name = cleanStr(input.name);
  if (!name) throw new ValidationError('Name is required.');
  const [row] = await tx.insert(staffMembers).values({
    subAccountId: scope.subAccountId, name, email: cleanStr(input.email), phone: cleanStr(input.phone), role: cleanStr(input.role),
  }).returning();
  return row;
}

export async function setStaffActive(tx: Tx, scope: Scope, id: string, active: boolean) {
  await tx.update(staffMembers).set({ active }).where(and(eq(staffMembers.subAccountId, scope.subAccountId), eq(staffMembers.id, id)));
}
