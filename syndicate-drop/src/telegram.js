// Two-way Telegram bot by long polling: no server, no webhook, nothing to pay for.
// The first chat that sends /start becomes the owner; every other chat is ignored.
// Everything the dashboard can do, the bot can do, so the PC never needs touching.
import { telegramCall, sendTelegram } from './alerts.js';
import { buildDigest, buildSection } from './digest.js';
import { UserError } from './actions.js';
import { BUYABLE } from './detect.js';

const HELP = `SYNDICATE.DROP bot

UPDATES
/brief — full update now
/upcoming — releases in the next 14 days
/live — what is buyable right now
/orders — orders on the way

WATCHLIST
/list — everything watched, with #ids
/watch <link> [YYYY-MM-DD] [max$] — watch a product page
/calendar <YYYY-MM-DD> <name> — release date only
/check #id — check a page now
/pause #id · /resume #id · /remove #id

ORDERS
/bought <qty> <$each> <name> — log a buy
/shipped #id [YYYY-MM-DD eta] [tracking]
/delivered #id
/sold #id <$each> [fees$]

Ids are the first 4 characters shown after # in /list and /orders.`;

const short = (id) => `#${id.slice(0, 4)}`;
const money = (c) => `$${(c / 100).toFixed(2)}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function findBy(list, ref) {
  const key = String(ref || '').replace(/^#/, '').toLowerCase();
  if (key.length < 3) throw new UserError('Give the #id from /list or /orders, e.g. /pause #a1b2');
  const hits = list.filter((x) => x.id.startsWith(key));
  if (!hits.length) throw new UserError(`Nothing matches #${key}. Send /list or /orders to see ids.`);
  if (hits.length > 1) throw new UserError(`#${key} matches more than one. Use more characters.`);
  return hits[0];
}

export class TelegramBot {
  constructor({ store, actions, monitor, fetchImpl = fetch }) {
    this.store = store;
    this.actions = actions;
    this.monitor = monitor;
    this.fetchImpl = fetchImpl;
    this.running = false;
    this.token = null;
  }

  get settings() {
    return this.store.state.settings;
  }

  get connected() {
    return Boolean(this.settings.telegramToken && this.settings.telegramChatId);
  }

  /** (Re)start polling whenever the token changes. */
  sync() {
    const token = this.settings.telegramToken || null;
    if (token === this.token && this.running) return;
    this.token = token;
    this.offset = 0;
    if (!token) {
      this.running = false;
      return;
    }
    if (!this.running) {
      this.running = true;
      this.loop();
    }
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running && this.token) {
      const token = this.token;
      try {
        const updates = await telegramCall(token, 'getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, this.fetchImpl, 35000);
        for (const u of updates) {
          this.offset = u.update_id + 1;
          if (u.message?.text) await this.handle(u.message);
          else if (u.callback_query) await this.handleButton(u.callback_query);
        }
        this.settings.telegramError = null;
      } catch (e) {
        if (token !== this.token) continue;
        if (this.settings.telegramError !== e.message) {
          this.settings.telegramError = e.message;
          this.store.log('warn', 'TELEGRAM', `bot error: ${e.message}`);
          this.store.save();
        }
        await new Promise((r) => setTimeout(r, /unauthorized|not found/i.test(e.message) ? 60000 : 5000));
      }
    }
  }

  // ---- outbound -------------------------------------------------------------

  reply(text, extra) {
    if (!this.connected) return Promise.resolve();
    return sendTelegram(this.settings, text, this.fetchImpl, extra).catch((e) => this.store.log('warn', 'TELEGRAM', `send failed: ${e.message}`));
  }

  notify(text) {
    return this.reply(text);
  }

