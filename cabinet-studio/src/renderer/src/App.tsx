import { useEffect, useRef, useState } from 'react';
import { activeRoom, addWall, pointAtLength, type Item, updateItem } from '@engine/index';
import { isDesktop, platform } from './platform/bridge';
import { checkRecovery, deleteSelection, duplicateSelection, mirrorSelection, openFromPath, rotateSelection, runCommand, startAutosave } from './state/actions';
import { isDirty, savePrefs, useDerived, useStore } from './state/store';
import { BottomBar } from './ui/BottomBar';
import { ConfirmDialog, ContextMenu, Dialogs, Toasts } from './ui/Dialogs';
import { LeftPanel } from './ui/LeftPanel';
import { RightPanel } from './ui/RightPanel';
import { TopBar } from './ui/TopBar';
import { Viewport } from './viewport/Viewport';
import { elevationFace, wallName } from './viewport/views';

const S = () => useStore.getState();

function editingText(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function onKey(e: KeyboardEvent): void {
  if (editingText(e)) return;
  const s = S();
  if (s.dialog || s.confirmState) return;
  if (s.view === 'walk' && ['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  // Wall tool: typed lengths.
  if (s.tool === 'wall' && s.drawing.points.length) {
    if (/^[0-9.]$/.test(e.key) || (e.key === '-' && !s.drawing.typed)) {
      useStore.setState({ drawing: { ...s.drawing, typed: s.drawing.typed + e.key } });
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' && s.drawing.typed) {
      useStore.setState({ drawing: { ...s.drawing, typed: s.drawing.typed.slice(0, -1) } });
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && s.drawing.typed) {
      const len = parseFloat(s.drawing.typed);
      const last = s.drawing.points[s.drawing.points.length - 1];
      if (len > 0) {
        const towards = s.drawing.cursor && (s.drawing.cursor.x !== last.x || s.drawing.cursor.y !== last.y) ? s.drawing.cursor : { x: last.x + 1, y: last.y };
        const p = pointAtLength(last, towards, len);
        const room = activeRoom(s.doc);
        s.commit((d) => addWall(d, last, p, room.walls[room.walls.length - 1]?.thickness ?? 110, room.ceilingHeight).doc);
        useStore.setState({ drawing: { points: [...s.drawing.points, p], cursor: p, typed: '' } });
      }
      e.preventDefault();
      return;
    }
  }
  if (e.key === 'Escape') {
    if (s.txBase) s.cancelPreview();
    else if (s.tool !== 'select') s.setTool('select');
    else if (s.selection?.front) s.select({ kind: s.selection.kind, id: s.selection.id });
    else s.select(null);
    useStore.setState({ contextMenu: null });
    return;
  }
  if (ctrl) {
    // In the desktop app these come through the native menu instead.
    if (isDesktop && ['z', 'y', 's', 'o', 'n', 'l', 'r', 'p'].includes(k)) return;
    if (k === 'z') runCommand(e.shiftKey ? 'redo' : 'undo');
    else if (k === 'y') runCommand('redo');
    else if (k === 's') runCommand(e.shiftKey ? 'save-as' : 'save');
    else if (k === 'o') runCommand('open');
    else if (k === 'n') runCommand('new');
    else if (k === 'l') runCommand('cutlist');
    else if (k === 'r') runCommand('render');
    else if (k === 'p') runCommand('drawings');
    else if (k === 'd') duplicateSelection();
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;
  const sel = s.selection;
  if (sel?.kind === 'item' && e.key.startsWith('Arrow')) {
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
    s.commit((d) => updateItem<Item>(d, sel.id, (i) => ({ ...i, placement: { ...i.placement, x: i.placement.x + dx, y: i.placement.y + dy } })));
    e.preventDefault();
    return;
  }
  switch (k) {
    case 'delete':
    case 'backspace':
      deleteSelection();
      break;
    case 'r':
      rotateSelection(e.shiftKey ? -Math.PI / 2 : Math.PI / 2);
      break;
    case 'm':
      mirrorSelection();
      break;
    case 'v':
      s.setTool('select');
      break;
    case 'w':
      s.setTool('wall');
      break;
    case 't':
      s.setTool('measure');
      break;
    case 'g':
      useStore.setState({ snap: { ...s.snap, grid: !s.snap.grid } });
      break;
    case 'e':
      useStore.setState({ showEdges: !s.showEdges });
      break;
    case 'f':
      useStore.setState({ frameRequest: s.frameRequest + 1 });
      break;
    case '1':
      s.setView('plan');
      break;
    case '2':
      s.setView('front');
      break;
    case '3':
      s.setView('side');
      break;
    case '4':
      s.setView('3d');
      break;
    case '5':
      s.setView('walk');
      break;
    default:
      return;
  }
  e.preventDefault();
}

function Splitter({ side }: { side: 'left' | 'right' }) {
  const [active, setActive] = useState(false);
  return (
    <div
      className={`splitter${active ? ' active' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        setActive(true);
        const x0 = e.clientX;
        const p0 = S().panels;
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - x0;
          const panels = side === 'left' ? { ...p0, leftWidth: Math.min(520, Math.max(220, p0.leftWidth + dx)) } : { ...p0, rightWidth: Math.min(560, Math.max(260, p0.rightWidth - dx)) };
          useStore.setState({ panels });
        };
        const up = () => {
          setActive(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          savePrefs(S());
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}

function ElevationPicker() {
  const view = useStore((s) => s.view);
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const elevationWallId = useStore((s) => s.elevationWallId);
  const d = useDerived();
  if (view !== 'front' && view !== 'side') return null;
  const face = elevationFace({ selection, elevationWallId }, d);
  const walls = activeRoom(doc).walls;
  return (
    <div className="elev-picker">
      <span>Wall</span>
      {walls.map((w) => (
        <button key={w.id} className={`tb-btn${face?.wallId === w.id ? ' active' : ''}`} onClick={() => useStore.setState({ elevationWallId: w.id })}>
          {wallName(doc, w.id)}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const panels = useStore((s) => s.panels);
  const doc = useStore((s) => s.doc);
  const dirty = useStore(isDirty);
  const fileName = useStore((s) => s.fileName);
  const started = useRef(false);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    const offMenu = platform.onMenu(runCommand);
    const offOpen = platform.onOpenPath((p) => void openFromPath(p));
    const stopAutosave = startAutosave();
    if (!started.current) {
      started.current = true;
      void platform.takePendingOpenPath().then((p) => (p ? openFromPath(p) : checkRecovery()));
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      offMenu();
      offOpen();
      stopAutosave();
    };
  }, []);

  useEffect(() => {
    platform.setTitle(`${fileName ?? doc.name}${dirty ? ' •' : ''} — Cabinet Studio`);
    platform.setDirty(dirty);
  }, [doc.name, dirty, fileName]);

  useEffect(() => {
    if (isDesktop) return;
    const h = (e: BeforeUnloadEvent) => {
      if (isDirty(S())) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const cols = [panels.left ? `${panels.leftWidth}px 0px` : '', 'minmax(0, 1fr)', panels.right ? `0px ${panels.rightWidth}px` : ''].filter(Boolean).join(' ');
  return (
    <div className="app">
      <TopBar />
      <div className="workspace" style={{ gridTemplateColumns: cols }}>
        {panels.left && (
          <>
            <aside className="panel">
              <LeftPanel />
            </aside>
            <Splitter side="left" />
          </>
        )}
        <main className="center">
          <Viewport />
          <ElevationPicker />
          <Toasts />
        </main>
        {panels.right && (
          <>
            <Splitter side="right" />
            <aside className="panel right">
              <RightPanel />
            </aside>
          </>
        )}
      </div>
      <BottomBar />
      <Dialogs />
      <ConfirmDialog />
      <ContextMenu />
    </div>
  );
}
