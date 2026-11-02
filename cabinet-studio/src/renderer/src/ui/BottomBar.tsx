import { useRef, useState, useEffect } from 'react';
import { Grid3x3, Layers, Magnet, PanelTop, Spline } from 'lucide-react';
import { activeRoom, type LayerId } from '@engine/index';
import { savePrefs, useDerived, useStore } from '../state/store';
import { popupStyle } from './TopBar';

const LAYER_LABELS: Record<LayerId, string> = {
  walls: 'Walls',
  openings: 'Windows & doors',
  base: 'Base cabinets',
  wall: 'Wall cabinets',
  tall: 'Tall & furniture',
  panels: 'Panels & fillers',
  tops: 'Benchtops & splashbacks',
  dimensions: 'Dimensions',
};

export function BottomBar() {
  const doc = useStore((s) => s.doc);
  const sel = useStore((s) => s.selection);
  const snap = useStore((s) => s.snap);
  const layers = useStore((s) => s.layers);
  const showEdges = useStore((s) => s.showEdges);
  const gpu = useStore((s) => s.gpu);
  const stats = useStore((s) => s.stats);
  const d = useDerived();
  const [layersOpen, setLayersOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layersOpen) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setLayersOpen(false);
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [layersOpen]);
  const room = activeRoom(doc);
  const parts = [...d.builds.values()].reduce((a, b) => a + b.parts.length, 0);
  const persist = () => setTimeout(() => savePrefs(useStore.getState()), 0);
  const setSnap = (patch: Partial<typeof snap>) => {
    useStore.setState({ snap: { ...snap, ...patch } });
    persist();
  };
  let selText = 'Nothing selected';
  if (sel?.kind === 'item') {
    const it = room.items.find((i) => i.id === sel.id);
    if (it) {
      const [w, h, dd] = it.kind === 'cabinet' ? [it.params.width, it.params.height, it.params.depth] : [it.width, it.height, it.depth];
      selText = `${it.label} ${it.name} — W ${w} × H ${h} × D ${dd} mm · elev ${Math.round(it.placement.elevation)}`;
    }
  } else if (sel?.kind === 'wall') {
    const w = room.walls.find((x) => x.id === sel.id);
    if (w) selText = `Wall — ${Math.round(Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y))} mm × ${w.thickness} mm`;
  } else if (sel?.kind === 'opening') {
    const o = room.openings.find((x) => x.id === sel.id);
    if (o) selText = `${o.kind === 'window' ? 'Window' : 'Door'} — ${o.width} × ${o.height} mm`;
  }
  return (
    <footer className="bottombar">
      <span>
        {room.name} · {room.items.filter((i) => i.kind === 'cabinet').length} cabinets · {parts} parts
      </span>
      <span className="sep" />
      <span className="bb-sel">{selText}</span>
      <span className="spacer" style={{ flex: 1 }} />
      <button className={`bb-btn${snap.grid ? ' on' : ''}`} onClick={() => setSnap({ grid: !snap.grid })} title="Grid snap (G)">
        <Grid3x3 size={13} /> Grid
      </button>
      <select
        className="bb-btn"
        value={snap.gridSize}
        onChange={(e) => setSnap({ gridSize: Number(e.target.value) })}
        title="Grid size"
        style={{ appearance: 'none', background: 'none', border: 'none' }}
      >
        {[1, 5, 10, 25, 50, 100].map((g) => (
          <option key={g} value={g}>
            {g} mm
          </option>
        ))}
      </select>
      <button className={`bb-btn${snap.walls ? ' on' : ''}`} onClick={() => setSnap({ walls: !snap.walls })} title="Snap to walls">
        <PanelTop size={13} /> Walls
      </button>
      <button className={`bb-btn${snap.items ? ' on' : ''}`} onClick={() => setSnap({ items: !snap.items })} title="Snap to cabinets and align faces">
        <Magnet size={13} /> Cabinets
      </button>
      <button
        className={`bb-btn${showEdges ? ' on' : ''}`}
        onClick={() => {
          useStore.setState({ showEdges: !showEdges });
          persist();
        }}
        title="Show part edges in 3D (E)"
      >
        <Spline size={13} /> Edges
      </button>
      <div className="menu" ref={ref}>
        <button className={`bb-btn${layersOpen ? ' on' : ''}`} onClick={() => setLayersOpen(!layersOpen)}>
          <Layers size={13} /> Layers
        </button>
        {layersOpen && (
          <div className="bb-pop" style={popupStyle(ref.current, 'right', 'above')}>
            {(Object.keys(LAYER_LABELS) as LayerId[]).map((l) => (
              <label key={l} className="toggle">
                <input
                  type="checkbox"
                  checked={layers[l]}
                  onChange={(e) => {
                    useStore.setState({ layers: { ...layers, [l]: e.target.checked } });
                    persist();
                  }}
                />
                {LAYER_LABELS[l]}
              </label>
            ))}
          </div>
        )}
      </div>
      <span className="sep" />
      <span title="All dimensions are millimetres">mm</span>
      <span className="sep" />
      <button className="bb-btn bb-gpu" onClick={() => useStore.setState({ dialog: 'gpu' })} title="Graphics & GPU">
        <span className={`dot ${gpu?.backend === 'webgpu' ? 'green' : gpu ? 'amber' : ''}`} />
        {gpu ? `${gpu.backend === 'webgpu' ? 'WebGPU' : gpu.backend === 'webgl2' ? 'WebGL 2' : 'No GPU'} · ${gpu.adapter.slice(0, 38)}` : 'Detecting GPU…'}
        {stats.fps > 0 && ` · ${stats.drawCalls} draws`}
      </button>
    </footer>
  );
}
