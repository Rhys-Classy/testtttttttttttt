import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStock, retailerOf, STATUS } from '../src/detect.js';
import { shouldAlert, isDue, checkUrl } from '../src/monitor.js';
import { formatDropAlert } from '../src/alerts.js';

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
  assert.equal(isDue({ intervalSec: 5, lastChecked: now - 10_000 }, now), false);
  assert.equal(isDue({ intervalSec: 5, lastChecked: now - 16_000 }, now), true);
  assert.equal(isDue({ active: false }, now), false);
  assert.equal(isDue({ intervalSec: 30, status: STATUS.BLOCKED, lastChecked: now - 60_000 }, now), false);
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
  assert.match(a.sms, /IN STOCK: ETB @ BIG W \$120\.00 \(over your \$100 cap\)/);
});
