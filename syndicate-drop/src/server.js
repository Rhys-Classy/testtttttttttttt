import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { Store, newId } from './store.js';
import { Monitor, MIN_INTERVAL_SEC } from './monitor.js';
import { KNOWN_RETAILERS, BUYABLE } from './detect.js';
import { alertChannels, sendAlert, telegramCall, TEST_ALERT } from './alerts.js';
import { Digest } from './digest.js';
import { TelegramBot } from './telegram.js';
import { Relay } from './relay.js';
import { SEED_ITEMS } from './seed.js';
import { createActions, UserError, KINDS } from './actions.js';
import { selfInstall } from './install.js';

// Packaged as a single .exe (Node SEA) the web files are embedded assets and
// data sits in a folder next to the program. Run from source, both come from the repo.
const require = createRequire(path.resolve(process.argv[1] || '.'));
const sea = (() => {
  try {
    const s = require('node:sea');
    return s.isSea() ? s : null;
  } catch {
    return null;
  }
})();
if (sea && process.platform === 'win32' && process.env.SD_NO_INSTALL !== '1') {
  try {
    if (selfInstall()) process.exit(0);
  } catch (e) {
    console.error(`  Install step failed (${e.message}). Running from here instead.`);
  }
}
const ROOT = sea ? path.dirname(process.execPath) : path.dirname(path.dirname(path.resolve(process.argv[1])));
const PUBLIC = path.join(ROOT, 'public');
const START_PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.DASH_PASSWORD || '';

const store = new Store(process.env.DATA_DIR || path.join(ROOT, sea ? 'SyndicateDrop-data' : 'data'));
const monitor = new Monitor({ store });
const actions = createActions({ store, monitor, alert: sendAlert });
const digest = new Digest({ store, alert: sendAlert });
const bot = new TelegramBot({ store, actions, monitor });
const relay = new Relay({ store, bot });

if (store.fresh) {
  for (const s of SEED_ITEMS) store.state.items.push(actions.makeItem(s));
  store.log('info', 'SYSTEM', `first run: loaded ${SEED_ITEMS.length} upcoming releases and product pages`);
  store.flush();
}

function readPublic(file) {
  if (sea) {
    try {
      return Buffer.from(sea.getAsset(file));
    } catch {
      return null;
    }
  }
  const full = path.join(PUBLIC, file);
  return fs.existsSync(full) ? fs.readFileSync(full) : null;
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd[0], cmd[1], () => {});
}

function publicSettings() {
  const s = store.state.settings;
  return {
    telegramSet: Boolean(s.telegramToken),
    telegramConnected: Boolean(s.telegramToken && s.telegramChatId),
    telegramBot: s.telegramBotName || null,
    telegramError: s.telegramError || null,
    discordSet: Boolean(s.discordWebhook),
    briefTime: s.briefTime || '08:00',
    briefEnabled: s.briefEnabled !== false,
    scoutLinked: Boolean(relay.topic),
  };
}

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
    if (raw.length > 50_000) throw new UserError('That request is too large.');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new UserError('That request was not valid JSON.');
  }
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
    watching: items.filter((i) => i.active !== false && i.url).length,
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
    channels: alertChannels(store.state.settings),
    settings: publicSettings(),
    minInterval: MIN_INTERVAL_SEC,
  }),

  'POST /api/settings': async (req) => {
    const b = await readJson(req);
    const s = store.state.settings;
    if ('discordWebhook' in b) {
      const v = String(b.discordWebhook || '').trim();
      if (v && !/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(v)) {
        throw new UserError('That is not a Discord webhook link. It should start with https://discord.com/api/webhooks/');
      }
      s.discordWebhook = v || null;
    }
    if ('telegramToken' in b) {
      const v = String(b.telegramToken || '').trim();
      if (v && v !== s.telegramToken) {
        if (!/^\d{5,15}:[\w-]{30,60}$/.test(v)) throw new UserError('That is not a Telegram bot token. BotFather sends one that looks like 123456789:AA…');
        let me;
        try {
          me = await telegramCall(v, 'getMe', {});
        } catch (e) {
          throw new UserError(`Telegram rejected that token (${e.message}). Copy it again from BotFather.`);
        }
        s.telegramToken = v;
        s.telegramBotName = me.username;
        s.telegramChatId = null;
        s.telegramError = null;
        store.log('ok', 'TELEGRAM', `bot @${me.username} linked. send it /start in Telegram`);
      } else if (!v) {
        s.telegramToken = s.telegramChatId = s.telegramBotName = null;
      }
      bot.sync();
    }
    if ('briefTime' in b) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.briefTime || '')) throw new UserError('Brief time must look like 08:00.');
      s.briefTime = b.briefTime;
    }
    if ('briefEnabled' in b) s.briefEnabled = Boolean(b.briefEnabled);
    store.log('info', 'OPERATOR', 'settings saved');
    store.save();
    return publicSettings();
  },

  'POST /api/brief': async () => ({ lines: await digest.sendBrief() }),
  'POST /api/items': async (req) => actions.addItem(await readJson(req)),
  'POST /api/buys': async (req) => actions.addBuy(await readJson(req)),
  'POST /api/test-alert': async () => {
    const lines = await sendAlert(TEST_ALERT, store.state.settings);
    store.log('alert', 'OPERATOR', `test alert → ${lines.join(', ')}`);
    return { lines };
  },
};

