// Polls each watched product page on its own interval and alerts once when it
// becomes buyable. It identifies itself honestly and backs off when a retailer
// blocks it; it does not try to get around bot protection or check out.
import { detectStock, STATUS, BUYABLE } from './detect.js';
import { sendAlert, formatDropAlert } from './alerts.js';

export const MIN_INTERVAL_SEC = 15;
const USER_AGENT = 'SyndicateDrop/1.0 (personal stock monitor; checks one product page every 15s or slower)';
const BLOCK_BACKOFF_SEC = 300;

export async function checkUrl(item, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(item.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-AU,en;q=0.9' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { status: STATUS.ERROR, source: 'network', price: null, httpStatus: 0, note: e.message };
  }
  if ([401, 403, 429, 503].includes(res.status)) {
    return { status: STATUS.BLOCKED, source: 'http', price: null, httpStatus: res.status };
  }
  if (!res.ok) return { status: STATUS.ERROR, source: 'http', price: null, httpStatus: res.status };
  const html = await res.text();
  return { ...detectStock(html, item), httpStatus: res.status };
}

/** True when this result should fire an alert: it just became buyable, or moved between buyable states. */
export function shouldAlert(item, next) {
  return BUYABLE.has(next) && item.lastAlertStatus !== next;
}

export function isDue(item, now) {
  if (item.active === false || !item.url) return false;
  const interval = Math.max(MIN_INTERVAL_SEC, item.intervalSec || 30);
  const wait = item.status === STATUS.BLOCKED ? Math.max(interval, BLOCK_BACKOFF_SEC) : interval;
  return !item.lastChecked || now - item.lastChecked >= wait * 1000;
}

export class Monitor {
  constructor({ store, fetchImpl = fetch, alert = sendAlert }) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.alert = alert;
    this.running = false;
    this.inFlight = new Set();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.store.log('ok', 'SYSTEM', `monitor online, ${this.store.state.items.filter((i) => i.url).length} product pages on watch`);
    this.loop = setInterval(() => this.tick(), 2000);
  }

  stop() {
    clearInterval(this.loop);
    this.running = false;
  }

  tick() {
    const now = Date.now();
    for (const item of this.store.state.items) {
      if (this.inFlight.has(item.id) || !isDue(item, now)) continue;
      this.check(item);
    }
  }

  async check(item) {
    this.inFlight.add(item.id);
    try {
      const r = await checkUrl(item, this.fetchImpl);
      const prev = item.status;
      item.lastChecked = Date.now();
      item.httpStatus = r.httpStatus;
      if (r.price) item.price = r.price;
      item.source = r.source;
      item.status = r.status;

      if (prev !== r.status) {
        item.lastChange = item.lastChecked;
        const level = BUYABLE.has(r.status) ? 'ok' : r.status === STATUS.BLOCKED || r.status === STATUS.ERROR ? 'warn' : 'info';
        const extra = r.httpStatus && r.status !== STATUS.IN_STOCK ? ` (HTTP ${r.httpStatus})` : '';
        this.store.log(level, item.retailer, `${item.name}: ${prev || 'NEW'} → ${r.status}${extra}`);
      }

      // Tell the owner once a day per product when a page can't be read.
      if ((r.status === STATUS.BLOCKED || r.status === STATUS.ERROR) && prev !== r.status && item.lastChecked - (item.lastProblemAlert || 0) > 86400000) {
        item.lastProblemAlert = item.lastChecked;
        const why = r.status === STATUS.BLOCKED ? `the retailer refused the check (HTTP ${r.httpStatus}). Retrying every 5 min.` : `the page failed to load${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}. Retrying.`;
        this.alert({ text: `⚠ **${r.status}** — ${item.name} @ ${item.retailer}: ${why}` }, this.store.state.settings, this.fetchImpl);
      }

      if (shouldAlert(item, r.status)) {
        item.lastAlertStatus = r.status;
        const lines = await this.alert(formatDropAlert(item), this.store.state.settings, this.fetchImpl);
        this.store.state.alertsSent += 1;
        this.store.log('alert', item.retailer, `ALERT ${item.name} → ${lines.join(', ')}`);
      } else if (!BUYABLE.has(r.status) && r.status !== STATUS.BLOCKED && r.status !== STATUS.ERROR) {
        // Re-arm once it sells out, so the next restock alerts again.
        item.lastAlertStatus = null;
      }
      this.store.save();
    } finally {
      this.inFlight.delete(item.id);
    }
  }
}
