// The update bot's content: a morning brief, release-eve and release-day
// reminders, and the sections the Telegram commands reply with.
import { BUYABLE } from './detect.js';

const DAY = 86400000;

/** YYYY-MM-DD for a timestamp in the computer's local timezone. */
export function localDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(toDate + 'T00:00:00Z') - Date.parse(fromDate + 'T00:00:00Z')) / DAY);
}

const money = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const active = (state) => state.items.filter((i) => i.active !== false);
const inTransit = (state) => state.buys.filter((b) => (b.orderStatus || 'DELIVERED') !== 'DELIVERED');

function upcomingLines(state, today) {
  const list = active(state)
    .filter((i) => i.releaseDate && daysBetween(today, i.releaseDate) >= 0 && daysBetween(today, i.releaseDate) <= 14)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  if (!list.length) return ['> nothing with a release date in the next 14 days.'];
  return list.map((i) => {
    const d = daysBetween(today, i.releaseDate);
    return `> ${d === 0 ? 'TODAY' : d === 1 ? 'TOMORROW' : `in ${d}d`} (${i.releaseDate}) — ${i.name}${i.url ? ` @ ${i.retailer}` : ''}`;
  });
}

function liveLines(state) {
  const list = active(state).filter((i) => BUYABLE.has(i.status));
  if (!list.length) return ['> nothing buyable right now.'];
  return list.map((i) => `> ${i.name} @ ${i.retailer}${i.price ? ` $${i.price.toFixed(2)}` : ''}\n  ${i.url}`);
}

function orderLines(state, today) {
  const list = inTransit(state);
  if (!list.length) return ['> no orders on the way.'];
  return list.map((b) => {
    const eta = b.eta ? (daysBetween(today, b.eta) < 0 ? `ETA ${b.eta} — OVERDUE, chase it` : `ETA ${b.eta}`) : 'no ETA';
    return `> ${b.qty} × ${b.itemName} (${b.retailer}) — ${b.orderStatus}, ${eta}${b.tracking ? `, tracking ${b.tracking}` : ''}`;
  });
}

function moneyLines(state) {
  let profit = 0;
  let unsoldCost = 0;
  let unsoldQty = 0;
  for (const b of state.buys) {
    const cost = b.unitCost * b.qty;
    if (b.soldUnitPrice !== null) profit += b.soldUnitPrice * b.qty - cost - (b.fees || 0);
    else {
      unsoldCost += cost;
      unsoldQty += b.qty;
    }
  }
  const lines = [
    `> unsold stock: ${unsoldQty} items (${money(unsoldCost)} tied up)`,
    `> net profit on sold stock: ${profit >= 0 ? '+' : ''}${money(profit)}`,
  ];
  const blocked = active(state).filter((i) => i.status === 'BLOCKED');
  if (blocked.length) lines.push(`> ⚠ blocked by retailer: ${[...new Set(blocked.map((i) => i.retailer))].join(', ')}`);
  return lines;
}

const SECTIONS = {
  upcoming: ['// NEXT 14 DAYS', upcomingLines],
  live: ['// LIVE NOW', liveLines],
  orders: ['// ON THE WAY', orderLines],
  money: ['// STOCK & MONEY', moneyLines],
};

export function buildSection(name, state, now) {
  const [title, fn] = SECTIONS[name];
  return [`**${title}**`, ...fn(state, localDate(now))].join('\n');
}

export function buildDigest(state, now) {
  const parts = [`**SYNDICATE.DROP // DAILY BRIEF // ${localDate(now)}**`];
  for (const name of ['upcoming', 'live', 'orders', 'money']) parts.push('', buildSection(name, state, now));
  return { text: parts.join('\n') };
}

/** Release reminders due now: the evening before (from 6pm) and the day of. */
export function releaseReminders(state, now) {
  const today = localDate(now);
  const hour = new Date(now).getHours();
  const out = [];
  for (const i of active(state)) {
    if (!i.releaseDate) continue;
    const d = daysBetween(today, i.releaseDate);
    const kind = d === 1 && hour >= 18 ? 'eve' : d === 0 ? 'day' : null;
    if (!kind) continue;
    const eve = kind === 'eve';
    out.push({
      key: `${kind}:${i.id}:${i.releaseDate}`,
      msg: {
        text: `${eve ? '⏰ **RELEASES TOMORROW**' : '🚨 **RELEASE DAY**'} — ${i.name}${i.url ? ` @ **${i.retailer}**` : ''}\n${eve ? '> log in to each retailer, save your card and address tonight.' : i.url ? '> monitor is watching. phone on loud.' : '> calendar only: add the retailer product links to the watchlist.'}${i.url ? `\n${i.url}` : ''}`,
      },
    });
  }
  return out;
}

/** True once per day, at or after the chosen HH:MM. */
export function briefDue(settings, now) {
  if (settings.briefEnabled === false) return false;
  const [h, m] = (settings.briefTime || '08:00').split(':').map(Number);
  const d = new Date(now);
  const afterTime = d.getHours() > h || (d.getHours() === h && d.getMinutes() >= m);
  return afterTime && settings.lastBriefDate !== localDate(now);
}

export class Digest {
  constructor({ store, alert }) {
    this.store = store;
    this.alert = alert;
  }

  start() {
    this.timer = setInterval(() => this.tick(Date.now()), 60000);
    setTimeout(() => this.tick(Date.now()), 5000);
  }

  stop() {
    clearInterval(this.timer);
  }

  async sendBrief(now = Date.now()) {
    const lines = await this.alert(buildDigest(this.store.state, now), this.store.state.settings);
    this.store.log('alert', 'BRIEF_BOT', `daily brief → ${lines.join(', ')}`);
    return lines;
  }

  async tick(now) {
    const s = this.store.state.settings;
    if (briefDue(s, now)) {
      s.lastBriefDate = localDate(now);
      this.store.save();
      await this.sendBrief(now);
    }
    const sent = new Set(s.remindersSent || []);
    let changed = false;
    for (const r of releaseReminders(this.store.state, now)) {
      if (sent.has(r.key)) continue;
      sent.add(r.key);
      changed = true;
      const lines = await this.alert(r.msg, s);
      this.store.log('alert', 'BRIEF_BOT', `${r.key.startsWith('eve') ? 'release-eve' : 'release-day'} reminder → ${lines.join(', ')}`);
    }
    if (changed) {
      s.remindersSent = [...sent].slice(-200);
      this.store.save();
    }
  }
}
