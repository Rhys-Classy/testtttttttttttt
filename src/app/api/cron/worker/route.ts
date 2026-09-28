import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/crypto';
import { fastTick, slowTick } from '@/worker/tick';

/**
 * Background work for serverless hosting (Netlify has no always-on process).
 * Called every 2 minutes by netlify/functions/worker-tick.mts with CRON_SECRET;
 * every 10 minutes it also runs the slower sweeps (overdue invoices, reminders…).
 * Each run stops starting new work after ~8 seconds; anything left waits for the next run.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || secret.length < 24 || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const started = Date.now();
  const deadline = started + 8_000;
  const slow = new URL(req.url).searchParams.get('slow') === '1';
  const errors: string[] = [];
  if (slow) await slowTick(deadline).catch((e) => errors.push(`slow: ${e instanceof Error ? e.message : e}`));
  await fastTick(deadline).catch((e) => errors.push(`fast: ${e instanceof Error ? e.message : e}`));
  if (errors.length) console.error(JSON.stringify({ level: 'error', context: 'cron worker', errors }));
  return NextResponse.json({ ok: errors.length === 0, slow, ms: Date.now() - started }, { status: errors.length ? 500 : 200 });
}
