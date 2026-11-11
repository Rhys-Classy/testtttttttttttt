// Picks up the cloud pre-order scout's findings from a private ntfy.sh topic
// (free, no account) and hands them to the Telegram bot as one-tap suggestions.
// The topic name is the only secret; messages are validated before use and
// nothing is added to the watchlist without a tap.
import { checkProductUrl } from './actions.js';
import { retailerOf, KNOWN_RETAILERS } from './detect.js';

const POLL_MS = 5 * 60 * 1000;
// Baked in at build time for the owner's copy; empty when built without it.
const DEFAULT_TOPIC = process.env.SD_RELAY_TOPIC || '';

/** Turns one relay message body into a suggestion, a note, or null when unusable. */
export function parseRelayMessage(body, items) {
  let d;
  try {
    d = JSON.parse(body);
  } catch {
    return null;
  }
  if (!d || typeof d !== 'object') return null;
  if (typeof d.note === 'string' && d.note.trim()) return { type: 'note', text: d.note.trim().slice(0, 1500) };
  let url;
  try {
    url = checkProductUrl(d.url);
  } catch {
    return null;
  }
  const retailer = retailerOf(url);
  if (!KNOWN_RETAILERS.includes(retailer) || retailer === 'JB HI-FI') return null;
  if (items.some((i) => i.url === url)) return null;
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    type: 'suggest',
    item: {
      name: String(d.name || 'Unnamed product').slice(0, 140),
      url,
      retailer,
      kind: typeof d.kind === 'string' ? d.kind : 'OTHER',
      releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(d.releaseDate || '') ? d.releaseDate : null,
      maxPrice: num(d.maxPrice) || num(d.price),
      price: num(d.price),
      preorder: Boolean(d.preorder),
    },
  };
}

export class Relay {
  constructor({ store, bot, fetchImpl = fetch }) {
    this.store = store;
    this.bot = bot;
    this.fetchImpl = fetchImpl;
  }

  get topic() {
    return this.store.state.settings.relayTopic || DEFAULT_TOPIC;
  }

  start() {
    if (!this.topic) return;
    this.timer = setInterval(() => this.poll(), POLL_MS);
    setTimeout(() => this.poll(), 20000);
  }

  stop() {
    clearInterval(this.timer);
  }

  async poll() {
    const s = this.store.state.settings;
    const since = s.relayLastId || '24h';
    let text;
    try {
      const res = await this.fetchImpl(`https://ntfy.sh/${encodeURIComponent(this.topic)}/json?poll=1&since=${encodeURIComponent(since)}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      if (s.relayError !== e.message) {
        s.relayError = e.message;
        this.store.log('warn', 'SCOUT', `could not reach the scout relay: ${e.message}`);
      }
      return;
    }
    s.relayError = null;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.event !== 'message') continue;
      s.relayLastId = ev.id;
      const parsed = parseRelayMessage(ev.message, this.store.state.items);
      if (!parsed) continue;
      if (parsed.type === 'note') {
        this.store.log('info', 'SCOUT', parsed.text.slice(0, 200));
        await this.bot.notify(`🔎 **SCOUT** — ${parsed.text}`);
      } else {
        this.store.log('info', 'SCOUT', `found ${parsed.item.name} @ ${parsed.item.retailer}`);
        await this.bot.suggest(parsed.item);
      }
    }
    this.store.save();
  }
}
