import { useEffect, useRef, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { activeRoom, addOpening, findItem, updateOpening, type Item, type OpeningKind } from '@engine/index';
import { applySnap, createFromLibrary, OPENING_DEFAULTS, type LibraryDrag } from '../state/actions';
import { libraryDrag } from '../state/library';
import { derive, useStore, type State } from '../state/store';
import { snapOpening } from '@engine/index';
import { detectGpu } from './gpu-detect';
import { Interaction } from './interaction';
import { computeOverlay, renderOverlay, type OverlayData } from './overlay';
import { GpuSelfTestError, RenderEngine } from './RenderEngine';
import { elevationFace, VIEW_LABELS } from './views';

const itemDepth = (i: Item) => (i.kind === 'cabinet' ? i.params.depth + 18 : i.depth);

let engineSingleton: RenderEngine | null = null;

const RENDERER_KEY = 'cabinet-studio:renderer';
/** 'auto' uses WebGPU when available; 'webgl2' forces the WebGL 2 backend. Session-only fallbacks are not persisted. */
let sessionFallback = false;
export function rendererPreference(): 'auto' | 'webgl2' {
  if (sessionFallback) return 'webgl2';
  try {
    return localStorage.getItem(RENDERER_KEY) === 'webgl2' ? 'webgl2' : 'auto';
  } catch {
    return 'auto';
  }
}
export function setRendererPreference(p: 'auto' | 'webgl2', sessionOnly = false): void {
  if (sessionOnly) {
    sessionFallback = p === 'webgl2';
    return;
  }
  sessionFallback = false;
  try {
    localStorage.setItem(RENDERER_KEY, p);
  } catch {
    // preference only
  }
}
export const getEngine = (): RenderEngine | null => engineSingleton;

const HINTS: Record<State['view'], string> = {
  '3d': 'Drag empty space or middle-drag to orbit · right-drag to pan · scroll to zoom at cursor · drag cabinets to move',
  plan: 'Drag to pan · scroll to zoom · drag cabinets to move',
  front: 'Drag cabinets along the wall or up/down · scroll to zoom',
  side: 'Section through the room · scroll to zoom',
  walk: 'Click to look around · W A S D to walk · Shift to run · Esc to stop',
};

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const engineRef = useRef<RenderEngine | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const overlayRef = useRef<OverlayData>({ dims: [], lines: [], points: [] });
  const dropRef = useRef<{ id: string; kind: 'item' | 'opening' } | null>(null);
  const [status, setStatus] = useState<'init' | 'ready' | 'error'>('init');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  // Changing the key remounts the canvas: needed to move from WebGPU to WebGL 2.
  const [canvasKey, setCanvasKey] = useState(0);
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const gpu = useStore((s) => s.gpu);

  useEffect(() => {
    const engine = new RenderEngine();
    let disposed = false;
    let unsub: (() => void) | null = null;
    let ro: ResizeObserver | null = null;

    const sync = () => {
      const s = useStore.getState();
      const d = derive(s.doc);
      engine.sync({ doc: s.doc, derived: d, selection: s.selection, hoverId: s.hoverId, layers: s.layers, showEdges: s.showEdges, view: s.view, elevationFace: elevationFace(s, d), xray: s.xray, night: s.theme === 'night' });
      overlayRef.current = computeOverlay(s, d, s.doc);
      engine.requestRender();
    };

    (async () => {
      const gpuStatus = await detectGpu();
      if (disposed) return;
      useStore.setState({ gpu: gpuStatus });
      const st = useStore.getState();
      if (!st.qualityChosen) st.setQuality(gpuStatus.tier === 'high' ? 'high' : gpuStatus.tier === 'medium' ? 'medium' : 'low', false);
      if (gpuStatus.backend === 'none') {
        setError(gpuStatus.error ?? 'No GPU graphics API is available on this machine.');
        setStatus('error');
        return;
      }
      try {
        await engine.init(canvasRef.current!, gpuStatus, useStore.getState().quality, rendererPreference() === 'webgl2');
      } catch (e) {
        if (disposed) return;
        engine.dispose();
        if (e instanceof GpuSelfTestError && rendererPreference() !== 'webgl2') {
          setRendererPreference('webgl2', true);
          useStore.getState().toast('info', 'WebGPU did not render correctly on this GPU — using the WebGL 2 renderer.');
          setCanvasKey((k) => k + 1);
          return;
        }
        const glMissing = gpuStatus.details['WebGL 2'] === 'unavailable' && rendererPreference() === 'webgl2';
        setError(glMissing ? 'This computer has WebGPU problems and WebGL 2 is disabled, so no GPU renderer is available. Update the graphics driver or enable Help → Graphics & GPU → Force GPU acceleration.' : `The 3D engine could not start: ${(e as Error).message}`);
        setStatus('error');
        return;
      }
      if (disposed) {
        engine.dispose();
        return;
      }
      engineRef.current = engine;
      engineSingleton = engine;
      (window as unknown as { __cabinetEngine?: RenderEngine }).__cabinetEngine = engine;
      useStore.setState({ gpu: { ...gpuStatus, backend: engine.backend } });
      engine.onStats = (stats) => useStore.setState({ stats });
      engine.onAfterRender = () => svgRef.current && renderOverlay(svgRef.current, engine, overlayRef.current);
      engine.onWalkLockChange = setLocked;
      engine.onDeviceLost = (message) => {
        if (engine.backend !== 'webgpu') return;
        setRendererPreference('webgl2', true);
        useStore.getState().toast('error', `The GPU device was lost (${message}). Switched to the WebGL 2 renderer.`);
        setStatus('init');
        setCanvasKey((k) => k + 1);
      };
      const el = containerRef.current!;
      ro = new ResizeObserver(() => engine.setSize(el.clientWidth, el.clientHeight));
      ro.observe(el);
      engine.setSize(el.clientWidth, el.clientHeight);
      interactionRef.current = new Interaction(el, engine);
      sync();
      const s0 = useStore.getState();
      engine.setView(s0.view, elevationFace(s0, derive(s0.doc)));
      unsub = useStore.subscribe((s, p) => {
        if (s.quality !== p.quality) engine.setQuality(s.quality);
        const viewChanged = s.view !== p.view || s.elevationWallId !== p.elevationWallId;
        if (
          viewChanged ||
          s.doc !== p.doc ||
          s.selection !== p.selection ||
          s.hoverId !== p.hoverId ||
          s.layers !== p.layers ||
          s.showEdges !== p.showEdges ||
          s.xray !== p.xray ||
          s.theme !== p.theme ||
          s.guides !== p.guides ||
          s.drawing !== p.drawing ||
          s.measure !== p.measure ||
          s.tool !== p.tool
        ) {
          sync();
        }
        if (viewChanged) engine.setView(s.view, elevationFace(s, derive(s.doc)));
        if (s.frameRequest !== p.frameRequest) engine.frame();
      });
      setStatus('ready');
    })();

    return () => {
      disposed = true;
      unsub?.();
      ro?.disconnect();
      interactionRef.current?.dispose();
      interactionRef.current = null;
      engineRef.current = null;
      engineSingleton = null;
      engine.dispose();
    };
  }, [canvasKey]);

  // ── Drag and drop from the library ──
  const onDragOver = (e: React.DragEvent) => {
    const drag = libraryDrag.current;
    const engine = engineRef.current;
    const inter = interactionRef.current;
    if (!drag || !engine || !inter) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const s = useStore.getState();
    if (drag.kind === 'opening') {
      const kind = drag.id as OpeningKind;
      const def = OPENING_DEFAULTS[kind];
      const p = inter.planUnderCursor(e.clientX, e.clientY, def.sill + def.height / 2);
      if (!p) return;
      const snap = snapOpening(p, def.width, activeRoom(s.doc).walls, s.snap.gridSize);
      if (!snap) return;
      if (!dropRef.current) {
        let id = '';
        s.preview((doc) => {
          const r = addOpening(doc, { kind, wallId: snap.wallId, ...def, offset: snap.offset });
          id = r.opening.id;
          return r.doc;
        });
        dropRef.current = { id, kind: 'opening' };
      } else {
        const id = dropRef.current.id;
        s.preview((doc) => updateOpening(doc, id, { wallId: snap.wallId, offset: snap.offset }));
      }
      return;
    }
    if (!dropRef.current) {
      const res = createFromLibrary(s.doc, drag);
      if (!res) return;
      const item = findItem(res.doc, res.id)!;
      const p = inter.planUnderCursor(e.clientX, e.clientY, item.placement.elevation, itemDepth(item));
      if (!p) return;
      s.preview(() => applySnap(res.doc, res.id, p));
      dropRef.current = { id: res.id, kind: 'item' };
      useStore.setState({ selection: { kind: 'item', id: res.id } });
    } else {
      const id = dropRef.current.id;
      const item = findItem(s.doc, id);
      if (!item) return;
      const p = inter.planUnderCursor(e.clientX, e.clientY, item.placement.elevation, itemDepth(item));
      if (!p) return;
      s.preview((doc) => applySnap(doc, id, p));
    }
  };

  const endDrop = (commit: boolean) => {
    const s = useStore.getState();
    const d = dropRef.current;
    dropRef.current = null;
    useStore.setState({ guides: [] });
    if (!d) return;
    if (commit) {
      s.endPreview();
      s.select({ kind: d.kind === 'item' ? 'item' : 'opening', id: d.id });
    } else {
      s.cancelPreview();
      s.select(null);
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && containerRef.current?.contains(next)) return;
    endDrop(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    endDrop(true);
    libraryDrag.current = null;
    containerRef.current?.focus();
  };

  return (
    <div className="viewport" ref={containerRef} tabIndex={-1} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} data-tool={tool}>
      <canvas key={canvasKey} ref={canvasRef} className="viewport-canvas" />
      <svg ref={svgRef} className="viewport-overlay" />
      <div className="viewport-badge">
        <span>{VIEW_LABELS[view]}</span>
        {gpu && status === 'ready' && <span className={`badge-backend ${gpu.backend}`}>{gpu.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'}</span>}
      </div>
      <div className="viewport-hint">{tool === 'wall' ? 'Click to place wall points · type a length + Enter · Shift = free angle · Esc or double-click to finish' : tool === 'measure' ? 'Click two points to measure · Esc to stop' : HINTS[view]}</div>
      {view === 'walk' && status === 'ready' && !locked && (
        <button className="walk-overlay" onClick={() => engineRef.current?.lockWalk()}>
          <MousePointerClick size={22} />
          <span>Click to walk through the room</span>
          <small>W A S D to move · mouse to look · Esc to stop</small>
        </button>
      )}
      {status === 'init' && <div className="viewport-status">Starting GPU renderer…</div>}
      {status === 'error' && (
        <div className="viewport-status error">
          <strong>3D view unavailable</strong>
          <span>{error}</span>
          <small>Enable hardware acceleration / update your graphics driver, or try Help → Graphics & GPU.</small>
        </div>
      )}
    </div>
  );
}
