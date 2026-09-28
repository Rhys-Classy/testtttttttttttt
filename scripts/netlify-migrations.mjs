// Netlify Database applies migrations from netlify/database/migrations/<number>_<slug>/migration.sql.
// The source of truth is drizzle/ (used by self-hosting, Docker and tests); this copies it across.
// Run after `npm run db:generate`:  npm run netlify:migrations   (tests check they're in sync)
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const journal = JSON.parse(readFileSync(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'));
const out = path.join(root, 'netlify/database/migrations');
rmSync(out, { recursive: true, force: true });
for (const entry of journal.entries) {
  const [num, ...rest] = entry.tag.split('_');
  const dir = path.join(out, `${num}_${rest.join('-')}`);
  mkdirSync(dir, { recursive: true });
  const sql = readFileSync(path.join(root, 'drizzle', `${entry.tag}.sql`), 'utf8');
  writeFileSync(path.join(dir, 'migration.sql'), `-- Generated from drizzle/${entry.tag}.sql by scripts/netlify-migrations.mjs. Do not edit.\n${sql}`);
}
console.log(readdirSync(out).join('\n'));