const itemRoutes = {
  DELETE: (item) => {
    actions.removeItem(item);
    return { ok: true };
  },
  'POST check': async (item) => {
    await monitor.check(item);
    return item;
  },
  'POST toggle': (item) => actions.setActive(item, item.active === false),
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
    const body = readPublic(file);
    if (!body) return send(res, 404, 'Not found', 'text/plain');
    const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml' };
    return send(res, 200, body, types[file.split('.').pop()]);
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
      actions.removeBuy(buy);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'PATCH') return send(res, 200, actions.updateBuy(buy, await readJson(req)));
  }

  send(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e instanceof UserError) return send(res, 400, { error: e.message });
    const ref = newId();
    console.error(`[${ref}]`, e);
    send(res, 500, { error: `Something went wrong (ref ${ref}).` });
  });
});

// If the port is taken (e.g. the program is already open), try the next few.
let port = START_PORT;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < START_PORT + 10) {
    port += 1;
    server.listen(port, HOST);
  } else {
    console.error(`Could not start: ${e.message}`);
    process.exit(1);
  }
});
server.on('listening', () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  SYNDICATE.DROP is running.\n  Dashboard: ${url}\n  Data: ${path.dirname(store.file)}\n  Leave this window open. Close it to stop monitoring.\n`);
  monitor.start();
  digest.start();
  bot.sync();
  relay.start();
  if (process.env.SD_JUST_INSTALLED === '1') {
    store.log('ok', 'SYSTEM', 'installed and running');
    bot.notify('✅ SYNDICATE.DROP installed/updated and running on your PC. Your watchlist, orders and bot carried over. Send /help for commands.');
  }
  if (process.env.NO_BROWSER !== '1') openBrowser(url);
});

// One copy only: two would double every alert and fight over the Telegram bot.
fetch(`http://127.0.0.1:${START_PORT}/healthz`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.json())
  .then((j) => {
    if (j && j.ok && 'monitor' in j) {
      console.log(`\n  SYNDICATE.DROP is already running. Opening it: http://localhost:${START_PORT}\n`);
      if (process.env.NO_BROWSER !== '1') openBrowser(`http://localhost:${START_PORT}`);
      setTimeout(() => process.exit(0), 1500);
    } else server.listen(port, HOST);
  })
  .catch(() => server.listen(port, HOST));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    monitor.stop();
    digest.stop();
    bot.stop();
    relay.stop();
    store.flush();
    process.exit(0);
  });
}
