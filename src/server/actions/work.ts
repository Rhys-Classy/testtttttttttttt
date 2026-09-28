'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import { zonedTimeToUtc } from '@/lib/dates';
import { inBusiness, requireContext } from '@/server/context';
import { cancelAppointment, createStaffMember, scheduleJob, setJobStatus, setStaffActive, updateAppointment } from '@/server/services/work';
import type { JobStatus } from '@/db/schema';
import { attempt, optStr, str } from './_util';

function local(ctx: Awaited<ReturnType<typeof requireContext>>, subAccountId: string, date: string, time: string) {
  const tz = ctx.businesses.find((b) => b.id === subAccountId)?.timezone ?? ctx.tz;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '07:30').split(':').map(Number);
  return zonedTimeToUtc(y, m, d, hh, mm || 0, tz);
}

export async function jobStatusAction(subAccountId: string, id: string, status: JobStatus) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => setJobStatus(tx, s, id, status)).then(() => undefined), 'Updated');
  revalidatePath(`/jobs/${id}`);
  revalidatePath('/jobs');
  return res;
}

export async function scheduleJobAction(fd: FormData) {
  const ctx = await requireContext();
  const subAccountId = str(fd, 'subAccountId');
  const id = str(fd, 'id');
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => scheduleJob(tx, s, id,
    local(ctx, subAccountId, str(fd, 'startDate'), str(fd, 'startTime')),
    local(ctx, subAccountId, str(fd, 'endDate') || str(fd, 'startDate'), str(fd, 'endTime') || '16:00'))).then(() => undefined), 'Scheduled');
  revalidatePath(`/jobs/${id}`);
  revalidatePath('/calendar');
  return res;
}

export async function jobNotesAction(fd: FormData) {
  const ctx = await requireContext();
  const subAccountId = str(fd, 'subAccountId');
  const id = str(fd, 'id');
  const res = await attempt(() => inBusiness(ctx, subAccountId, async (tx, s) => {
    await tx.update(jobs).set({ notes: optStr(fd, 'notes'), updatedAt: new Date() }).where(and(eq(jobs.subAccountId, s.subAccountId), eq(jobs.id, id)));
  }), 'Saved');
  revalidatePath(`/jobs/${id}`);
  return res;
}

export async function appointmentStatusAction(subAccountId: string, id: string, status: 'confirmed' | 'completed' | 'cancelled' | 'no_show') {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => (status === 'cancelled' ? cancelAppointment(tx, s, id) : updateAppointment(tx, s, id, { status }))).then(() => undefined), 'Updated');
  revalidatePath('/calendar');
  revalidatePath('/', 'layout');
  return res;
}

export async function rescheduleAppointmentAction(subAccountId: string, id: string, startIso: string, durationMinutes: number) {
  const ctx = await requireContext();
  const start = new Date(startIso);
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => updateAppointment(tx, s, id, { startsAt: start, endsAt: new Date(start.getTime() + durationMinutes * 60_000) })).then(() => undefined), 'Moved');
  revalidatePath('/calendar');
  return res;
}

export async function addStaffAction(fd: FormData) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, str(fd, 'subAccountId'), (tx, s) => createStaffMember(tx, s, { name: str(fd, 'name'), email: optStr(fd, 'email'), phone: optStr(fd, 'phone'), role: optStr(fd, 'role') })).then(() => undefined), 'Added');
  revalidatePath('/staff');
  return res;
}

export async function staffActiveAction(subAccountId: string, id: string, active: boolean) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, (tx, s) => setStaffActive(tx, s, id, active)));
  revalidatePath('/staff');
  return res;
}
