import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStock, retailerOf, STATUS } from '../src/detect.js';
import { shouldAlert, isDue, checkUrl } from '../src/monitor.js';
import { formatDropAlert, sendAlert, toPlain } from '../src/alerts.js';
import { buildDigest, briefDue, releaseReminders } from '../src/digest.js';
import { TelegramBot } from '../src/telegram.js';

const ld = (obj) => `<html><script type="application/ld+json">${JSON.stringify(obj)}</script><body>x</body></html>`;

test('JSON-LD InStock with price', () => {
  const r = detectStock(ld({ '@type': 'Product', offers: { price: '89.00', availability: 'https://schema.org/InStock' } }));
  assert.equal(r.status, STATUS.IN_STOCK);
  assert.equal(r.source, 'jsonld');
  assert.equal(r.price, 89);
});

test('JSON-LD OutOfStock beats Add to cart text on the page', () => {
  const html = ld({ offers: [{ availability: 'http://schema.org/OutOfStock', price: 249 }] }).replace('x', 'Add to cart');
  assert.equal(detectStock(html).status, STATUS.OUT);
});

test('JSON-LD PreOrder', () => {
  assert.equal(detectStock(ld({ '@graph': [{ offers: { availability: 'PreOrder' } }] })).status, STATUS.PREORDER);
});

test('malformed JSON-LD falls back to text', () => {
  const html = '<script type="application/ld+json">{bad</script><button>Add to cart</button>';
  assert.deepEqual([detectStock(html).status, detectStock(html).source], [STATUS.IN_STOCK, 'text']);
});

test('text: sold out wins over add to cart', () => {
  assert.equal(detectStock('<p>Sold out</p><button>Add to cart</button>').status, STATUS.OUT);
});

test('text in scripts is ignored', () => {
  assert.equal(detectStock('<script>var t="add to cart"</script><p>hello</p>').status, STATUS.UNKNOWN);
});

test('custom rules override everything', () => {
  const html = ld({ offers: { availability: 'InStock' } }) + '<div>Online purchase unavailable</div>';
  assert.equal(detectStock(html, { outOfStockText: 'online purchase unavailable' }).status, STATUS.OUT);
});

test('embedded Next.js data', () => {
  assert.equal(detectStock('<script id="__NEXT_DATA__">{"product":{"availability":"InStock"}}</script>').status, STATUS.IN_STOCK);
});

test('retailer names', () => {
  assert.equal(retailerOf('https://www.bigw.com.au/product/x/p/1'), 'BIG W');
  assert.equal(retailerOf('https://www.ebgames.com.au/product/x'), 'EB GAMES');
  assert.equal(retailerOf('https://shop.example.com/x'), 'SHOP.EXAMPLE.COM');
  assert.equal(retailerOf('not a url'), 'UNKNOWN');
});

test('alerts once per buyable state, re-arms after sell-out', () => {
  const item = { lastAlertStatus: null };
  assert.equal(shouldAlert(item, STATUS.IN_STOCK), true);
  item.lastAlertStatus = STATUS.IN_STOCK;
  assert.equal(shouldAlert(item, STATUS.IN_STOCK), false);
  assert.equal(shouldAlert(item, STATUS.OUT), false);
  assert.equal(shouldAlert({ lastAlertStatus: STATUS.PREORDER }, STATUS.IN_STOCK), true);
});

test('isDue respects interval floor, pause and block backoff', () => {
  const now = 1_000_000;
  assert.equal(isDue({ url: "https://a", intervalSec: 5, lastChecked: now - 10_000 }, now), false);
  assert.equal(isDue({ url: "https://a", intervalSec: 5, lastChecked: now - 16_000 }, now), true);
  assert.equal(isDue({ active: false }, now), false);
  assert.equal(isDue({}, now), false, "calendar entries are never fetched");
  assert.equal(isDue({ url: "https://a", intervalSec: 30, status: STATUS.BLOCKED, lastChecked: now - 60_000 }, now), false);
});

