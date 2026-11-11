// Every change a person can make, shared by the dashboard and the Telegram bot,
// so both validate and log the same way.
import { newId } from './store.js';
import { retailerOf } from './detect.js';
import { MIN_INTERVAL_SEC } from './monitor.js';

export class UserError extends Error {}

export const KINDS = ['ETB', 'BOOSTER_BOX', 'BOOSTER_BUNDLE', 'COLLECTION', 'TIN', 'OTHER'];
export const ORDER_STATUSES = ['ORDERED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanText(v, max = 140) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function toCents(v, field) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/^\$/, ''));
  if (!Number.isFinite(n) || n < 0) throw new UserError(`${field} must be a dollar amount.`);
  return Math.round(n * 100);
}

export function checkProductUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new UserError('Paste the full product link, starting with https://');
  }
  if (u.protocol !== 'https:') throw new UserError('Product links must start with https://');
  if (!u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) {
    throw new UserError('That does not look like a shop website.');
  }
  return u.toString();
}

export function createActions({ store, monitor, alert }) {
  const save = () => store.save();

  function makeItem(b) {
    const releaseDate = DATE.test(b.releaseDate || '') ? b.releaseDate : null;
    const rawUrl = String(b.url || '').trim();
    if (!rawUrl && !releaseDate) throw new UserError('Paste a product link, or give a release date to add it to the calendar.');
    const url = rawUrl ? checkProductUrl(rawUrl) : null;
    if (url && store.state.items.some((i) => i.url === url)) throw new UserError('That product is already on the watchlist.');
    return {
      id: newId(),
      name: cleanText(b.name) || 'Unnamed product',
      url,
      retailer: url ? retailerOf(url) : 'CALENDAR',
      kind: KINDS.includes(b.kind) ? b.kind : 'OTHER',
      releaseDate,
      intervalSec: Math.max(MIN_INTERVAL_SEC, Math.min(3600, Number(b.intervalSec) || 30)),
      maxPrice: b.maxPrice ? Number(String(b.maxPrice).replace(/^\$/, '')) || null : null,
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
  }

  function addItem(b, who = 'OPERATOR') {
    const item = makeItem(b);
    store.state.items.push(item);
    store.log('info', who, item.url ? `watching ${item.name} @ ${item.retailer}` : `added ${item.name} to the calendar`);
    save();
    if (item.url && monitor) monitor.check(item);
    return item;
  }

  function removeItem(item, who = 'OPERATOR') {
    store.state.items = store.state.items.filter((i) => i !== item);
    store.log('info', who, `stopped watching ${item.name}`);
    save();
  }

  function setActive(item, active, who = 'OPERATOR') {
    item.active = active;
    store.log('info', who, `${active ? 'resumed' : 'paused'} ${item.name}`);
    save();
    return item;
  }

  function addBuy(b, who = 'LEDGER') {
    const qty = Math.round(Number(b.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) throw new UserError('Quantity must be between 1 and 999.');
    const unitCost = toCents(b.unitCost, 'Unit cost');
    if (unitCost === null) throw new UserError('Enter what you paid for each one.');
    const buy = {
      id: newId(),
      itemName: cleanText(b.itemName) || 'Unnamed product',
      retailer: cleanText(b.retailer, 40) || 'UNKNOWN',
      qty,
      unitCost,
      soldUnitPrice: toCents(b.soldUnitPrice, 'Sold price'),
      fees: toCents(b.fees, 'Fees') || 0,
      orderStatus: ORDER_STATUSES.includes(b.orderStatus) ? b.orderStatus : 'ORDERED',
      eta: DATE.test(b.eta || '') ? b.eta : null,
      tracking: cleanText(b.tracking, 80) || null,
      date: new Date().toISOString().slice(0, 10),
    };
    store.state.buys.unshift(buy);
    store.log('info', who, `bought ${qty} × ${buy.itemName} at $${(unitCost / 100).toFixed(2)}`);
    save();
    return buy;
  }

  function removeBuy(buy) {
    store.state.buys = store.state.buys.filter((b) => b !== buy);
    save();
  }

  /** @param {{notify?: boolean}} opts  notify=false when the change came from Telegram itself */
  function updateBuy(buy, b, { notify = true } = {}) {
    if ('soldUnitPrice' in b) {
      buy.soldUnitPrice = toCents(b.soldUnitPrice, 'Sold price');
      if (buy.soldUnitPrice !== null) store.log('ok', 'LEDGER', `sold ${buy.qty} × ${buy.itemName} at $${(buy.soldUnitPrice / 100).toFixed(2)}`);
    }
    if ('fees' in b) buy.fees = toCents(b.fees, 'Fees') || 0;
    if ('eta' in b) buy.eta = DATE.test(b.eta || '') ? b.eta : null;
    if ('tracking' in b) buy.tracking = cleanText(b.tracking, 80) || null;
    if ('orderStatus' in b) {
      if (!ORDER_STATUSES.includes(b.orderStatus)) throw new UserError('Unknown order status.');
      if (b.orderStatus !== buy.orderStatus) {
        buy.orderStatus = b.orderStatus;
        const icon = { SHIPPED: '🚚', DELIVERED: '📦', CANCELLED: '✕', ORDERED: '🧾' }[b.orderStatus];
        const msg = `${icon} **${b.orderStatus}** — ${buy.qty} × ${buy.itemName} (${buy.retailer})${buy.eta && b.orderStatus === 'SHIPPED' ? `, ETA ${buy.eta}` : ''}${buy.tracking ? `, tracking ${buy.tracking}` : ''}`;
        store.log('info', 'LEDGER', msg.replace(/\*\*/g, ''));
        if (notify && alert) alert({ text: msg }, store.state.settings);
      }
    }
    save();
    return buy;
  }

  return { makeItem, addItem, removeItem, setActive, addBuy, removeBuy, updateBuy };
}
