// Two-way Telegram bot by long polling: no server, no webhook, nothing to pay for.
// The first chat that sends /start becomes the owner; every other chat is ignored.
import { telegramCall, sendTelegram } from './alerts.js';
import { buildDigest, buildSection } from './digest.js';

const HELP = [
  'SYNDICATE.DROP bot',
  '/brief — full update now',
  '/upcoming — releases in the next 14 days',
  '/orders — orders on the way',
  '/live — what is buyable right now',
  '/help — this list',
].join('\n');

export class TelegramBot {
  constructor({ store, fetchImpl = fetch }) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.running = false;
    this.token = null;
  }

  get settings() {
    return this.store.state.settings;
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
        const updates = await telegramCall(token, 'getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message'] }, this.fetchImpl, 35000);
        for (const u of updates) {
          this.offset = u.update_id + 1;
          if (u.message?.text) await this.handle(u.message);
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

  async handle(message) {
    const s = this.settings;
    const chatId = String(message.chat.id);
    const cmd = message.text.trim().split(/[\s@]/)[0].toLowerCase();

    if (!s.telegramChatId) {
      if (cmd !== '/start') return;
      s.telegramChatId = chatId;
      this.store.log('ok', 'TELEGRAM', `bot connected to ${message.chat.first_name || 'your chat'}`);
      this.store.save();
      return this.reply(`Connected. Drop alerts and a daily brief at ${s.briefTime || '08:00'} will come here.\n\n${HELP}`);
    }
    if (chatId !== String(s.telegramChatId)) return;

    const now = Date.now();
    const state = this.store.state;
    if (cmd === '/brief') return this.reply(buildDigest(state, now).text);
    if (cmd === '/upcoming') return this.reply(buildSection('upcoming', state, now));
    if (cmd === '/orders') return this.reply(buildSection('orders', state, now));
    if (cmd === '/live') return this.reply(buildSection('live', state, now));
    return this.reply(HELP);
  }

  reply(text) {
    return sendTelegram(this.settings, text, this.fetchImpl).catch((e) => this.store.log('warn', 'TELEGRAM', `reply failed: ${e.message}`));
  }
}
