import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Camera,
  ChevronDown,
  Copy,
  Cpu,
  Eye,
  FileDown,
  FileText,
  FilePlus2,
  FlipHorizontal2,
  FolderOpen,
  Footprints,
  Gauge,
  Info,
  Keyboard,
  LayoutGrid,
  ListChecks,
  MousePointer2,
  PanelBottom,
  PenLine,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  Sidebar,
  Square,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { QualityPreset } from '@engine/index';
import { deleteSelection, duplicateSelection, exportCutlistCsv, exportHardwareCsv, mirrorSelection, rotateSelection, runAutoKicks, runAutoTops, runCommand } from '../state/actions';
import { isDirty, useStore, type ViewMode } from '../state/store';
import { QUALITY, QUALITY_ORDER } from '../viewport/quality';

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onOut();
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [active, onOut, ref]);
}

/**
 * Position a dropdown against the window (position: fixed) from its trigger, so it is
 * never clipped by the scrolling top bar it lives in.
 */
export function popupStyle(trigger: HTMLElement | null, align: 'left' | 'right', placement: 'below' | 'above' = 'below'): React.CSSProperties {
  if (!trigger) return {};
  const r = trigger.getBoundingClientRect();
  const vertical: React.CSSProperties = placement === 'below' ? { top: r.bottom + 6, bottom: 'auto' } : { bottom: window.innerHeight - r.top + 6, top: 'auto' };
  const horizontal: React.CSSProperties =
    align === 'right' ? { right: Math.max(8, window.innerWidth - r.right), left: 'auto' } : { left: Math.max(8, Math.min(r.left, window.innerWidth - 268)), right: 'auto' };
  return { position: 'fixed', ...vertical, ...horizontal };
}

