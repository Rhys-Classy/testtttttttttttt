// High-level user operations shared by the toolbar, menus, keyboard and viewport.

import {
  activeRoom,
  addItem,
  addOpening,
  autoTops,
  boundsOf,
  buildCutlist,
  buildHardwareSchedule,
  cabinetFromTemplate,
  createProject,
  cutlistToCsv,
  DEFAULT_AUTO_TOPS,
  drawingSheets,
  sheetsToHtml,
  duplicateItems,
  findItem,
  hardwareToCsv,
  mirrorItem,
  nextLabel,
  panelFromTemplate,
  panelTemplateById,
  parseProject,
  ProjectFileError,
  removeItems,
  removeOpening,
  removeWall,
  replaceAutoTops,
  rotateItem,
  serializeProject,
  snapItem,
  snapOpening,
  templateById,
  updateItem,
  type Item,
  type NewProjectOptions,
  type OpeningKind,
  type ProjectDocument,
  type SnapResult,
  type Vec2,
} from '@engine/index';
import type { MenuCommand } from '@shared/ipc';
import { platform } from '../platform/bridge';
import { askConfirm, derive, deriver, isDirty, useStore } from './store';

const S = () => useStore.getState();

export function describeError(e: unknown): string {
  if (e instanceof ProjectFileError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function roomCentre(doc: ProjectDocument): Vec2 {
  const d = derive(doc);
  const pts = d.floorPolygon ?? activeRoom(doc).walls.flatMap((w) => [w.start, w.end]);
  if (!pts.length) return { x: 0, y: 0 };
  const b = boundsOf(pts);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Snap an item (new or existing) so that its footprint centre follows `cursor`. */
export function snapForItem(doc: ProjectDocument, item: Item, cursor: Vec2): SnapResult {
  const d = derive(doc);
  return snapItem({
    extents: deriver.extents(doc, item),
    elevation: item.placement.elevation,
    cursor,
    rotation: item.placement.rotation,
    faces: d.faces,
    others: deriver.obstacles(doc, activeRoom(doc), new Set([item.id])),
    settings: S().snap,
  });
}

export function applySnap(doc: ProjectDocument, id: string, cursor: Vec2): ProjectDocument {
  const item = findItem(doc, id);
  if (!item) return doc;
  const res = snapForItem(doc, item, cursor);
  useStore.setState({ guides: res.guides });
  return updateItem<Item>(doc, id, (i) => ({ ...i, placement: res.placement, wallId: res.wallId }));
}

export type LibraryKind = 'cabinet' | 'panel' | 'opening';
export interface LibraryDrag {
  kind: LibraryKind;
  id: string;
}

/** Create an item from the library, unsnapped. Returns the document with it added. */
export function createFromLibrary(doc: ProjectDocument, drag: LibraryDrag): { doc: ProjectDocument; id: string } | null {
  if (drag.kind === 'cabinet') {
    const t = templateById(drag.id);
    if (!t) return null;
    const { doc: d, label } = nextLabel(doc, 'cabinet');
    const item = cabinetFromTemplate(t, label);
    return { doc: addItem(d, item), id: item.id };
  }
  if (drag.kind === 'panel') {
    const t = panelTemplateById(drag.id);
    if (!t) return null;
    const { doc: d, label } = nextLabel(doc, 'panel');
    const item = panelFromTemplate(t, label);
    return { doc: addItem(d, item), id: item.id };
  }
  return null;
}

/** One-click add (library double-click / Enter): placed at the room centre, snapped. */
export function addFromLibrary(drag: LibraryDrag, cursor?: Vec2): void {
  const s = S();
  if (drag.kind === 'opening') {
    addOpeningAt(drag.id as OpeningKind, cursor ?? roomCentre(s.doc), true);
    return;
  }
  const res = createFromLibrary(s.doc, drag);
  if (!res) return;
  const placed = applySnap(res.doc, res.id, cursor ?? roomCentre(s.doc));
  s.commit(() => placed);
  useStore.setState({ selection: { kind: 'item', id: res.id }, guides: [] });
}

export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number; sill: number }> = {
  window: { width: 1200, height: 1050, sill: 1050 },
  door: { width: 820, height: 2040, sill: 0 },
};

export function addOpeningAt(kind: OpeningKind, cursor: Vec2, nearestWall = false): boolean {
  const s = S();
  const room = activeRoom(s.doc);
  const def = OPENING_DEFAULTS[kind];
  let snap = snapOpening(cursor, def.width, room.walls, s.snap.gridSize);
  if (!snap && nearestWall && room.walls.length) {
    const w = [...room.walls].sort((a, b) => Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) - Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y))[0];
    const mid = { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 };
    snap = snapOpening(mid, def.width, room.walls, s.snap.gridSize);
  }
  if (!snap) {
    s.toast('info', 'Drop windows and doors onto a wall.');
    return false;
  }
  const { doc, opening } = addOpening(s.doc, { kind, wallId: snap.wallId, offset: snap.offset, ...def });
  s.commit(() => doc);
  useStore.setState({ selection: { kind: 'opening', id: opening.id } });
  return true;
}

