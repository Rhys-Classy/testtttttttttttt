import 'dotenv/config';
import { closeDb } from '@/db/client';
import { fastTick, slowTick } from './tick';

/**
 * Background worker. Runs as the same non-privileged `bos_app` role as the web app.
 * It discovers work through narrow SECURITY DEFINER functions (claim_events,
 * claim_workflow_runs, active_sub_account_ids) and then does every piece of work
 * inside a context pinned to exactly one business, so RLS still applies.
 */

const FAST_MS = Number(process.env.WORKER_FAST_MS ?? 3000);
const SLOW_MS = Number(process.env.WORKER_SLOW_MS ?? 60_000);
let running = true;
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

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
