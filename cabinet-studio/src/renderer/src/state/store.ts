// Application state. The project document is immutable: every edit produces a new
// document, so undo/redo is a stack of document references and "dirty" is a reference
// comparison. Continuous edits (dragging, scrubbing a number) run as a transaction:
// `preview` updates the document live, `endPreview` records one undo step.

import { useMemo } from 'react';
import { create } from 'zustand';
import {
  activeRoom,
  createProject,
  DEFAULT_SNAP,
  Deriver,
  type DerivedRoom,
  type LayerId,
  type ProjectDocument,
  type QualityPreset,
  type SnapGuide,
  type SnapSettings,
  type Vec2,
} from '@engine/index';
import type { AutosaveRecord } from '@shared/ipc';

export type ViewMode = 'plan' | 'front' | 'side' | '3d' | 'walk';
export type Tool = 'select' | 'wall' | 'measure';
/** `front` sub-selects one door / drawer front of the selected cabinet (its front key). */
export type Selection = { kind: 'item' | 'wall' | 'opening'; id: string; front?: string } | null;
export type DialogKind = null | 'new-project' | 'room' | 'cutlist' | 'drawings' | 'render' | 'recovery' | 'gpu' | 'about' | 'shortcuts';

export interface GpuStatus {
  backend: 'webgpu' | 'webgl2' | 'none';
  adapter: string;
  vendor: string;
  software: boolean;
  tier: 'low' | 'medium' | 'high';
  /** Integrated graphics (Intel UHD/Iris etc.) is drawing the 3D view. */
  integrated: boolean;
  /** GPU the browser itself uses (WebGL), which can differ from the WebGPU device. */
  displayGpu: string;
  maxTextureSize: number;
  details: Record<string, string>;
  error?: string;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface DrawState {
  points: Vec2[];
  cursor: Vec2 | null;
  typed: string;
}

export interface MeasureState {
  a: Vec2 | null;
  b: Vec2 | null;
  cursor: Vec2 | null;
}

export interface RenderStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  frameMs: number;
}

export type Theme = 'standard' | 'night';

interface Prefs {
  quality: QualityPreset | null;
  snap: SnapSettings;
  layers: Record<LayerId, boolean>;
  showEdges: boolean;
  xray: boolean;
  theme: Theme;
  panels: { left: boolean; right: boolean; leftWidth: number; rightWidth: number };
}

const PREFS_KEY = 'cabinet-studio:prefs';
const DEFAULT_LAYERS: Record<LayerId, boolean> = { walls: true, openings: true, base: true, wall: true, tall: true, panels: true, tops: true, dimensions: true };
const DEFAULT_PREFS: Prefs = {
  quality: null,
  snap: DEFAULT_SNAP,
  layers: DEFAULT_LAYERS,
  showEdges: true,
  xray: false,
  theme: 'standard',
  panels: { left: true, right: true, leftWidth: 288, rightWidth: 320 },
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...p,
      xray: p.xray === true,
      theme: p.theme === 'night' ? 'night' : 'standard',
      snap: { ...DEFAULT_SNAP, ...p.snap },
      layers: { ...DEFAULT_LAYERS, ...p.layers },
      panels: { ...DEFAULT_PREFS.panels, ...p.panels },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(s: Pick<State, 'quality' | 'snap' | 'layers' | 'showEdges' | 'xray' | 'theme' | 'panels'>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ quality: s.quality, snap: s.snap, layers: s.layers, showEdges: s.showEdges, xray: s.xray, theme: s.theme, panels: s.panels }));
  } catch {
    // preferences are a convenience only
  }
}

const HISTORY_LIMIT = 200;
let toastId = 0;

export interface State {
  doc: ProjectDocument;
  savedDoc: ProjectDocument;
  filePath: string | null;
  fileName: string | null;
  past: ProjectDocument[];
  future: ProjectDocument[];
  txBase: ProjectDocument | null;

  selection: Selection;
  hoverId: string | null;
  tool: Tool;
  view: ViewMode;
  elevationWallId: string | null;
  quality: QualityPreset;
  qualityChosen: boolean;
  snap: SnapSettings;
  layers: Record<LayerId, boolean>;
  showEdges: boolean;
  xray: boolean;
  theme: Theme;
  panels: Prefs['panels'];
  gpu: GpuStatus | null;
  stats: RenderStats;
  toasts: Toast[];
  dialog: DialogKind;
  recovery: AutosaveRecord | null;
  guides: SnapGuide[];
  drawing: DrawState;
  measure: MeasureState;
  /** Bumped to ask the viewport to frame the room / selection. */
  frameRequest: number;
  contextMenu: { x: number; y: number } | null;
  /** In-app confirmation (native confirm() is unavailable in some hosts). */
  confirmState: { message: string; okLabel: string; resolve: (ok: boolean) => void } | null;

  commit: (fn: (d: ProjectDocument) => ProjectDocument) => void;
  preview: (fn: (d: ProjectDocument) => ProjectDocument) => void;
  endPreview: () => void;
  cancelPreview: () => void;
  undo: () => void;
  redo: () => void;
  loadDoc: (doc: ProjectDocument, path: string | null, name: string | null, dirty?: boolean) => void;
  markSaved: (path: string | null, name: string) => void;
  select: (sel: Selection) => void;
  setTool: (tool: Tool) => void;
  setView: (view: ViewMode) => void;
  setQuality: (q: QualityPreset, chosen?: boolean) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  set: (patch: Partial<State>) => void;
}

