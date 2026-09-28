'use server';

import { revalidatePath } from 'next/cache';
import { inBusiness, requireContext } from '@/server/context';
import { completeTask, reopenTask, snoozeTask, updateTask, type SnoozeOption } from '@/server/services/work';
import { tasks } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { zonedTimeToUtc } from '@/lib/dates';
import { attempt } from './_util';

export async function completeTaskAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    const r = await inBusiness(ctx, subAccountId, 'tasks.edit', (tx, s) => completeTask(tx, s, id), { visible: [['tasks', id]] });
    return { next: r.next ? r.next.dueAt?.toISOString() ?? null : null };
  });
  revalidatePath('/', 'layout');
  return res;
}

export async function reopenTaskAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, 'tasks.edit', (tx, s) => reopenTask(tx, s, id), { visible: [['tasks', id]] }).then(() => undefined));
  revalidatePath('/', 'layout');
  return res;
}

export async function snoozeTaskAction(subAccountId: string, id: string, option: '1h' | '3h' | 'tomorrow' | 'next_week' | string) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    let opt: SnoozeOption;
    if (['1h', '3h', 'tomorrow', 'next_week'].includes(option)) opt = option as SnoozeOption;
    else {
      const [y, m, d] = option.split('-').map(Number);
      const b = ctx.businesses.find((x) => x.id === subAccountId);
      opt = { until: zonedTimeToUtc(y, m, d, 9, 0, b?.timezone ?? ctx.tz) };
    }
    await inBusiness(ctx, subAccountId, 'tasks.edit', (tx, s) => snoozeTask(tx, s, id, opt), { visible: [['tasks', id]] });
  }, 'Snoozed');
  revalidatePath('/', 'layout');
  return res;
}

export async function rescheduleTaskAction(subAccountId: string, id: string, date: string) {
  const ctx = await requireContext();
  const res = await attempt(async () => {
    const [y, m, d] = date.split('-').map(Number);
    const b = ctx.businesses.find((x) => x.id === subAccountId);
    await inBusiness(ctx, subAccountId, 'tasks.edit', (tx, s) => updateTask(tx, s, id, { dueAt: zonedTimeToUtc(y, m, d, 9, 0, b?.timezone ?? ctx.tz), status: 'todo' }), { visible: [['tasks', id]] });
  }, 'Rescheduled');
  revalidatePath('/', 'layout');
  return res;
}

export async function setTaskPriorityAction(subAccountId: string, id: string, priority: 'low' | 'normal' | 'high' | 'urgent') {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, 'tasks.edit', (tx, s) => updateTask(tx, s, id, { priority }), { visible: [['tasks', id]] }).then(() => undefined));
  revalidatePath('/tasks');
  return res;
}

export async function deleteTaskAction(subAccountId: string, id: string) {
  const ctx = await requireContext();
  const res = await attempt(() => inBusiness(ctx, subAccountId, 'tasks.edit', async (tx, s) => { await tx.delete(tasks).where(and(eq(tasks.subAccountId, s.subAccountId), eq(tasks.id, id))); }, { visible: [['tasks', id]] }), 'Deleted');
  revalidatePath('/', 'layout');
  return res;
}