export function deleteSelection(): void {
  const s = S();
  const sel = s.selection;
  if (!sel) return;
  if (sel.kind === 'item') s.commit((d) => removeItems(d, [sel.id]));
  else if (sel.kind === 'wall') s.commit((d) => removeWall(d, sel.id));
  else s.commit((d) => removeOpening(d, sel.id));
  s.select(null);
}

export function duplicateSelection(): void {
  const s = S();
  const sel = s.selection;
  if (sel?.kind !== 'item') return;
  const { doc, newIds } = duplicateItems(s.doc, [sel.id]);
  const copy = findItem(doc, newIds[0]);
  if (!copy) return;
  const e = deriver.extents(doc, copy);
  // Snap from the copy's centre so it butts up beside the original or the nearest free gap.
  const c = { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 };
  const cos = Math.cos(copy.placement.rotation);
  const sin = Math.sin(copy.placement.rotation);
  const centre = { x: copy.placement.x + c.x * cos - c.y * sin, y: copy.placement.y + c.x * sin + c.y * cos };
  const placed = applySnap(doc, copy.id, centre);
  s.commit(() => placed);
  useStore.setState({ selection: { kind: 'item', id: copy.id }, guides: [] });
}

export function rotateSelection(angle = Math.PI / 2): void {
  const s = S();
  const sel = s.selection;
  if (sel?.kind === 'item') s.commit((d) => rotateItem(d, sel.id, angle));
}

export function mirrorSelection(): void {
  const s = S();
  const sel = s.selection;
  if (sel?.kind !== 'item') return;
  const item = findItem(s.doc, sel.id);
  if (item?.kind !== 'cabinet') {
    s.toast('info', 'Mirror swaps door handing and blind sides on cabinets.');
    return;
  }
  s.commit((d) => mirrorItem(d, sel.id));
}

export function runAutoTops(): void {
  const s = S();
  const d = derive(s.doc);
  let doc = s.doc;
  let bt = 0;
  let sb = 0;
  const tops = autoTops(d.room, d.ends, DEFAULT_AUTO_TOPS, (prefix) => (prefix === 'BT' ? `BT${++bt}` : `SB${++sb}`));
  doc = replaceAutoTops(doc, tops);
  s.commit(() => doc);
  s.toast(tops.length ? 'success' : 'info', tops.length ? `Generated ${bt} benchtop${bt === 1 ? '' : 's'} and ${sb} splashback${sb === 1 ? '' : 's'}.` : 'No base cabinets to put benchtops on.');
}

// ───────────────────────────── Files ─────────────────────────────

const safeName = (n: string) => n.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'project';

export function newProject(opts: NewProjectOptions): void {
  const doc = createProject(opts);
  S().loadDoc(doc, null, null);
  void platform.clearAutosave();
}

export function loadProjectText(text: string, path: string | null, name: string): boolean {
  try {
    const { doc, warnings } = parseProject(text);
    S().loadDoc(doc, path, name);
    for (const w of warnings) S().toast('info', w);
    S().toast('success', `Opened ${name}`);
    return true;
  } catch (e) {
    S().toast('error', `Couldn't open ${name}: ${describeError(e)}`);
    return false;
  }
}

export async function openProjectFlow(): Promise<void> {
  if (isDirty(S()) && !(await askConfirm('Discard unsaved changes to this project?', 'Discard and open'))) return;
  try {
    const f = await platform.openProject();
    if (f) loadProjectText(f.content, f.path, f.name);
  } catch (e) {
    S().toast('error', `Couldn't open the project: ${describeError(e)}`);
  }
}

export async function openFromPath(path: string): Promise<void> {
  try {
    const f = await platform.openProjectAt(path);
    loadProjectText(f.content, f.path, f.name);
  } catch (e) {
    S().toast('error', `Couldn't open ${path}: ${describeError(e)}`);
  }
}

export async function saveFlow(saveAs = false): Promise<boolean> {
  const s = S();
  const doc = s.doc;
  try {
    const res = await platform.saveProject({ content: serializeProject(doc, platform.appVersion), path: s.filePath, suggestedName: safeName(doc.name), saveAs });
    if (!res) return false;
    useStore.setState({ savedDoc: doc, filePath: res.path, fileName: res.name });
    await platform.clearAutosave();
    s.toast('success', `Saved ${res.name}`);
    return true;
  } catch (e) {
    s.toast('error', `Couldn't save: ${describeError(e)}`);
    return false;
  }
}

export function cutlistData() {
  const d = derive(S().doc);
  return { groups: buildCutlist(d.builds.values(), d.materials), hardware: buildHardwareSchedule(d.builds.values()) };
}

