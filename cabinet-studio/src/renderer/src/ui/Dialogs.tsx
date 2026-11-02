import { useEffect, useMemo, useState } from 'react';
import { Box, Camera, CheckCircle2, Copy, Cpu, FilePlus2, FileDown, FlipHorizontal2, History, Info, ListChecks, RotateCw, Square, Trash2, XCircle } from 'lucide-react';
import { activeRoom, newId, type LightingPreset, type RenderSettings } from '@engine/index';
import type { GpuReport as BridgeGpuReport } from '@shared/ipc';
import {
  cutlistData,
  deleteSelection,
  discardRecovery,
  duplicateSelection,
  exportCutlistCsv,
  exportHardwareCsv,
  exportPng,
  mirrorSelection,
  newProject,
  recover,
  rotateSelection,
} from '../state/actions';
import { platform } from '../platform/bridge';
import { useStore } from '../state/store';
import { getEngine, rendererPreference, setRendererPreference } from '../viewport/Viewport';
import { QUALITY, QUALITY_ORDER } from '../viewport/quality';
import { Modal, NumberField, Row, Seg, TextField, Toggle } from './controls';

const close = () => useStore.setState({ dialog: null });

function NewProjectDialog() {
  const [name, setName] = useState('New kitchen');
  const [w, setW] = useState(4200);
  const [d, setD] = useState(3200);
  const [h, setH] = useState(2400);
  const [t, setT] = useState(110);
  return (
    <Modal
      title="New project"
      icon={<FilePlus2 size={18} />}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              newProject({ name, roomWidth: w, roomDepth: d, ceilingHeight: h, wallThickness: t });
              close();
            }}
          >
            Create project
          </button>
        </>
      }
    >
      <Row label="Project name">
        <TextField value={name} onCommit={setName} />
      </Row>
      <div className="hint">Starting room (clear inside sizes). You can redraw walls, add windows and doors afterwards.</div>
      <div className="row2">
        <label className="stack-label">
          <span>Room width</span>
          <NumberField value={w} min={500} max={30000} onCommit={setW} />
        </label>
        <label className="stack-label">
          <span>Room depth</span>
          <NumberField value={d} min={500} max={30000} onCommit={setD} />
        </label>
        <label className="stack-label">
          <span>Ceiling height</span>
          <NumberField value={h} min={1800} max={6000} onCommit={setH} />
        </label>
        <label className="stack-label">
          <span>Wall thickness</span>
          <NumberField value={t} min={50} max={600} onCommit={setT} />
        </label>
      </div>
    </Modal>
  );
}