  /** A product found by the scout, with WATCH / SKIP buttons. */
  async suggest(item) {
    const s = this.settings;
    const key = Math.random().toString(36).slice(2, 10);
    s.suggestions = { ...(s.suggestions || {}), [key]: item };
    const keys = Object.keys(s.suggestions);
    if (keys.length > 50) for (const k of keys.slice(0, keys.length - 50)) delete s.suggestions[k];
    this.store.save();
    const price = item.price ? ` $${item.price.toFixed(2)}` : '';
    const text = `🔎 SCOUT FOUND — ${item.name} @ ${item.retailer}${price}${item.preorder ? ' (pre-order open)' : ''}${item.releaseDate ? `\nreleases ${item.releaseDate}` : ''}\n${item.url}`;
    return this.reply(text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `➕ WATCH${item.maxPrice ? ` (max $${item.maxPrice})` : ''}`, callback_data: `w:${key}` }, { text: '✕ SKIP', callback_data: `s:${key}` }],
          [{ text: 'OPEN ↗', url: item.url }],
        ],
      },
    });
  }

  // ---- inbound --------------------------------------------------------------

  async handleButton(q) {
    const s = this.settings;
    const chatId = String(q.message?.chat?.id || '');
    const answer = (text) => telegramCall(s.telegramToken, 'answerCallbackQuery', { callback_query_id: q.id, text }, this.fetchImpl).catch(() => {});
    if (!s.telegramChatId || chatId !== String(s.telegramChatId)) return answer('Not your bot.');
    const [act, key] = String(q.data || '').split(':');
    const item = s.suggestions?.[key];
    if (!item) return answer('That suggestion has expired.');
    delete s.suggestions[key];
    this.store.save();
    let result;
    if (act === 'w') {
      try {
        const added = this.actions.addItem({ ...item, kind: item.kind }, 'TELEGRAM');
        result = `✅ Watching ${short(added.id)}`;
      } catch (e) {
        result = e instanceof UserError ? `⚠ ${e.message}` : '⚠ Could not add it.';
      }
    } else {
      result = '✕ Skipped';
    }
    await answer(result);
    await telegramCall(s.telegramToken, 'editMessageText', {
      chat_id: s.telegramChatId,
      message_id: q.message.message_id,
      text: `${q.message.text}\n\n${result}`,
      disable_web_page_preview: true,
    }, this.fetchImpl).catch(() => {});
  }

  async handle(message) {
    const s = this.settings;
    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase();

    if (!s.telegramChatId) {
      if (cmd !== '/start') return;
      s.telegramChatId = chatId;
      this.store.log('ok', 'TELEGRAM', `bot connected to ${message.chat.first_name || 'your chat'}`);
      this.store.save();
      return this.reply(`Connected. Drop alerts and a daily brief at ${s.briefTime || '08:00'} will come here.\n\n${HELP}`);
    }
    if (chatId !== String(s.telegramChatId)) return;

    try {
      const out = await this.run(cmd, args, text);
      if (out) await this.reply(out);
    } catch (e) {
      await this.reply(e instanceof UserError ? `⚠ ${e.message}` : `⚠ Something went wrong: ${e.message}`);
    }
  }

  async run(cmd, args, text) {
    const now = Date.now();
    const state = this.store.state;
    const items = () => state.items;
    const buys = () => state.buys;
    const A = this.actions;

    switch (cmd) {
      case '/brief': return buildDigest(state, now).text;
      case '/upcoming': return buildSection('upcoming', state, now);
      case '/live': return buildSection('live', state, now);

      case '/orders': {
        const open = buys().filter((b) => !['DELIVERED', 'CANCELLED'].includes(b.orderStatus || 'DELIVERED'));
        const unsold = buys().filter((b) => b.orderStatus === 'DELIVERED' && b.soldUnitPrice === null);
        const line = (b) => `${short(b.id)} ${b.qty} × ${b.itemName} (${b.retailer}) — ${b.orderStatus}${b.eta ? `, ETA ${b.eta}` : ''}${b.tracking ? `, ${b.tracking}` : ''}`;
        return [
          'ON THE WAY', ...(open.length ? open.map(line) : ['none']),
          '', 'DELIVERED, UNSOLD', ...(unsold.length ? unsold.map((b) => `${short(b.id)} ${b.qty} × ${b.itemName} — cost ${money(b.unitCost)} ea`) : ['none']),
        ].join('\n');
      }

      case '/list': {
        if (!items().length) return 'Nothing on the watchlist. Send /watch <link>.';
        return items().map((i) => {
          const st = !i.url ? 'CALENDAR' : i.active === false ? 'PAUSED' : i.status || 'CHECKING';
          return `${short(i.id)} ${BUYABLE.has(i.status) ? '🟢' : ''}${i.name} — ${i.retailer} — ${st}${i.releaseDate ? ` — ${i.releaseDate}` : ''}`;
        }).join('\n');
      }

      case '/watch': {
        const [url, ...rest] = args;
        if (!url) throw new UserError('Send /watch <product link> [YYYY-MM-DD] [max$]');
        const releaseDate = rest.find((a) => DATE.test(a));
        const maxPrice = rest.find((a) => /^\$?\d+(\.\d+)?$/.test(a));
        let pathname = '';
        try { pathname = new URL(url).pathname; } catch { /* addItem explains a bad link */ }
        const name = decodeURIComponent(pathname.split('/').filter((p) => p && !/^\d+$/.test(p) && p !== 'p' && p !== 'product' && p !== 'products').pop() || 'Product')
          .replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
        const item = A.addItem({ url, releaseDate, maxPrice, name }, 'TELEGRAM');
        return `✅ Watching ${short(item.id)} ${item.name} @ ${item.retailer}${item.maxPrice ? `, max $${item.maxPrice}` : ''}. First check running now.`;
      }

      case '/calendar': {
        const [date, ...name] = args;
        if (!DATE.test(date || '') || !name.length) throw new UserError('Send /calendar YYYY-MM-DD <name>');
        const item = A.addItem({ releaseDate: date, name: name.join(' ') }, 'TELEGRAM');
        return `✅ Added ${short(item.id)} ${item.name} on ${date}. You'll get a reminder the evening before and on the day.`;
      }

      case '/check': {
        const item = findBy(items(), args[0]);
        if (!item.url) throw new UserError('That is a calendar entry; there is no page to check.');
        await this.monitor.check(item);
        return `${item.name} @ ${item.retailer}: ${item.status}${item.price ? ` $${item.price.toFixed(2)}` : ''}`;
      }
      case '/pause': case '/resume': {
        const item = A.setActive(findBy(items(), args[0]), cmd === '/resume', 'TELEGRAM');
        return `${cmd === '/resume' ? '▶ Resumed' : '‖ Paused'} ${item.name}`;
      }
      case '/remove': {
        const item = findBy(items(), args[0]);
        A.removeItem(item, 'TELEGRAM');
        return `✕ Removed ${item.name}`;
      }

      case '/bought': {
        const [qty, cost, ...name] = args;
        if (!qty || !cost || !name.length) throw new UserError('Send /bought <qty> <$each> <name>, e.g. /bought 2 89 Delta Reign ETB');
        const buy = A.addBuy({ qty, unitCost: cost.replace(/^\$/, ''), itemName: name.join(' ') }, 'TELEGRAM');
        return `🧾 Logged ${short(buy.id)} ${buy.qty} × ${buy.itemName} at ${money(buy.unitCost)}. When it ships: /shipped ${short(buy.id)} [eta] [tracking]`;
      }
      case '/shipped': {
        const buy = findBy(buys(), args[0]);
        const eta = args.slice(1).find((a) => DATE.test(a));
        const tracking = args.slice(1).filter((a) => !DATE.test(a)).join(' ');
        A.updateBuy(buy, { orderStatus: 'SHIPPED', ...(eta ? { eta } : {}), ...(tracking ? { tracking } : {}) }, { notify: false });
        return `🚚 ${buy.itemName} shipped${buy.eta ? `, ETA ${buy.eta}` : ''}${buy.tracking ? `, tracking ${buy.tracking}` : ''}. It'll show in the daily brief until delivered.`;
      }
      case '/delivered': {
        const buy = findBy(buys(), args[0]);
        A.updateBuy(buy, { orderStatus: 'DELIVERED' }, { notify: false });
        return `📦 ${buy.itemName} delivered. When it sells: /sold ${short(buy.id)} <$each> [fees$]`;
      }
      case '/sold': {
        const buy = findBy(buys(), args[0]);
        if (!args[1]) throw new UserError('Send /sold #id <$each> [fees$]');
        A.updateBuy(buy, { soldUnitPrice: args[1].replace(/^\$/, ''), fees: (args[2] || '0').replace(/^\$/, ''), orderStatus: buy.orderStatus === 'CANCELLED' ? 'CANCELLED' : 'DELIVERED' }, { notify: false });
        const pl = buy.soldUnitPrice * buy.qty - buy.unitCost * buy.qty - (buy.fees || 0);
        return `💰 Sold ${buy.qty} × ${buy.itemName} at ${money(buy.soldUnitPrice)} ea. Profit ${pl >= 0 ? '+' : '-'}${money(Math.abs(pl))}.`;
      }

      default:
        return HELP;
    }
  }
}
