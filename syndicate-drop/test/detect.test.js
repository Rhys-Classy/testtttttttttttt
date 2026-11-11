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