test('checkUrl maps 403 to BLOCKED and network failure to ERROR', async () => {
  const blocked = await checkUrl({ url: 'https://x.com' }, async () => ({ status: 403, ok: false }));
  assert.equal(blocked.status, STATUS.BLOCKED);
  const err = await checkUrl({ url: 'https://x.com' }, async () => { throw new Error('boom'); });
  assert.equal(err.status, STATUS.ERROR);
  const ok = await checkUrl({ url: 'https://x.com' }, async () => ({ status: 200, ok: true, text: async () => ld({ offers: { availability: 'InStock' } }) }));
  assert.equal(ok.status, STATUS.IN_STOCK);
});

test('alert text names the price cap breach', () => {
  const a = formatDropAlert({ name: 'ETB', retailer: 'BIG W', url: 'https://b', status: 'IN_STOCK', price: 120, maxPrice: 100 });
  assert.match(toPlain(a.text), /IN STOCK — ETB @ BIG W \$120\.00 \(over your \$100 cap\)\nhttps:\/\/b/);
});

test('telegram alert posts plain text to the owner chat', async () => {
  const calls = [];
  const fake = async (url, opts) => { calls.push([url, JSON.parse(opts.body)]); return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) }; };
  const lines = await sendAlert({ text: '@here **LIVE** x' }, { telegramToken: '1:abc', telegramChatId: '42' }, fake);
  assert.deepEqual(lines, ['telegram ok']);
  assert.equal(calls[0][0], 'https://api.telegram.org/bot1:abc/sendMessage');
  assert.deepEqual([calls[0][1].chat_id, calls[0][1].text], ['42', 'LIVE x']);
});

test('no channels set up: nothing sent, says so', async () => {
  assert.match((await sendAlert({ text: 'x' }, {}, async () => assert.fail('no fetch')))[0], /not connected/);
});

test('telegram bot binds to the first /start and ignores strangers', async () => {
  const sent = [];
  const store = { state: { items: [], buys: [], settings: { telegramToken: 't' } }, log() {}, save() {} };
  const fake = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ ok: true, result: {} }) }; };
  const bot = new TelegramBot({ store, fetchImpl: fake });
  await bot.handle({ chat: { id: 7 }, text: '/brief' });
  assert.equal(sent.length, 0, 'unbound bot ignores everything but /start');
  await bot.handle({ chat: { id: 7, first_name: 'R' }, text: '/start' });
  assert.equal(store.state.settings.telegramChatId, '7');
  await bot.handle({ chat: { id: 99 }, text: '/brief' });
  assert.equal(sent.length, 1, 'stranger gets nothing');
  await bot.handle({ chat: { id: 7 }, text: '/orders' });
  assert.match(sent[1].text, /ON THE WAY/);
});

const NOW = new Date(2026, 10, 11, 9, 0).getTime(); // 11 Nov 2026, 9am local
const sample = () => ({
  items: [
    { id: 'a', name: 'Ascended Heroes ETB', retailer: 'BIG W', releaseDate: '2026-11-12', status: 'OUT_OF_STOCK', url: 'https://x' },
    { id: 'b', name: 'Far Box', retailer: 'TARGET', releaseDate: '2026-12-30', url: 'https://y' },
    { id: 'c', name: 'Live ETB', retailer: 'JB HI-FI', status: 'IN_STOCK', price: 89, url: 'https://z' },
  ],
  buys: [
    { itemName: 'ETB', retailer: 'BIG W', qty: 2, unitCost: 8900, soldUnitPrice: null, orderStatus: 'SHIPPED', eta: '2026-11-09', tracking: 'AP123' },
    { itemName: 'Box', retailer: 'EB', qty: 1, unitCost: 25000, soldUnitPrice: 40000, fees: 3000, orderStatus: 'DELIVERED' },
  ],
  settings: {},
});