const prefs = loadPrefs();
const initialDoc = createProject({ name: 'New kitchen' });

function validSelection(doc: ProjectDocument, sel: Selection): Selection {
  if (!sel) return null;
  const room = activeRoom(doc);
  const ok =
    sel.kind === 'item' ? room.items.some((i) => i.id === sel.id) : sel.kind === 'wall' ? room.walls.some((w) => w.id === sel.id) : room.openings.some((o) => o.id === sel.id);
  return ok ? sel : null;
}

export const useStore = create<State>((set, get) => ({
  doc: initialDoc,
  savedDoc: initialDoc,
  filePath: null,
  fileName: null,
  past: [],
  future: [],
  txBase: null,

  selection: null,
  hoverId: null,
  tool: 'select',
  view: '3d',
  elevationWallId: null,
  quality: prefs.quality ?? 'high',
  qualityChosen: prefs.quality != null,
  snap: prefs.snap,
  layers: prefs.layers,
  showEdges: prefs.showEdges,
  xray: prefs.xray,
  theme: prefs.theme,
  // Narrow windows start with the side panels closed so the viewport fits.
  panels: typeof window !== 'undefined' && window.innerWidth < 900 ? { ...prefs.panels, left: false, right: false } : prefs.panels,
  gpu: null,
  stats: { fps: 0, drawCalls: 0, triangles: 0, frameMs: 0 },
  toasts: [],
  dialog: null,
  recovery: null,
  guides: [],
  drawing: { points: [], cursor: null, typed: '' },
  measure: { a: null, b: null, cursor: null },
  frameRequest: 0,
  contextMenu: null,
  confirmState: null,

  commit: (fn) => {
    const s = get();
    const base = s.txBase ?? s.doc;
    const next = fn(s.doc);
    if (next === base) {
      set({ txBase: null, doc: next });
      return;
    }
    set({ doc: next, txBase: null, past: [...s.past, base].slice(-HISTORY_LIMIT), future: [] });
  },
  preview: (fn) => {
    const s = get();
    const next = fn(s.doc);
    if (next === s.doc) return;
    set({ doc: next, txBase: s.txBase ?? s.doc });
  },
  endPreview: () => {
    const s = get();
    if (!s.txBase) return;
    if (s.txBase === s.doc) set({ txBase: null });
    else set({ txBase: null, past: [...s.past, s.txBase].slice(-HISTORY_LIMIT), future: [] });
  },
  cancelPreview: () => {
    const s = get();
    if (s.txBase) set({ doc: s.txBase, txBase: null, guides: [] });
  },
  undo: () => {
    const s = get();
    if (s.txBase) {
      s.cancelPreview();
      return;
    }
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({ doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], selection: validSelection(prev, s.selection) });
  },
  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({ doc: next, past: [...s.past, s.doc], future: s.future.slice(1), selection: validSelection(next, s.selection) });
  },
  loadDoc: (doc, path, name, dirty = false) =>
    set({
      doc,
      savedDoc: dirty ? createProject() : doc,
      filePath: path,
      fileName: name,
      past: [],
      future: [],
      txBase: null,
      selection: null,
      guides: [],
      drawing: { points: [], cursor: null, typed: '' },
      frameRequest: get().frameRequest + 1,
    }),
  markSaved: (path, name) => set({ savedDoc: get().doc, filePath: path, fileName: name }),
  select: (selection) => set({ selection, contextMenu: null }),
  setTool: (tool) => set({ tool, drawing: { points: [], cursor: null, typed: '' }, measure: { a: null, b: null, cursor: null }, guides: [] }),
  setView: (view) => set({ view, contextMenu: null }),
  setQuality: (quality, chosen = true) => {
    set({ quality, qualityChosen: chosen || get().qualityChosen });
    const s = get();
    savePrefs({ ...s, quality: s.qualityChosen ? quality : null } as State);
  },
  toast: (kind, text) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  set: (patch) => set(patch),
}));

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
}
applyTheme(prefs.theme);

export function setTheme(theme: Theme): void {
  useStore.setState({ theme });
  applyTheme(theme);
  savePrefs(useStore.getState());
}

export function toggleXray(): void {
  useStore.setState({ xray: !useStore.getState().xray });
  savePrefs(useStore.getState());
}

export const isDirty = (s: State): boolean => s.doc !== s.savedDoc;

/** Ask the user to confirm in an in-app dialog; resolves true when they accept. */
export function askConfirm(message: string, okLabel = 'Continue'): Promise<boolean> {
  return new Promise((resolve) => {
    useStore.getState().confirmState?.resolve(false);
    useStore.setState({
      confirmState: {
        message,
        okLabel,
        resolve: (ok) => {
          useStore.setState({ confirmState: null });
          resolve(ok);
        },
      },
    });
  });
}

// ───────────────────────── Derived data (memoised per document) ─────────────────────────

export const deriver = new Deriver();
let lastDoc: ProjectDocument | null = null;
let lastDerived: DerivedRoom | null = null;

export function derive(doc: ProjectDocument): DerivedRoom {
  if (doc !== lastDoc || !lastDerived) {
    lastDerived = deriver.derive(doc);
    lastDoc = doc;
  }
  return lastDerived;
}

export function useDerived(): DerivedRoom {
  const doc = useStore((s) => s.doc);
  return useMemo(() => derive(doc), [doc]);
}
