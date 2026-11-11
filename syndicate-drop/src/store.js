// One JSON file on disk. Small, readable, and enough for a few hundred
// watched products. Writes go to a temp file first so a crash can't corrupt it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const LOG_CAP = 300;

export function newId() {
  return crypto.randomBytes(6).toString('hex');
}

export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'state.json');
    fs.mkdirSync(dir, { recursive: true });
    this.state = { items: [], buys: [], log: [], alertsSent: 0, settings: {} };
    this.fresh = !fs.existsSync(this.file);
    if (!this.fresh) {
      try {
        this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
      } catch (e) {
        const bad = `${this.file}.corrupt-${Date.now()}`;
        fs.renameSync(this.file, bad);
        console.error(`state file unreadable, moved to ${bad}: ${e.message}`);
      }
    }
    this.timer = null;
  }

  save() {
    // Debounced: many checks can land in the same second.
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 250);
  }

  flush() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    fs.renameSync(tmp, this.file);
  }

  log(level, who, text) {
    this.state.log.push({ t: Date.now(), level, who, text });
    if (this.state.log.length > LOG_CAP) this.state.log.splice(0, this.state.log.length - LOG_CAP);
    this.save();
  }
}
