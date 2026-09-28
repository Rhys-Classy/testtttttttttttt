import type { Config } from '@netlify/functions';

/**
 * Netlify has no always-on worker, so this runs the background jobs on a schedule:
 * automations, email/SMS delivery (every 2 minutes) and the slower sweeps —
 * overdue invoices, reminders, scheduled campaigns (every 10 minutes).
 * The work itself happens in the app at /api/cron/worker, protected by CRON_SECRET.
 */
export default async () => {
  const base = Netlify.env.get('URL');
  const secret = Netlify.env.get('CRON_SECRET');
  if (!base || !secret) {
    console.error('worker-tick: URL or CRON_SECRET is not set');
    return;
  }
  const slow = new Date().getUTCMinutes() % 10 === 0;
  const res = await fetch(`${base}/api/cron/worker${slow ? '?slow=1' : ''}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
  console.log(`worker-tick ${res.status} ${await res.text()}`);
};

export const config: Config = {
  schedule: '*/2 * * * *',
};
