// Self-installer for the Windows .exe. Double-click it from anywhere (Downloads,
// inside the zip, the desktop) and it:
//   1. finds the newest existing SyndicateDrop-data folder (watchlist, ledger, Telegram)
//   2. stops any other running copy and renames old copies so they can't start again
//   3. copies itself to %LOCALAPPDATA%\SyndicateDrop and carries the data across
//   4. adds a Windows startup entry, launches the installed copy, and exits
// Running the installed copy itself skips all of this.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const DATA = 'SyndicateDrop-data';
const SKIP = new Set(['node_modules', 'AppData', '$Recycle.Bin', 'Windows', 'Program Files', 'Program Files (x86)', '.git']);

/** Every SyndicateDrop-data folder (holding state.json) under the roots, up to `depth` levels down. */
export function findDataDirs(roots, depth = 4) {
  const out = [];
  const walk = (dir, d) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.name === DATA) {
        if (fs.existsSync(path.join(full, 'state.json'))) out.push(full);
      } else if (d > 0) walk(full, d - 1);
    }
  };
  for (const r of roots) if (r && fs.existsSync(r)) walk(r, depth);
  return [...new Set(out)];
}

/** The data folder whose state.json changed most recently, or null. */
export function newestDataDir(dirs) {
  let best = null;
  let bestT = -1;
  for (const d of dirs) {
    try {
      const t = fs.statSync(path.join(d, 'state.json')).mtimeMs;
      if (t > bestT) {
        best = d;
        bestT = t;
      }
    } catch {
      /* vanished */
    }
  }
  return best;
}

export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function copyWithRetry(from, to) {
  for (let i = 0; i < 20; i++) {
    try {
      fs.copyFileSync(from, to);
      return;
    } catch (e) {
      if (i === 19) throw e;
      sleep(500); // the old copy may still be releasing the file
    }
  }
}

export function installDir(env = process.env) {
  return path.join(env.LOCALAPPDATA || path.join(env.USERPROFILE || '.', 'AppData', 'Local'), 'SyndicateDrop');
}

/** Returns true when this process should exit because the installed copy has taken over. */
export function selfInstall({ execPath = process.execPath, env = process.env, log = console.log } = {}) {
  const dir = installDir(env);
  const target = path.join(dir, 'SyndicateDrop.exe');
  if (path.resolve(execPath).toLowerCase() === path.resolve(target).toLowerCase()) return false;

  log('\n  SYNDICATE.DROP — installing / updating…');
  const home = env.USERPROFILE || '';
  const roots = [path.dirname(execPath), path.join(home, 'Documents'), path.join(home, 'Desktop'), path.join(home, 'Downloads'), path.join(home, 'OneDrive'), dir];
  const found = findDataDirs(roots);
  const installed = path.join(dir, DATA);

  // 1. Stop every other running copy (never this process).
  try {
    execFileSync('taskkill', ['/F', '/IM', 'SyndicateDrop.exe', '/FI', `PID ne ${process.pid}`], { stdio: 'ignore' });
    log('  stopped the old copy');
  } catch {
    /* none running */
  }

  // 2. Install this exe.
  fs.mkdirSync(dir, { recursive: true });
  copyWithRetry(execPath, target);

  // 3. Carry the newest data across, keeping a backup of whatever was installed before.
  const newest = newestDataDir(found);
  if (newest && path.resolve(newest).toLowerCase() !== path.resolve(installed).toLowerCase()) {
    if (fs.existsSync(installed)) fs.renameSync(installed, `${installed}-backup-${Date.now()}`);
    copyDir(newest, installed);
    log(`  moved your watchlist, ledger and Telegram bot from ${newest}`);
  } else if (newest) {
    log('  kept your watchlist, ledger and Telegram bot');
  } else {
    log('  first install: no earlier data found');
  }

  // 4. Retire old copies elsewhere so an old startup shortcut can't run them.
  for (const d of found) {
    const old = path.join(path.dirname(d), 'SyndicateDrop.exe');
    if (path.resolve(old).toLowerCase() === path.resolve(target).toLowerCase()) continue;
    if (path.resolve(old).toLowerCase() === path.resolve(execPath).toLowerCase()) continue;
    try {
      if (fs.existsSync(old)) fs.renameSync(old, path.join(path.dirname(d), 'SyndicateDrop-OLD-do-not-use.exe'));
    } catch {
      /* best effort */
    }
  }

  // 5. Start with Windows (no browser pop-up at boot).
  if (env.APPDATA) {
    const startup = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    try {
      fs.mkdirSync(startup, { recursive: true });
      fs.writeFileSync(path.join(startup, 'SyndicateDrop.cmd'), `@echo off\r\nset NO_BROWSER=1\r\nstart "" /min "${target}"\r\n`);
      log('  set to start automatically with Windows');
    } catch (e) {
      log(`  could not add the startup entry: ${e.message}`);
    }
  }

  // 6. Hand over to the installed copy.
  spawn(target, [], { detached: true, stdio: 'ignore', cwd: dir, env: { ...env, SD_JUST_INSTALLED: '1' } }).unref();
  log(`  done. Running from ${dir}\n  This window will close.\n`);
  sleep(2500);
  return true;
}
