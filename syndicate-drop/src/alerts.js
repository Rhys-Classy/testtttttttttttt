// Free alert channels only: a Telegram bot (main) and an optional Discord webhook.
// Settings come from the dashboard and live in the state file.

export function alertChannels(settings = {}) {
  return {
    telegram: Boolean(settings.telegramToken && settings.telegramChatId),
    discord: Boolean(settings.discordWebhook),
  };
}

/** Discord-style text to plain Telegram text. */
export function toPlain(text) {
  return text.replace(/\*\*/g, '').replace(/@here\s*/g, '');
}

export async function telegramCall(token, method, params, fetchImpl = fetch, timeoutMs = 10000) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(body.description || `Telegram HTTP ${res.status}`);
  return body.result;
}

export async function sendTelegram(settings, text, fetchImpl = fetch) {
  await telegramCall(settings.telegramToken, 'sendMessage', {
    chat_id: settings.telegramChatId,
    text: toPlain(text).slice(0, 4000),
    disable_web_page_preview: true,
  }, fetchImpl);
}

async function sendDiscord(msg, settings, fetchImpl) {
  const res = await fetchImpl(settings.discordWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'SYNDICATE.DROP', content: msg.text.slice(0, 1900) }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok ? 'discord ok' : `discord failed (${res.status})`;
}

/** Sends to every configured channel. Never throws; returns one line per attempt. */
export async function sendAlert(msg, settings = {}, fetchImpl = fetch) {
  const ch = alertChannels(settings);
  const jobs = [];
  if (ch.telegram) jobs.push(sendTelegram(settings, msg.text, fetchImpl).then(() => 'telegram ok'));
  if (ch.discord) jobs.push(sendDiscord(msg, settings, fetchImpl));
  if (!jobs.length) return ['telegram not connected yet (dashboard pop-up only)'];
  const settled = await Promise.allSettled(jobs);
  return settled.map((s) => (s.status === 'fulfilled' ? s.value : `alert failed: ${s.reason?.message || s.reason}`));
}

export function formatDropAlert(item) {
  const price = item.price ? ` $${item.price.toFixed(2)}` : '';
  const what = item.status === 'PREORDER' ? 'PREORDER OPEN' : 'IN STOCK';
  const over = item.maxPrice && item.price && item.price > item.maxPrice ? ` (over your $${item.maxPrice} cap)` : '';
  return { text: `@here 🚨 **${what}** — ${item.name} @ **${item.retailer}**${price}${over}\n${item.url}` };
}

export const TEST_ALERT = { text: 'SYNDICATE.DROP test alert. If you can read this, drop alerts and daily briefs will land here.' };
