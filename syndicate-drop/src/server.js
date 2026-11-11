import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, newId } from './store.js';
import { Monitor, MIN_INTERVAL_SEC } from './monitor.js';
import { retailerOf, KNOWN_RETAILERS, BUYABLE } from './detect.js';
import { alertChannels, sendAlert } from './alerts.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.DASH_PASSWORD || '';
const KINDS = ['ETB', 'BOOSTER_BOX', 'BOOSTER_BUNDLE', 'COLLECTION', 'TIN', 'OTHER'];

const store = new Store(process.env.DATA_DIR || path.join(ROOT, 'data'));
const monitor = new Monitor({ store });

class BadRequest extends Error {}

function authorised(req) {
  if (!PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const supplied = Buffer.from(header.slice(6), 'base64').toString().split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 50_000) throw new BadRequest('That request is too large.');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new BadRequest('That request was not valid JSON.');
  }
}

function cleanText(v, max = 140) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function toCents(v, field) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new BadRequest(`${field} must be a dollar amount.`);
  return Math.round(n * 100);
}

function checkProductUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new BadRequest('Paste the full product link, starting with https://');
  }
  if (u.protocol !== 'https:') throw new BadRequest('Product links must start with https://');
  if (!u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) {
    throw new BadRequest('That does not look like a shop website.');
  }
  return u.toString();
}

function stats() {
  const { items, buys, alertsSent } = store.state;
  let spent = 0;
  let profit = 0;
  let unsoldCost = 0;
  for (const b of buys) {
    const cost = b.unitCost * b.qty;
    spent += cost;
    if (b.soldUnitPrice !== null) profit += b.soldUnitPrice * b.qty - cost - (b.fees || 0);
    else unsoldCost += cost;
  }
  return {
    watching: items.filter((i) => i.active !== false).length,
    live: items.filter((i) => BUYABLE.has(i.status)).length,
    blocked: items.filter((i) => i.status === 'BLOCKED').length,
    alertsSent,
    spentCents: spent,
    profitCents: profit,
    unsoldCostCents: unsoldCost,
  };
}

