// SMS via Twilio's REST API and Discord via a channel webhook. No SDKs.
// Each channel is skipped quietly when its settings are missing.

const env = (k) => (process.env[k] || '').trim();

export function alertChannels() {
  return {
    sms: Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_FROM') && env('ALERT_SMS_TO')),
    discord: Boolean(env('DISCORD_WEBHOOK_URL')),
  };
}

async function sendSms(body, fetchImpl) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const auth = Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64');
  const to = env('ALERT_SMS_TO').split(',').map((s) => s.trim()).filter(Boolean);
  const results = [];
  for (const number of to) {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: env('TWILIO_FROM'), To: number, Body: body.slice(0, 600) }),
      signal: AbortSignal.timeout(10000),
    });
    results.push(res.ok ? `sms ${number.slice(-3)} ok` : `sms ${number.slice(-3)} failed (${res.status})`);
  }
  return results;
}

async function sendDiscord(content, fetchImpl) {
  const res = await fetchImpl(env('DISCORD_WEBHOOK_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'SYNDICATE.DROP', content: content.slice(0, 1900) }),
    signal: AbortSignal.timeout(10000),
  });
  return [res.ok ? 'discord ok' : `discord failed (${res.status})`];
}

/** Sends to every configured channel. Never throws; returns one line per attempt. */
export async function sendAlert({ sms, discord }, fetchImpl = fetch) {
  const ch = alertChannels();
  const jobs = [];
  if (ch.sms) jobs.push(sendSms(sms, fetchImpl));
  if (ch.discord) jobs.push(sendDiscord(discord, fetchImpl));
  if (!jobs.length) return ['no alert channels configured'];
  const settled = await Promise.allSettled(jobs);
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [`alert error: ${s.reason?.message || s.reason}`]));
}

export function formatDropAlert(item) {
  const price = item.price ? ` $${item.price.toFixed(2)}` : '';
  const what = item.status === 'PREORDER' ? 'PREORDER OPEN' : 'IN STOCK';
  const over = item.maxPrice && item.price && item.price > item.maxPrice ? ` (over your $${item.maxPrice} cap)` : '';
  return {
    sms: `${what}: ${item.name} @ ${item.retailer}${price}${over}\n${item.url}`,
    discord: `@here **${what}** — ${item.name} @ **${item.retailer}**${price}${over}\n${item.url}`,
  };
}
