import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { AlertTriangle, ArrowLeftToLine, ArrowRightToLine, Box, Camera, CheckCircle2, Copy, Cpu, FilePlus2, FileDown, FlipHorizontal2, History, Info, ListChecks, RotateCw, Square, Trash2, XCircle } from 'lucide-react';
import { activeRoom, newId } from '@engine/index';
import {
  cutlistData,
  drawingSet,
  exportDrawingsPdf,
  deleteSelection,
  discardRecovery,
  duplicateSelection,
  exportCutlistCsv,
  exportHardwareCsv,
  mirrorSelection,
  newProject,
  pushSelection,
  recover,
  rotateSelection,
} from '../state/actions';
import { platform } from '../platform/bridge';
import { useStore, type DialogKind } from '../state/store';
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

function DrawingsDialog() {
  const doc = useStore((s) => s.doc);
  const sheets = useMemo(() => drawingSet(), [doc]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      wide
      title="Drawings"
      icon={<FileDown size={18} />}
      onClose={close}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            {sheets.length} A3 sheet{sheets.length === 1 ? '' : 's'}: floor plan and an elevation for every wall with cabinets. Dimensions come from the same model as the cutlist.
          </span>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await exportDrawingsPdf();
              setBusy(false);
            }}
          >
            <FileDown size={14} /> {busy ? 'Exporting…' : 'Export PDF'}
          </button>
        </>
      }
    >
      <div className="sheets">
        {sheets.map((s) => (
          <figure key={s.title} className="sheet-preview">
            <div className="sheet-svg" dangerouslySetInnerHTML={{ __html: s.svg }} />
            <figcaption>{s.title}</figcaption>
          </figure>
        ))}
      </div>
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

export function Fragmentish({ k, v }: { k: string; v: string }) {
  return (
    <>
      <div>{k}</div>
      <div>{v}</div>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ['1 – 5', 'Plan, front, side, 3D, walkthrough'],
  ['V / W / T', 'Select, draw walls, tape measure'],
  ['Click, then click a door', 'Select a cabinet, then one door or drawer'],
  ['R / Shift+R', 'Rotate 90°'],
  ['M', 'Mirror handing'],
  ['Ctrl+D', 'Duplicate'],
  ['Delete', 'Delete'],
  ['Arrows (Shift)', 'Nudge 1 mm (10 mm)'],
  ['F', 'Frame the room'],
  ['G / E', 'Grid snap on/off, part edges on/off'],
  ['Esc', 'Cancel, step back from a door, deselect'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
  ['Ctrl+S / Ctrl+O', 'Save / open'],
  ['Ctrl+L / Ctrl+P / Ctrl+R', 'Cutlist / drawings / render'],
  ['[ / ]', 'Push selection hard left / right'],
  ['X', 'X-ray: see through doors, panels and kickboards'],
  ['Right-drag, scroll', 'Pan, zoom to the cursor (3D: left-drag empty space to orbit)'],
  ['Middle-drag', 'Orbit / tilt the 3D camera'],
];

function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts" icon={<Info size={18} />} onClose={close} footer={<button className="btn" onClick={close}>Close</button>}>
      <div className="kv">
        {SHORTCUTS.map(([k, v]) => (
          <Fragmentish key={k} k={k} v={v} />
        ))}
      </div>
      <div className="hint">Number fields accept sums: 600+18, (900-3)/2. Drag the ↔ label beside a size to scrub it.</div>
    </Modal>
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

export const dialogRegistry: Partial<Record<NonNullable<DialogKind>, () => ReactElement | null>> = {};

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  switch (dialog) {
    case 'new-project':
      return <NewProjectDialog />;
    case 'cutlist':
      return <CutlistDialog />;
    case 'drawings':
      return <DrawingsDialog />;
    case 'recovery':
      return <RecoveryDialog />;
    case 'about':
      return <AboutDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    default:
      return (dialog && dialogRegistry[dialog]?.()) || null;
  }
}

export function ConfirmDialog() {
  const c = useStore((s) => s.confirmState);
  if (!c) return null;
  return (
    <Modal
      title="Please confirm"
      onClose={() => c.resolve(false)}
      footer={
        <>
          <button className="btn" onClick={() => c.resolve(false)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => c.resolve(true)} autoFocus>
            {c.okLabel}
          </button>
        </>
      }
    >
      <div>{c.message}</div>
    </Modal>
  );
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
          <button className="menu-item" onClick={run(() => pushSelection('left'))}>
            <ArrowLeftToLine size={14} /> Push left <kbd>[</kbd>
          </button>
          <button className="menu-item" onClick={run(() => pushSelection('right'))}>
            <ArrowRightToLine size={14} /> Push right <kbd>]</kbd>
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

