// Builds dist/SyndicateDrop-Windows.zip: one SyndicateDrop.exe plus a short
// how-to. Uses Node's single-executable-application feature: the app and its
// web files are injected into a stock node.exe. Run with: npm run build:exe
// Needs: network access to nodejs.org and npm, and the `unzip` and `zip` commands.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, 'build');
const NODE_VERSION = process.version; // the blob must match the node.exe version
const target = process.argv[2] || 'win-x64';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

// 1. One CommonJS file (SEA cannot load ES modules or other files).
run('npx', ['--yes', 'esbuild@0.24.0', 'src/server.js', '--bundle', '--platform=node', '--format=cjs',
  `--target=node${process.versions.node.split('.')[0]}`, `--outfile=${path.join(BUILD, 'app.cjs')}`, '--log-level=warning',
  // The owner's private scout relay topic. Never committed; pass SD_RELAY_TOPIC when building.
  `--define:process.env.SD_RELAY_TOPIC=${JSON.stringify(process.env.SD_RELAY_TOPIC || '')}`]);

// 2. The SEA blob, with the dashboard files embedded.
const assets = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'public')).map((f) => [f, path.join(ROOT, 'public', f)]));
const blob = path.join(BUILD, 'app.blob');
fs.writeFileSync(path.join(BUILD, 'sea.json'), JSON.stringify({
  main: path.join(BUILD, 'app.cjs'), output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false, assets,
}));
run(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea.json')]);

// 3. A matching stock node binary for the target.
let exe;
if (target === 'linux-x64') {
  exe = path.join(BUILD, 'SyndicateDrop');
  fs.copyFileSync(process.execPath, exe);
} else {
  const zipName = `node-${NODE_VERSION}-${target}.zip`;
  const zipPath = path.join(BUILD, zipName);
  run('curl', ['-fsSL', '-o', zipPath, `https://nodejs.org/dist/${NODE_VERSION}/${zipName}`]);
  run('unzip', ['-q', '-j', zipPath, `node-${NODE_VERSION}-${target}/node.exe`, '-d', BUILD]);
  exe = path.join(BUILD, 'SyndicateDrop.exe');
  fs.renameSync(path.join(BUILD, 'node.exe'), exe);
}

// 4. Inject the app.
run('npx', ['--yes', 'postject@1.0.0-alpha.6', exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']);

if (target === 'linux-x64') {
  console.log(`built ${exe}`);
} else {
  const pkg = path.join(BUILD, 'SyndicateDrop');
  fs.mkdirSync(pkg);
  fs.renameSync(exe, path.join(pkg, 'SyndicateDrop.exe'));
  fs.copyFileSync(path.join(ROOT, 'START-HERE.txt'), path.join(pkg, 'START HERE.txt'));
  const out = path.join(DIST, 'SyndicateDrop-Windows.zip');
  fs.rmSync(out, { force: true });
  run('zip', ['-q', '-r', '-9', out, 'SyndicateDrop'], { cwd: BUILD });
  console.log(`built ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
}
