import { useEffect, useState } from 'react';
import { AlertTriangle, Camera, Cpu } from 'lucide-react';
import { newId, type LightingPreset, type RenderSettings } from '@engine/index';
import type { GpuReport as BridgeGpuReport } from '@shared/ipc';
import { exportPng } from '../state/actions';
import { platform } from '../platform/bridge';
import { useStore } from '../state/store';
import { getEngine, rendererPreference, setRendererPreference } from '../viewport/Viewport';
import { QUALITY, QUALITY_ORDER } from '../viewport/quality';
import { Modal, Row, Seg, Toggle } from './controls';
import { dialogRegistry, Fragmentish } from './Dialogs';

const close = () => useStore.setState({ dialog: null });

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
        <div>3D drawn on</div>
        <div>{gpu?.adapter ?? '—'}</div>
        <div>Browser display GPU</div>
        <div>{gpu?.displayGpu || '—'}</div>
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
      {gpu?.integrated && (
        <div className="warn">
          <AlertTriangle size={14} style={{ flex: 'none', marginTop: 1 }} />
          <span>
            The 3D view is running on integrated graphics. If this PC has a graphics card (NVIDIA / AMD): Windows Settings → System → Display → Graphics → choose your browser (or
            Cabinet Studio) → Options → <b>High performance</b> → Save, then restart it. On a desktop, also make sure the monitor cable is plugged into the graphics card, not the
            motherboard.
          </span>
        </div>
      )}
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

dialogRegistry.render = () => <RenderDialog />;
dialogRegistry.gpu = () => <GpuDialog />;
