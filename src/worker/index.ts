import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { closeDb } from '@/db/client';
import { withAnonymous, withSystem } from '@/db/context';
import { events } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { advanceRun, processEvent, runScheduledTriggers } from '@/server/services/automation';
import { deliverDueMessages } from '@/server/services/delivery';
import { sendDueReminders, sweepOverdueInvoices } from '@/server/services/finance';
import { wakeSnoozedTasks } from '@/server/services/work';
import { appointmentReminders, dispatchDueCampaigns, taskReminders } from '@/server/services/reminders';
import type { Scope } from '@/server/services/_common';

/**
 * Background worker. Runs as the same non-privileged `bos_app` role as the web app.
 * It discovers work through narrow SECURITY DEFINER functions (claim_events,
 * claim_workflow_runs, active_sub_account_ids) and then does every piece of work
 * inside a context pinned to exactly one business, so RLS still applies.
 */

const FAST_MS = Number(process.env.WORKER_FAST_MS ?? 3000);
const SLOW_MS = Number(process.env.WORKER_SLOW_MS ?? 60_000);
let running = true;

const scopeOf = (subAccountId: string): Scope => ({ subAccountId, userId: null, actor: 'system' });
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

async function activeBusinesses(): Promise<string[]> {
  return withAnonymous(async (tx) => (await tx.execute<{ ids: string[] }>(sql`select app.active_sub_account_ids() as ids`)).rows[0]?.ids ?? []);
}

async function drainEvents() {
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

async function drainRuns() {
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

async function fastTick() {
  await drainEvents();
  await drainRuns();
  for (const id of await activeBusinesses()) {
    const { sent, failed } = await deliverDueMessages(id);
    if (sent || failed) log(`business ${id.slice(0, 8)}: ${sent} message(s) sent, ${failed} failed`);
  }
}

async function slowTick() {
  for (const id of await activeBusinesses()) {
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

async function loop(fn: () => Promise<unknown>, every: number, name: string) {
  while (running) {
    const started = Date.now();
    try { await fn(); } catch (err) { log(`${name} tick failed:`, err instanceof Error ? err.message : err); }
    await new Promise((r) => setTimeout(r, Math.max(250, every - (Date.now() - started))));
  }
}

async function main() {
  log(`worker started (fast ${FAST_MS}ms, slow ${SLOW_MS}ms)`);
  const stop = async () => { running = false; log('stopping…'); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  if (process.argv.includes('--once')) {
    await slowTick();
    await fastTick();
    await fastTick();
    await closeDb();
    return;
  }
  await Promise.all([loop(fastTick, FAST_MS, 'fast'), loop(slowTick, SLOW_MS, 'slow')]);
  await closeDb();
}

main().catch((e) => { console.error(e); process.exit(1); });
