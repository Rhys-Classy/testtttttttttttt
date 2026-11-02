import { app, dialog, type BrowserWindow } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { AutosaveRecord, ExportRequest, OpenedFile, SaveRequest, SavedFile } from '../shared/ipc';

const PROJECT_FILTER = { name: 'Cabinet Studio project', extensions: ['cabproj'] };
const MAX_PROJECT_BYTES = 512 * 1024 * 1024;

/** Write to a temp file then rename, so a crash mid-write never corrupts the original. */
async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export async function openProjectAt(path: string): Promise<OpenedFile> {
  const buf = await readFile(path);
  if (buf.byteLength > MAX_PROJECT_BYTES) throw new Error('That file is too large to be a Cabinet Studio project.');
  return { path, name: basename(path), content: buf.toString('utf8') };
}

export async function openProject(win: BrowserWindow): Promise<OpenedFile | null> {
  const res = await dialog.showOpenDialog(win, { title: 'Open project', filters: [PROJECT_FILTER, { name: 'All files', extensions: ['*'] }], properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return null;
  return openProjectAt(res.filePaths[0]);
}

export async function saveProject(win: BrowserWindow, req: SaveRequest): Promise<SavedFile | null> {
  let path = req.path;
  if (req.saveAs || !path) {
    const res = await dialog.showSaveDialog(win, {
      title: req.saveAs ? 'Save project as' : 'Save project',
      defaultPath: path ?? join(app.getPath('documents'), `${req.suggestedName}.cabproj`),
      filters: [PROJECT_FILTER],
    });
    if (res.canceled || !res.filePath) return null;
    path = res.filePath.endsWith('.cabproj') ? res.filePath : `${res.filePath}.cabproj`;
  }
  await atomicWrite(path, req.content);
  return { path, name: basename(path) };
}

export async function exportFile(win: BrowserWindow, req: ExportRequest): Promise<string | null> {
  const res = await dialog.showSaveDialog(win, { title: 'Export', defaultPath: join(app.getPath('documents'), req.suggestedName), filters: req.filters });
  if (res.canceled || !res.filePath) return null;
  await atomicWrite(res.filePath, req.encoding === 'base64' ? Buffer.from(req.data, 'base64') : req.data);
  return res.filePath;
}

const autosavePath = () => join(app.getPath('userData'), 'autosave', 'recovery.json');

export async function writeAutosave(rec: AutosaveRecord): Promise<void> {
  await atomicWrite(autosavePath(), JSON.stringify(rec));
}

export async function readAutosave(): Promise<AutosaveRecord | null> {
  try {
    const rec = JSON.parse(await readFile(autosavePath(), 'utf8')) as AutosaveRecord;
    return typeof rec.content === 'string' ? rec : null;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  await rm(autosavePath(), { force: true });
}