test('daily brief covers releases, live stock, orders and money', () => {
  const t = toPlain(buildDigest(sample(), NOW).text);
  assert.match(t, /TOMORROW \(2026-11-12\) — Ascended Heroes ETB @ BIG W/);
  assert.doesNotMatch(t, /Far Box/, '49 days out is beyond 14');
  assert.match(t, /Live ETB @ JB HI-FI \$89\.00/);
  assert.match(t, /2 × ETB \(BIG W\) — SHIPPED, ETA 2026-11-09 — OVERDUE, chase it, tracking AP123/);
  assert.match(t, /net profit on sold stock: \+\$120\.00/);
  assert.match(t, /unsold stock: 2 items \(\$178\.00 tied up\)/);
});

test('brief is due once a day after the chosen time', () => {
  assert.equal(briefDue({ briefTime: '08:00' }, NOW), true);
  assert.equal(briefDue({ briefTime: '10:00' }, NOW), false);
  assert.equal(briefDue({ briefTime: '08:00', lastBriefDate: '2026-11-11' }, NOW), false);
  assert.equal(briefDue({ briefEnabled: false }, NOW), false);
});

test('release reminders: evening before from 6pm, and on the day', () => {
  const s = sample();
  assert.equal(releaseReminders(s, NOW).length, 0);
  const eve = releaseReminders(s, new Date(2026, 10, 11, 18, 5).getTime());
  assert.deepEqual(eve.map((r) => r.key), ['eve:a:2026-11-12']);
  const day = releaseReminders(s, new Date(2026, 10, 12, 7, 0).getTime());
  assert.deepEqual(day.map((r) => r.key), ['day:a:2026-11-12']);
});

import { createActions } from '../src/actions.js';
import { parseRelayMessage } from '../src/relay.js';

function fakeBotEnv() {
  const sent = [];
  const fake = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push({ method: url.split('/').pop(), body });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const store = { state: { items: [], buys: [], log: [], settings: { telegramToken: 't', telegramChatId: '7' } }, log() {}, save() {} };
  const actions = createActions({ store, monitor: null, alert: null });
  const bot = new TelegramBot({ store, actions, monitor: { check: async () => {} }, fetchImpl: fake });
  const say = (text) => bot.handle({ chat: { id: 7 }, text });
  return { sent, store, bot, say, last: () => sent[sent.length - 1].body.text };
}