function CutlistDialog() {
  const doc = useStore((s) => s.doc);
  const [tab, setTab] = useState<'cut' | 'hw'>('cut');
  const { groups, hardware } = useMemo(() => cutlistData(), [doc]);
  const parts = groups.reduce((a, g) => a + g.partCount, 0);
  const area = groups.reduce((a, g) => a + g.area, 0);
  return (
    <Modal
      wide
      title="Cutlist & hardware"
      icon={<ListChecks size={18} />}
      onClose={close}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            {parts} parts · {area.toFixed(2)} m² · {groups.length} material groups — sizes are cut sizes with edge banding deducted
          </span>
          <button className="btn" onClick={() => void exportHardwareCsv()}>
            <FileDown size={14} /> Hardware CSV
          </button>
          <button className="btn primary" onClick={() => void exportCutlistCsv()}>
            <FileDown size={14} /> Cutlist CSV
          </button>
        </>
      }
    >
      <Seg value={tab} options={[{ value: 'cut', label: `Cutlist (${parts})` }, { value: 'hw', label: `Hardware (${hardware.length})` }]} onChange={setTab} />
      {tab === 'cut' && !groups.length && <div className="empty">No parts yet. Drag cabinets into the room to generate a cutlist.</div>}
      {tab === 'cut' &&
        groups.map((g) => (
          <div className="cut-group" key={g.key}>
            <div className="cut-group-head">
              {g.thickness} mm {g.materialName}
              <span className="muted">
                {g.partCount} parts · {g.area.toFixed(2)} m² · {g.bandingLength.toFixed(1)} m banding
              </span>
            </div>
            <table className="cut">
              <thead>
                <tr>
                  <th className="num">Qty</th>
                  <th className="num">Length</th>
                  <th className="num">Width</th>
                  <th>Part</th>
                  <th>Banding L1,L2,W1,W2</th>
                  <th>Items</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="num">{r.quantity}</td>
                    <td className="num">{r.cutLength}</td>
                    <td className="num">{r.cutWidth}</td>
                    <td>{r.name}</td>
                    <td className="mono">{r.banding}</td>
                    <td>{r.items}</td>
                    <td className="muted">{r.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {tab === 'hw' && (
        <div className="cut-group">
          <table className="cut">
            <thead>
              <tr>
                <th className="num">Qty</th>
                <th>Hardware</th>
                <th>Detail</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              {hardware.map((h) => (
                <tr key={`${h.hardwareId}|${h.detail}`}>
                  <td className="num">{h.quantity}</td>
                  <td>{h.name}</td>
                  <td className="muted">{h.detail}</td>
                  <td>{h.items}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

const RESOLUTIONS = [
  { label: 'Full HD 1920 × 1080', w: 1920, h: 1080 },
  { label: 'QHD 2560 × 1440', w: 2560, h: 1440 },
  { label: '4K 3840 × 2160', w: 3840, h: 2160 },
  { label: 'A3 print 4961 × 3508', w: 4961, h: 3508 },
];

function RenderDialog() {
  const doc = useStore((s) => s.doc);
  const view = useStore((s) => s.view);
  const gpu = useStore((s) => s.gpu);
  const r = doc.render;
  const [res, setRes] = useState(0);
  const [busy, setBusy] = useState(false);
  const live = (patch: Partial<RenderSettings>) => useStore.getState().preview((d) => ({ ...d, render: { ...d.render, ...patch } }));
  const commit = (patch: Partial<RenderSettings>) => useStore.getState().commit((d) => ({ ...d, render: { ...d.render, ...patch } }));
  const slider = (label: string, k: 'exposure' | 'sunAzimuth' | 'sunElevation' | 'sunIntensity', min: number, max: number, step: number) => (
    <Row label={label}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="range" min={min} max={max} step={step} value={r[k]} onChange={(e) => live({ [k]: Number(e.target.value) })} onPointerUp={() => useStore.getState().endPreview()} onKeyUp={() => useStore.getState().endPreview()} />
        <span className="mono muted" style={{ width: 44, textAlign: 'right' }}>
          {r[k]}
        </span>
      </div>
    </Row>
  );
  const maxTex = gpu?.maxTextureSize ?? 8192;
  const render = async () => {
    const engine = getEngine();
    if (!engine) return;
    const sz = RESOLUTIONS[res];
    if (sz.w > maxTex || sz.h > maxTex) {
      useStore.getState().toast('error', `This GPU supports images up to ${maxTex} px.`);
      return;
    }
    setBusy(true);
    try {
      await new Promise((ok) => setTimeout(ok, 30));
      const url = await engine.capture(sz.w, sz.h);
      await exportPng(url, `render ${sz.w}x${sz.h}`);
    } catch (e) {
      useStore.getState().toast('error', `Render failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const saveView = () => {
    const engine = getEngine();
    if (!engine) return;
    const c = engine.cameraState();
    const n = doc.cameras.length + 1;
    useStore.getState().commit((d) => ({ ...d, cameras: [...d.cameras, { id: newId('cam'), name: `View ${n}`, ...c }] }));
  };
  return (
    <Modal
      title="Render & presentation"
      icon={<Camera size={18} />}
      onClose={close}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            Rendered on your GPU ({gpu?.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'}) at Ultra quality from the current {view === 'walk' ? 'walkthrough' : view} camera.
          </span>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void render()}>
            <Camera size={14} /> {busy ? 'Rendering…' : 'Render & save PNG'}
          </button>
        </>
      }
    >
      <Row label="Resolution">
        <select className="select" value={res} onChange={(e) => setRes(Number(e.target.value))}>
          {RESOLUTIONS.map((x, i) => (
            <option key={x.label} value={i} disabled={x.w > maxTex}>
              {x.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Lighting">
        <Seg<LightingPreset>
          value={r.lighting}
          options={[
            { value: 'studio', label: 'Studio' },
            { value: 'daylight', label: 'Daylight' },
            { value: 'evening', label: 'Evening' },
          ]}
          onChange={(lighting) => commit({ lighting })}
        />
      </Row>
      {slider('Exposure', 'exposure', 0.3, 2.5, 0.05)}
      {slider('Sun direction', 'sunAzimuth', 0, 360, 1)}
      {slider('Sun height', 'sunElevation', 5, 85, 1)}
      {slider('Sun strength', 'sunIntensity', 0, 6, 0.1)}
      <Toggle checked={r.underCabinetLights} onChange={(underCabinetLights) => commit({ underCabinetLights })} label="Under-cabinet LED strips" />
      <Row label="Saved views">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {doc.cameras.map((c) => (
            <button
              key={c.id}
              className="btn small"
              onClick={() => {
                useStore.getState().setView('3d');
                setTimeout(() => getEngine()?.restoreCamera(c), 0);
              }}
            >
              {c.name}
            </button>
          ))}
          <button className="btn small" onClick={saveView} disabled={view !== '3d'} title="Save the current 3D camera with the project">
            + Save current 3D view
          </button>
        </div>
      </Row>
    </Modal>
  );
}

function RecoveryDialog() {
  const rec = useStore((s) => s.recovery);
  if (!rec) return null;
  return (
    <Modal
      title="Recover unsaved work?"
      icon={<History size={18} />}
      onClose={discardRecovery}
      footer={
        <>
          <button className="btn" onClick={discardRecovery}>
            Discard
          </button>
          <button className="btn primary" onClick={recover}>
            Recover
          </button>
        </>
      }
    >
      <div>
        Cabinet Studio found unsaved changes to <strong>{rec.projectName}</strong> from {new Date(rec.savedAt).toLocaleString()}.
      </div>
      <div className="hint">Recovering opens that copy; save it to keep it. Discarding deletes the recovery copy.</div>
    </Modal>
  );
}

function GpuDialog() {
  const gpu = useStore((s) => s.gpu);
  const stats = useStore((s) => s.stats);
  const quality = useStore((s) => s.quality);
  const [report, setReport] = useState<BridgeGpuReport | null>(null);
  useEffect(() => {
    void platform.gpuReport().then(setReport);
  }, []);
  const engine = getEngine();
  return (
    <Modal title="Graphics & GPU" icon={<Cpu size={18} />} onClose={close} wide footer={<button className="btn" onClick={close}>Close</button>}>
      <div className="kv">
        <div>Rendering API</div>
        <div>{engine ? (engine.backend === 'webgpu' ? 'WebGPU (native GPU)' : 'WebGL 2 (fallback)') : '—'}</div>
        <div>Adapter</div>
        <div>{gpu?.adapter ?? '—'}</div>
        <div>Vendor</div>
        <div>{gpu?.vendor || '—'}</div>
        <div>Hardware acceleration</div>
        <div>{gpu ? (gpu.software ? 'Software rendering — GPU not in use' : 'Yes — local GPU') : '—'}</div>
        <div>Detected tier</div>
        <div>{gpu?.tier ?? '—'}</div>
        <div>Max texture size</div>
        <div>{gpu?.maxTextureSize ?? '—'}</div>
        <div>Ambient occlusion</div>
        <div>{engine ? (engine.aoAvailable ? (QUALITY[quality].ao ? 'on' : 'off at this quality') : 'unavailable on this GPU') : '—'}</div>
        <div>Last frame</div>
        <div>
          {stats.frameMs.toFixed(1)} ms GPU submit · {stats.drawCalls} draw calls · {stats.triangles.toLocaleString()} triangles
        </div>
        {gpu &&
          Object.entries(gpu.details).map(([k, v]) => (
            <Fragmentish key={k} k={k} v={v} />
          ))}
        {report &&
          Object.entries(report.featureStatus).map(([k, v]) => (
            <Fragmentish key={`fs-${k}`} k={`Chromium: ${k}`} v={v} />
          ))}
        {report && report.switches.length > 0 && <Fragmentish k="Launch switches" v={report.switches.join(' ')} />}
      </div>
      <Row label="Quality">
        <Seg value={quality} options={QUALITY_ORDER.map((q) => ({ value: q, label: q[0].toUpperCase() + q.slice(1) }))} onChange={(q) => useStore.getState().setQuality(q)} />
      </Row>
      <Row label="Renderer">
        <Seg
          value={rendererPreference()}
          options={[
            { value: 'auto', label: 'Auto (WebGPU when available)' },
            { value: 'webgl2', label: 'WebGL 2 (compatibility)' },
          ]}
          onChange={(p) => {
            setRendererPreference(p);
            useStore.getState().toast('info', 'Renderer preference saved — it applies next time Cabinet Studio starts.');
          }}
        />
      </Row>
      <div className="hint">{QUALITY[quality].label}. Pixel ratio ≤ {QUALITY[quality].maxPixelRatio}, shadows {QUALITY[quality].shadows ? `${QUALITY[quality].shadowMapSize}px` : 'off'}, AO {QUALITY[quality].ao ? 'on' : 'off'}.</div>
      {report && platform.platform !== 'web' && (
        <Toggle
          checked={report.forceGpu}
          onChange={(on) => {
            void platform.setForceGpu(on).then(() => {
              setReport({ ...report, forceGpu: on });
              useStore.getState().toast('info', 'Restart Cabinet Studio to apply the GPU setting.');
            });
          }}
          label="Force GPU acceleration (ignore driver blocklist) — restart required"
        />
      )}
    </Modal>
  );
}

function Fragmentish({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div>{k}</div>
      <div>{v}</div>
    </>
  );
}

function AboutDialog() {
  return (
    <Modal title="Cabinet Studio" icon={<Box size={18} />} onClose={close} footer={<button className="btn" onClick={close}>Close</button>}>
      <div>Version {platform.appVersion} · parametric cabinet design and manufacturing.</div>
      <div className="hint">
        CAD engine (TypeScript, renderer-independent) → construction rules → parts → GPU viewport (three.js WebGPU with WebGL 2 fallback), cutlists and hardware schedules. All dimensions in millimetres.
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  switch (dialog) {
    case 'new-project':
      return <NewProjectDialog />;
    case 'cutlist':
      return <CutlistDialog />;
    case 'render':
      return <RenderDialog />;
    case 'recovery':
      return <RecoveryDialog />;
    case 'gpu':
      return <GpuDialog />;
    case 'about':
      return <AboutDialog />;
    default:
      return null;
  }
}

export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const sel = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  useEffect(() => {
    if (!menu) return;
    const h = (e: PointerEvent) => !(e.target as HTMLElement).closest('.ctx') && useStore.setState({ contextMenu: null });
    const k = (e: KeyboardEvent) => e.key === 'Escape' && useStore.setState({ contextMenu: null });
    window.addEventListener('pointerdown', h);
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('pointerdown', h);
      window.removeEventListener('keydown', k);
    };
  }, [menu]);
  if (!menu || !sel) return null;
  const run = (fn: () => void) => () => {
    useStore.setState({ contextMenu: null });
    fn();
  };
  const room = activeRoom(doc);
  const item = sel.kind === 'item' ? room.items.find((i) => i.id === sel.id) : null;
  return (
    <div className="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 260) }}>
      {item && (
        <>
          <div className="menu-head">
            {item.label} · {item.name}
          </div>
          <button className="menu-item" onClick={run(duplicateSelection)}>
            <Copy size={14} /> Duplicate <kbd>Ctrl+D</kbd>
          </button>
          <button className="menu-item" onClick={run(() => rotateSelection())}>
            <RotateCw size={14} /> Rotate 90° <kbd>R</kbd>
          </button>
          <button className="menu-item" onClick={run(mirrorSelection)} disabled={item.kind !== 'cabinet'}>
            <FlipHorizontal2 size={14} /> Mirror handing <kbd>M</kbd>
          </button>
          {item.wallId && (
            <button className="menu-item" onClick={run(() => useStore.setState({ elevationWallId: item.wallId ?? null, view: 'front' }))}>
              <Square size={14} /> Elevation of this wall
            </button>
          )}
          <div className="menu-sep" />
        </>
      )}
      {sel.kind === 'wall' && (
        <button className="menu-item" onClick={run(() => useStore.setState({ elevationWallId: sel.id, view: 'front' }))}>
          <Square size={14} /> Front elevation of this wall
        </button>
      )}
      <button className="menu-item" onClick={run(deleteSelection)}>
        <Trash2 size={14} /> Delete <kbd>Del</kbd>
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => useStore.getState().dismissToast(t.id)}>
          {t.kind === 'success' ? <CheckCircle2 size={15} color="#3ccf8e" /> : t.kind === 'error' ? <XCircle size={15} color="#ff5d5f" /> : <Info size={15} color="#3d8bff" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

