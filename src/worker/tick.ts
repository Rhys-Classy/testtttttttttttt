import { and, eq, sql } from 'drizzle-orm';
import { withAnonymous, withSystem } from '@/db/context';
import { events } from '@/db/schema';
import { advanceRun, processEvent, runScheduledTriggers } from '@/server/services/automation';
import { deliverDueMessages } from '@/server/services/delivery';
import { sendDueReminders, sweepOverdueInvoices } from '@/server/services/finance';
import { wakeSnoozedTasks } from '@/server/services/work';
import { appointmentReminders, dispatchDueCampaigns, taskReminders } from '@/server/services/reminders';
import type { Scope } from '@/server/services/_common';

/**
 * One unit of background work. Used by the long-running worker (self-host) and by
 * the scheduled function on Netlify (/api/cron/worker). Runs as the non-privileged
 * `bos_app` role: work is discovered through narrow SECURITY DEFINER functions and
 * every piece of it runs pinned to exactly one business.
 */
const scopeOf = (subAccountId: string): Scope => ({ subAccountId, userId: null, actor: 'system' });
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

export async function activeBusinesses(): Promise<string[]> {
  return withAnonymous(async (tx) => (await tx.execute<{ ids: string[] }>(sql`select app.active_sub_account_ids() as ids`)).rows[0]?.ids ?? []);
}

export async function drainEvents() {
  const claimed = await withAnonymous(async (tx) => (await tx.execute<{ seq: number; sub_account_id: string }>(sql`select * from app.claim_events(50, 120)`)).rows);
  for (const e of claimed) {
    try {
      const r = await withSystem(e.sub_account_id, (tx) => processEvent(tx, scopeOf(e.sub_account_id), Number(e.seq)));
      if (r.started) log(`event ${e.seq}: started ${r.started} automation run(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`event ${e.seq} failed:`, message);
      await withSystem(e.sub_account_id, (tx) => tx.update(events).set({ error: message.slice(0, 500) })
        .where(and(eq(events.subAccountId, e.sub_account_id), eq(events.seq, Number(e.seq))))).catch(() => undefined);
    }
  }
  return claimed.length;
}

export async function drainRuns() {
  const claimed = await withAnonymous(async (tx) => (await tx.execute<{ id: string; sub_account_id: string }>(sql`select * from app.claim_workflow_runs(50, 120)`)).rows);
  for (const r of claimed) {
    try {
      const out = await withSystem(r.sub_account_id, (tx) => advanceRun(tx, scopeOf(r.sub_account_id), r.id));
      if (out) log(`run ${r.id}: ${out.status}`);
    } catch (err) {
      log(`run ${r.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return claimed.length;
}

/** Outbox events → automations, due automation steps, then message delivery. */
export async function fastTick(deadline = Infinity) {
  await drainEvents();
  await drainRuns();
  for (const id of await activeBusinesses()) {
    if (Date.now() > deadline) break;
    const { sent, failed } = await deliverDueMessages(id);
    if (sent || failed) log(`business ${id.slice(0, 8)}: ${sent} message(s) sent, ${failed} failed`);
  }
}

/** Periodic sweeps per business: overdue invoices, reminders, snoozes, schedules, campaigns. */
export async function slowTick(deadline = Infinity) {
  for (const id of await activeBusinesses()) {
    if (Date.now() > deadline) break;
    const s = scopeOf(id);
    try {
      await withSystem(id, async (tx) => {
        const overdue = await sweepOverdueInvoices(tx, s);
        const reminders = await sendDueReminders(tx, s);
        const woke = await wakeSnoozedTasks(tx, s);
        const scheduled = await runScheduledTriggers(tx, s);
        const campaigns = await dispatchDueCampaigns(tx, s);
        const tasks = await taskReminders(tx, s);
        const appts = await appointmentReminders(tx, s);
        const total = overdue + reminders + woke + scheduled + campaigns + tasks + appts;
        if (total) log(`business ${id.slice(0, 8)}: overdue=${overdue} reminders=${reminders} woke=${woke} scheduled=${scheduled} campaigns=${campaigns} taskReminders=${tasks} apptReminders=${appts}`);
      });
    } catch (err) {
      log(`sweep for ${id} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