test('telegram: watch, list, pause and remove a product', async () => {
  const { store, say, last } = fakeBotEnv();
  await say('/watch https://www.target.com.au/p/flowing-fists-elite-trainer-box/12345 2027-02-05 $99');
  assert.match(last(), /Watching #\w{4} Flowing Fists Elite Trainer Box @ TARGET, max \$99/);
  const item = store.state.items[0];
  assert.deepEqual([item.releaseDate, item.maxPrice], ['2027-02-05', 99]);
  await say('/list');
  assert.match(last(), new RegExp(`#${item.id.slice(0, 4)} Flowing Fists`));
  await say(`/pause #${item.id.slice(0, 4)}`);
  assert.equal(item.active, false);
  await say(`/remove ${item.id.slice(0, 4)}`);
  assert.equal(store.state.items.length, 0);
});

test('telegram: bad input gets a plain explanation, not a crash', async () => {
  const { say, last } = fakeBotEnv();
  await say('/watch not-a-link');
  assert.match(last(), /^⚠ Paste the full product link/);
  await say('/pause #zz');
  assert.match(last(), /Give the #id/);
  await say('/bought two');
  assert.match(last(), /Send \/bought/);
});

test('telegram: order lifecycle bought → shipped → delivered → sold', async () => {
  const { store, say, last } = fakeBotEnv();
  await say('/bought 2 $89 Delta Reign ETB');
  const buy = store.state.buys[0];
  const id = buy.id.slice(0, 4);
  await say(`/shipped #${id} 2026-11-20 AP123456`);
  assert.deepEqual([buy.orderStatus, buy.eta, buy.tracking], ['SHIPPED', '2026-11-20', 'AP123456']);
  await say(`/orders`);
  assert.match(last(), /ON THE WAY\n#\w{4} 2 × Delta Reign ETB .* SHIPPED, ETA 2026-11-20, AP123456/);
  await say(`/delivered #${id}`);
  await say(`/sold #${id} 150 12`);
  assert.match(last(), /Profit \+\$110\.00/);
});

test('telegram: scout suggestion WATCH button adds it; only the owner can press', async () => {
  const { store, bot, sent } = fakeBotEnv();
  await bot.suggest({ name: 'FF ETB', url: 'https://www.bigw.com.au/product/ff/p/1', retailer: 'BIG W', maxPrice: 99 });
  const key = sent[0].body.reply_markup.inline_keyboard[0][0].callback_data;
  await bot.handleButton({ id: 'q', data: key, message: { chat: { id: 99 }, message_id: 1, text: 'x' } });
  assert.equal(store.state.items.length, 0, 'stranger cannot add');
  await bot.handleButton({ id: 'q', data: key, message: { chat: { id: 7 }, message_id: 1, text: 'x' } });
  assert.equal(store.state.items[0].url, 'https://www.bigw.com.au/product/ff/p/1');
  assert.ok(sent.some((s) => s.method === 'editMessageText' && /Watching/.test(s.body.text)));
});

test('relay: accepts known retailers, rejects junk, JB and duplicates', () => {
  const ok = parseRelayMessage(JSON.stringify({ name: 'FF ETB', url: 'https://www.kmart.com.au/product/x-1/', price: 99, releaseDate: '2027-02-05' }), []);
  assert.equal(ok.type, 'suggest');
  assert.deepEqual([ok.item.retailer, ok.item.maxPrice], ['KMART', 99]);
  assert.equal(parseRelayMessage('{"url":"https://evil.example.com/x"}', []), null);
  assert.equal(parseRelayMessage('{"url":"https://www.jbhifi.com.au/products/x"}', []), null);
  assert.equal(parseRelayMessage('{"url":"http://www.kmart.com.au/x"}', []), null);
  assert.equal(parseRelayMessage('not json', []), null);
  assert.equal(parseRelayMessage(JSON.stringify({ url: 'https://www.kmart.com.au/product/x-1/' }), [{ url: 'https://www.kmart.com.au/product/x-1/' }]), null);
  assert.deepEqual(parseRelayMessage('{"note":"nothing new"}', []), { type: 'note', text: 'nothing new' });
});

import fsx from 'node:fs';
import osx from 'node:os';
import pathx from 'node:path';
import { findDataDirs, newestDataDir, copyDir, installDir } from '../src/install.js';

test('installer finds the newest existing data folder and copies it', () => {
  const home = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'sdinst-'));
  const mk = (rel, mtime) => {
    const d = pathx.join(home, rel, 'SyndicateDrop-data');
    fsx.mkdirSync(d, { recursive: true });
    fsx.writeFileSync(pathx.join(d, 'state.json'), JSON.stringify({ rel }));
    fsx.utimesSync(pathx.join(d, 'state.json'), mtime, mtime);
    return d;
  };
  const older = mk('Documents/SyndicateDrop/SyndicateDrop', new Date(2026, 10, 1));
  const newer = mk('Desktop/SyndicateDrop', new Date(2026, 10, 11));
  fsx.mkdirSync(pathx.join(home, 'Documents/empty/SyndicateDrop-data'), { recursive: true }); // no state.json: ignored
  mk('Documents/a/b/c/d/e/f', new Date(2026, 10, 12)); // too deep: ignored
  const found = findDataDirs([pathx.join(home, 'Documents'), pathx.join(home, 'Desktop'), pathx.join(home, 'missing')]);
  assert.deepEqual(found.sort(), [older, newer].sort());
  assert.equal(newestDataDir(found), newer);
  const dest = pathx.join(home, 'install', 'SyndicateDrop-data');
  copyDir(newer, dest);
  assert.deepEqual(JSON.parse(fsx.readFileSync(pathx.join(dest, 'state.json'), 'utf8')), { rel: 'Desktop/SyndicateDrop' });
  assert.equal(installDir({ LOCALAPPDATA: 'C:\\Users\\R\\AppData\\Local' }).endsWith('SyndicateDrop'), true);
  fsx.rmSync(home, { recursive: true, force: true });
});