function Menu({ label, icon, children, right }: { label: string; icon?: React.ReactNode; children: (close: () => void) => React.ReactNode; right?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    // A fixed popup would drift if the bar scrolls or the window resizes: close it instead.
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    const bar = ref.current?.closest('.topbar');
    bar?.addEventListener('scroll', close);
    return () => {
      window.removeEventListener('resize', close);
      bar?.removeEventListener('scroll', close);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`tb-btn${open ? ' active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {icon}
        {label}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className={`menu-pop${right ? ' right' : ''}`} style={popupStyle(ref.current, right ? 'right' : 'left')}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const VIEWS: { v: ViewMode; label: string; key: string; icon: React.ReactNode }[] = [
  { v: 'plan', label: 'Plan', key: '1', icon: <LayoutGrid size={15} /> },
  { v: 'front', label: 'Front', key: '2', icon: <Square size={15} /> },
  { v: 'side', label: 'Side', key: '3', icon: <PanelBottom size={15} /> },
  { v: '3d', label: '3D', key: '4', icon: <Box size={15} /> },
  { v: 'walk', label: 'Walk', key: '5', icon: <Footprints size={15} /> },
];

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+';

export function TopBar() {
  const doc = useStore((s) => s.doc);
  const dirty = useStore(isDirty);
  const canUndo = useStore((s) => s.past.length > 0 || !!s.txBase);
  const canRedo = useStore((s) => s.future.length > 0);
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const quality = useStore((s) => s.quality);
  const hasSel = useStore((s) => s.selection?.kind === 'item');
  const anySel = useStore((s) => !!s.selection);
  const panels = useStore((s) => s.panels);
  const s = useStore.getState();
  const item = (icon: React.ReactNode, label: string, run: () => void, close: () => void, kbd?: string, disabled?: boolean) => (
    <button
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        close();
        run();
      }}
    >
      {icon}
      {label}
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <Box size={14} color="white" />
        </div>
        <span>Cabinet Studio</span>
        <small title={doc.name}>
          {doc.name}
          {dirty ? ' •' : ''}
        </small>
      </div>
      <Menu label="File">
        {(close) => (
          <>
            {item(<FilePlus2 size={15} />, 'New project…', () => runCommand('new'), close, `${mod}N`)}
            {item(<FolderOpen size={15} />, 'Open…', () => runCommand('open'), close, `${mod}O`)}
            {item(<Save size={15} />, 'Save', () => runCommand('save'), close, `${mod}S`)}
            {item(<Save size={15} />, 'Save as…', () => runCommand('save-as'), close, `${mod}⇧S`)}
            <div className="menu-sep" />
            {item(<ListChecks size={15} />, 'Cutlist & hardware…', () => runCommand('cutlist'), close, `${mod}L`)}
            {item(<FileDown size={15} />, 'Export cutlist (CSV)…', () => void exportCutlistCsv(), close)}
            {item(<FileDown size={15} />, 'Export hardware (CSV)…', () => void exportHardwareCsv(), close)}
            {item(<FileText size={15} />, 'Drawings (PDF)…', () => runCommand('drawings'), close, `${mod}P`)}
            {item(<Camera size={15} />, 'Render image…', () => runCommand('render'), close, `${mod}R`)}
          </>
        )}
      </Menu>
      <Menu label="Help">
        {(close) => (
          <>
            {item(<Cpu size={15} />, 'Graphics & GPU…', () => runCommand('gpu'), close)}
            {item(<Keyboard size={15} />, 'Keyboard shortcuts…', () => useStore.setState({ dialog: 'shortcuts' }), close)}
            {item(<Info size={15} />, 'About Cabinet Studio', () => runCommand('about'), close)}
          </>
        )}
      </Menu>
      <div className="tb-group">
        <button className="tb-btn icon" title={`Undo (${mod}Z)`} disabled={!canUndo} onClick={() => s.undo()}>
          <Undo2 size={16} />
        </button>
        <button className="tb-btn icon" title={`Redo (${mod}Y)`} disabled={!canRedo} onClick={() => s.redo()}>
          <Redo2 size={16} />
        </button>
      </div>
      <div className="tb-group">
        <button className={`tb-btn${tool === 'select' ? ' active' : ''}`} title="Select & move (V)" onClick={() => s.setTool('select')}>
          <MousePointer2 size={15} /> Select
        </button>
        <button className={`tb-btn${tool === 'wall' ? ' active' : ''}`} title="Draw walls (W)" onClick={() => s.setTool(tool === 'wall' ? 'select' : 'wall')}>
          <PenLine size={15} /> Walls
        </button>
        <button className={`tb-btn${tool === 'measure' ? ' active' : ''}`} title="Measure (T)" onClick={() => s.setTool(tool === 'measure' ? 'select' : 'measure')}>
          <Ruler size={15} /> Measure
        </button>
      </div>
      <div className="tb-group">
        <button className="tb-btn icon" title="Rotate 90° (R)" disabled={!hasSel} onClick={() => rotateSelection()}>
          <RotateCw size={16} />
        </button>
        <button className="tb-btn icon" title="Mirror handing (M)" disabled={!hasSel} onClick={mirrorSelection}>
          <FlipHorizontal2 size={16} />
        </button>
        <button className="tb-btn icon" title={`Duplicate (${mod}D)`} disabled={!hasSel} onClick={duplicateSelection}>
          <Copy size={16} />
        </button>
        <button className="tb-btn icon" title="Delete (Del)" disabled={!anySel} onClick={deleteSelection}>
          <Trash2 size={16} />
        </button>
        <button className="tb-btn" title="Generate benchtops and splashbacks for every run of base cabinets" onClick={runAutoTops}>
          Auto tops
        </button>
        <button className="tb-btn" title="Generate continuous kickboards for every run of floor cabinets" onClick={runAutoKicks}>
          Auto kicks
        </button>
      </div>
      <div className="tb-group">
        {VIEWS.map((x) => (
          <button key={x.v} className={`tb-btn${view === x.v ? ' active' : ''}`} title={`${x.label} (${x.key})`} onClick={() => s.setView(x.v)}>
            {x.icon}
            {x.label}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <div className="tb-group">
        <button className={`tb-btn icon${panels.left ? ' active' : ''}`} title="Toggle library panel" onClick={() => useStore.setState({ panels: { ...panels, left: !panels.left } })}>
          <Sidebar size={15} />
        </button>
        <button className={`tb-btn icon${panels.right ? ' active' : ''}`} title="Toggle properties panel" onClick={() => useStore.setState({ panels: { ...panels, right: !panels.right } })}>
          <Sidebar size={15} style={{ transform: 'scaleX(-1)' }} />
        </button>
      </div>
      <Menu label={quality[0].toUpperCase() + quality.slice(1)} icon={<Gauge size={15} />} right>
        {(close) => (
          <>
            <div className="menu-head">Render quality</div>
            {QUALITY_ORDER.map((q: QualityPreset) => (
              <button
                key={q}
                className="menu-item"
                onClick={() => {
                  s.setQuality(q);
                  close();
                }}
              >
                <Eye size={14} />
                {QUALITY[q].label}
                {q === quality && <span className="check">●</span>}
              </button>
            ))}
          </>
        )}
      </Menu>
      <button className="tb-btn" onClick={() => runCommand('drawings')} title={`Drawings (${mod}P)`}>
        <FileText size={15} /> Drawings
      </button>
      <button className="tb-btn" onClick={() => runCommand('cutlist')} title={`Cutlist & hardware (${mod}L)`}>
        <ListChecks size={15} /> Cutlist
      </button>
      <button className="tb-btn primary" onClick={() => runCommand('render')} title={`Render (${mod}R)`}>
        <Camera size={15} /> Render
      </button>
    </header>
  );
}