const routes = {
  'GET /api/state': () => ({
    items: store.state.items,
    buys: store.state.buys,
    log: store.state.log.slice(-120),
    stats: stats(),
    retailers: KNOWN_RETAILERS,
    kinds: KINDS,
    channels: alertChannels(),
    minInterval: MIN_INTERVAL_SEC,
  }),

  'POST /api/items': async (req) => {
    const b = await readJson(req);
    const url = checkProductUrl(b.url);
    if (store.state.items.some((i) => i.url === url)) throw new BadRequest('That product is already on the watchlist.');
    const name = cleanText(b.name) || 'Unnamed product';
    const item = {
      id: newId(),
      name,
      url,
      retailer: retailerOf(url),
      kind: KINDS.includes(b.kind) ? b.kind : 'OTHER',
      releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(b.releaseDate || '') ? b.releaseDate : null,
      intervalSec: Math.max(MIN_INTERVAL_SEC, Math.min(3600, Number(b.intervalSec) || 30)),
      maxPrice: b.maxPrice ? Number(b.maxPrice) || null : null,
      inStockText: cleanText(b.inStockText, 80) || null,
      outOfStockText: cleanText(b.outOfStockText, 80) || null,
      active: true,
      status: null,
      price: null,
      lastChecked: null,
      lastChange: null,
      lastAlertStatus: null,
      addedAt: Date.now(),
    };
    store.state.items.push(item);
    store.log('info', 'OPERATOR', `watching ${name} @ ${item.retailer}`);
    store.save();
    monitor.check(item);
    return item;
  },

  'POST /api/test-alert': async () => {
    const lines = await sendAlert({
      sms: 'SYNDICATE.DROP test alert. If you got this, drop alerts will reach you.',
      discord: 'SYNDICATE.DROP test alert. If you can read this, drop alerts will land here.',
    });
    store.log('alert', 'OPERATOR', `test alert → ${lines.join(', ')}`);
    return { lines };
  },

  'POST /api/buys': async (req) => {
    const b = await readJson(req);
    const qty = Math.round(Number(b.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) throw new BadRequest('Quantity must be between 1 and 999.');
    const unitCost = toCents(b.unitCost, 'Unit cost');
    if (unitCost === null) throw new BadRequest('Enter what you paid for each one.');
    const buy = {
      id: newId(),
      itemName: cleanText(b.itemName) || 'Unnamed product',
      retailer: cleanText(b.retailer, 40) || 'UNKNOWN',
      qty,
      unitCost,
      soldUnitPrice: toCents(b.soldUnitPrice, 'Sold price'),
      fees: toCents(b.fees, 'Fees') || 0,
      date: new Date().toISOString().slice(0, 10),
    };
    store.state.buys.unshift(buy);
    store.log('info', 'LEDGER', `bought ${qty} × ${buy.itemName} at $${(unitCost / 100).toFixed(2)}`);
    store.save();
    return buy;
  },
};

const itemRoutes = {
  DELETE: (item) => {
    store.state.items = store.state.items.filter((i) => i !== item);
    store.log('info', 'OPERATOR', `stopped watching ${item.name}`);
    store.save();
    return { ok: true };
  },
  'POST check': async (item) => {
    await monitor.check(item);
    return item;
  },
  'POST toggle': (item) => {
    item.active = item.active === false;
    store.log('info', 'OPERATOR', `${item.active ? 'resumed' : 'paused'} ${item.name}`);
    store.save();
    return item;
  },
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  if (url.pathname === '/healthz') return send(res, 200, { ok: true, monitor: monitor.running });

  if (!authorised(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="SYNDICATE.DROP"' });
    return res.end('Password required.');
  }

  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!/^[a-z0-9_-]+\.(html|css|js|svg)$/.test(file)) return send(res, 404, 'Not found', 'text/plain');
    const full = path.join(PUBLIC, file);
    if (!fs.existsSync(full)) return send(res, 404, 'Not found', 'text/plain');
    const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml' };
    return send(res, 200, fs.readFileSync(full), types[file.split('.').pop()]);
  }

  const direct = routes[`${req.method} ${url.pathname}`];
  if (direct) return send(res, 200, await direct(req));

  let m = url.pathname.match(/^\/api\/items\/([a-f0-9]+)(?:\/(check|toggle))?$/);
  if (m) {
    const item = store.state.items.find((i) => i.id === m[1]);
    if (!item) return send(res, 404, { error: 'That product is no longer on the watchlist.' });
    const fn = itemRoutes[m[2] ? `${req.method} ${m[2]}` : req.method];
    if (fn) return send(res, 200, await fn(item));
  }

  m = url.pathname.match(/^\/api\/buys\/([a-f0-9]+)$/);
  if (m) {
    const buy = store.state.buys.find((b) => b.id === m[1]);
    if (!buy) return send(res, 404, { error: 'That ledger entry no longer exists.' });
    if (req.method === 'DELETE') {
      store.state.buys = store.state.buys.filter((b) => b !== buy);
      store.save();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'PATCH') {
      const b = await readJson(req);
      if ('soldUnitPrice' in b) buy.soldUnitPrice = toCents(b.soldUnitPrice, 'Sold price');
      if ('fees' in b) buy.fees = toCents(b.fees, 'Fees') || 0;
      store.log('ok', 'LEDGER', `sold ${buy.qty} × ${buy.itemName} at $${((buy.soldUnitPrice || 0) / 100).toFixed(2)}`);
      store.save();
      return send(res, 200, buy);
    }
  }

  send(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e instanceof BadRequest) return send(res, 400, { error: e.message });
    const ref = newId();
    console.error(`[${ref}]`, e);
    send(res, 500, { error: `Something went wrong (ref ${ref}).` });
  });
});

server.listen(PORT, () => {
  console.log(`SYNDICATE.DROP on :${PORT}${PASSWORD ? '' : ' (WARNING: no DASH_PASSWORD set — dashboard is open)'}`);
  monitor.start();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    monitor.stop();
    store.flush();
    process.exit(0);
  });
}