export async function exportCutlistCsv(): Promise<void> {
  const { groups } = cutlistData();
  if (!groups.length) {
    S().toast('info', 'Nothing to cut yet — add some cabinets first.');
    return;
  }
  const name = `${safeName(S().doc.name)} - cutlist.csv`;
  try {
    const out = await platform.exportFile({ data: cutlistToCsv(groups), encoding: 'utf8', suggestedName: name, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (out) S().toast('success', 'Cutlist exported.');
  } catch (e) {
    S().toast('error', `Couldn't export the cutlist: ${describeError(e)}`);
  }
}

export async function exportHardwareCsv(): Promise<void> {
  const { hardware } = cutlistData();
  const name = `${safeName(S().doc.name)} - hardware.csv`;
  try {
    const out = await platform.exportFile({ data: hardwareToCsv(hardware), encoding: 'utf8', suggestedName: name, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (out) S().toast('success', 'Hardware schedule exported.');
  } catch (e) {
    S().toast('error', `Couldn't export the hardware schedule: ${describeError(e)}`);
  }
}

export async function exportPng(dataUrl: string, suffix: string): Promise<void> {
  const name = `${safeName(S().doc.name)} - ${suffix}.png`;
  try {
    const out = await platform.exportFile({ data: dataUrl.split(',')[1] ?? '', encoding: 'base64', suggestedName: name, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (out) S().toast('success', 'Image saved.');
  } catch (e) {
    S().toast('error', `Couldn't save the image: ${describeError(e)}`);
  }
}

export function drawingSet() {
  const doc = S().doc;
  const d = derive(doc);
  const names = new Map(activeRoom(doc).walls.map((w, i) => [w.id, i < 26 ? String.fromCharCode(65 + i) : `W${i + 1}`]));
  return drawingSheets(doc, d, (id) => names.get(id) ?? '?');
}

export async function exportDrawingsPdf(): Promise<void> {
  const sheets = drawingSet();
  const doc = S().doc;
  try {
    const out = await platform.printPdf({ html: sheetsToHtml(sheets, doc.name), suggestedName: `${safeName(doc.name)} - drawings.pdf` });
    if (out) S().toast('success', `Drawings exported (${sheets.length} sheet${sheets.length === 1 ? '' : 's'}).`);
  } catch (e) {
    S().toast('error', `Couldn't export drawings: ${describeError(e)}`);
  }
}

// ───────────────────────────── Autosave & recovery ─────────────────────────────

let lastAutosaved: ProjectDocument | null = null;

export function startAutosave(intervalMs = 20000): () => void {
  const timer = window.setInterval(() => {
    const s = S();
    if (!isDirty(s) || s.doc === lastAutosaved || s.txBase) return;
    lastAutosaved = s.doc;
    void platform.writeAutosave({ content: serializeProject(s.doc, platform.appVersion), savedAt: new Date().toISOString(), projectName: s.doc.name, path: s.filePath });
  }, intervalMs);
  return () => window.clearInterval(timer);
}

export async function checkRecovery(): Promise<void> {
  const rec = await platform.readAutosave();
  if (rec) useStore.setState({ recovery: rec, dialog: 'recovery' });
}

export function recover(): void {
  const rec = S().recovery;
  if (!rec) return;
  try {
    const { doc } = parseProject(rec.content);
    S().loadDoc(doc, rec.path, rec.path ? (rec.path.split(/[\\/]/).pop() ?? null) : null, true);
    S().toast('success', 'Recovered your unsaved work.');
  } catch (e) {
    S().toast('error', `The recovery copy couldn't be read: ${describeError(e)}`);
  }
  useStore.setState({ recovery: null, dialog: null });
}

export function discardRecovery(): void {
  void platform.clearAutosave();
  useStore.setState({ recovery: null, dialog: null });
}

// ───────────────────────────── Commands ─────────────────────────────

const editingText = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function runCommand(cmd: MenuCommand): void {
  const s = S();
  switch (cmd) {
    case 'new':
      void (async () => {
        if (isDirty(s) && !(await askConfirm('Discard unsaved changes and start a new project?', 'Discard and start new'))) return;
        useStore.setState({ dialog: 'new-project' });
      })();
      return;
    case 'open':
      void openProjectFlow();
      return;
    case 'save':
      void saveFlow(false);
      return;
    case 'save-as':
      void saveFlow(true);
      return;
    case 'undo':
      if (editingText()) document.execCommand('undo');
      else s.undo();
      return;
    case 'redo':
      if (editingText()) document.execCommand('redo');
      else s.redo();
      return;
    case 'duplicate':
      duplicateSelection();
      return;
    case 'delete':
      deleteSelection();
      return;
    case 'cutlist':
      useStore.setState({ dialog: 'cutlist' });
      return;
    case 'drawings':
      useStore.setState({ dialog: 'drawings' });
      return;
    case 'export-cutlist':
      void exportCutlistCsv();
      return;
    case 'render':
    case 'export-image':
      useStore.setState({ dialog: 'render' });
      return;
    case 'view-plan':
      s.setView('plan');
      return;
    case 'view-front':
      s.setView('front');
      return;
    case 'view-side':
      s.setView('side');
      return;
    case 'view-3d':
      s.setView('3d');
      return;
    case 'view-walk':
      s.setView('walk');
      return;
    case 'gpu':
      useStore.setState({ dialog: 'gpu' });
      return;
    case 'about':
      useStore.setState({ dialog: 'about' });
      return;
  }
}
