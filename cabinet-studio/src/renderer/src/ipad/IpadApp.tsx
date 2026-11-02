import { useEffect, useState, type ReactElement } from 'react';
import { ArrowLeftToLine, ArrowRightToLine, Box, Copy, FlipHorizontal2, FolderOpen, HelpCircle, Library, Moon, Pencil, Redo2, RotateCw, Ruler, Save, Trash2, Undo2, X, FileText, FilePlus2, ListChecks, PanelsTopLeft, Layers, ChevronDown, Sun } from 'lucide-react';
import { activeRoom, findItem, panelTemplateById, templateById } from '@engine/index';
import { checkRecovery, deleteSelection, duplicateSelection, mirrorSelection, openProjectFlow, pushSelection, rotateSelection, runAutoKicks, runAutoTops, saveFlow, startAutosave } from '../state/actions';
import { setTheme, useStore } from '../state/store';
import { ConfirmDialog, ContextMenu, Dialogs, Toasts } from '../ui/Dialogs';
import { LeftPanel } from '../ui/LeftPanel';
import { RightPanel } from '../ui/RightPanel';
import { Modal } from '../ui/controls';
import { wallName } from '../viewport/views';
import { Plan2D } from './Plan2D';

const WIDE = 1000;
const useWide = () => {
  const [wide, setWide] = useState(window.innerWidth >= WIDE);
  useEffect(() => {
    const h = () => setWide(window.innerWidth >= WIDE);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return wide;
};

const GESTURES = [
  'Tap a library card, then tap the plan to place it',
  'Drag a cabinet to move it',
  'One finger on empty space, or two fingers, to pan',
  'Pinch to zoom',
  'Double-tap empty space to fit the room',
  'Long-press a cabinet for its menu',
];

function armedName(a: NonNullable<ReturnType<typeof useStore.getState>['armed']>): string {
  if (a.kind === 'cabinet') return templateById(a.id)?.name ?? 'cabinet';
  if (a.kind === 'panel') return panelTemplateById(a.id)?.name ?? 'panel';
  return a.id;
}

export function IpadApp() {
  const wide = useWide();
  const [left, setLeft] = useState(wide);
  const [right, setRight] = useState(false);
  const [menu, setMenu] = useState<null | 'file' | 'wall'>(null);
  const [help, setHelp] = useState(false);
  const s = useStore();
  const walls = activeRoom(s.doc).walls;
  const sel = s.selection;
  const item = sel?.kind === 'item' ? findItem(s.doc, sel.id) : null;
  const S = useStore.getState;
  const pick = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  useEffect(() => {
    const stop = startAutosave();
    void checkRecovery();
    return stop;
  }, []);
  useEffect(() => {
    if (S().view === '3d' || S().view === 'walk' || S().view === 'side') S().setView('plan');
  }, [s.view]);
  useEffect(() => {
    if (s.armed && !wide) setLeft(false);
  }, [s.armed, wide]);

  const btn = (label: string, icon: ReactElement, on: () => void, extra: { disabled?: boolean; active?: boolean } = {}) => (
    <button className={`tb-btn${extra.active ? ' active' : ''}`} onClick={on} disabled={extra.disabled}>
      {icon}
      {label}
    </button>
  );

  return (
    <div className="ip-shell">
      <header className="ip-top">
        {btn('', <Library size={20} />, () => setLeft(!left), { active: left })}
        <div className="ip-menu-wrap">
          {btn('File', <FileText size={20} />, () => setMenu(menu === 'file' ? null : 'file'))}
          {menu === 'file' && (
            <div className="ip-menu">
              {btn('New', <FilePlus2 size={20} />, pick(() => useStore.setState({ dialog: 'new-project' })))}
              {btn('Open', <FolderOpen size={20} />, pick(() => void openProjectFlow()))}
              {btn('Save', <Save size={20} />, pick(() => void saveFlow()))}
              {btn('Save as', <Save size={20} />, pick(() => void saveFlow(true)))}
            </div>
          )}
        </div>
        {btn('', <Undo2 size={20} />, s.undo, { disabled: !s.past.length })}
        {btn('', <Redo2 size={20} />, s.redo, { disabled: !s.future.length })}
        <div className="ip-seg">
          {btn('Plan', <PanelsTopLeft size={20} />, () => s.setView('plan'), { active: s.view === 'plan' })}
          <div className="ip-menu-wrap">
            {btn('Wall', <ChevronDown size={20} />, () => setMenu(menu === 'wall' ? null : 'wall'), { active: s.view === 'front' })}
            {menu === 'wall' && (
              <div className="ip-menu">
                {walls.map((w) => (
                  <button
                    key={w.id}
                    className={`tb-btn${s.elevationWallId === w.id && s.view === 'front' ? ' active' : ''}`}
                    onClick={pick(() => {
                      useStore.setState({ elevationWallId: w.id });
                      s.setView('front');
                    })}
                  >
                    Wall {wallName(s.doc, w.id)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="ip-spacer" />
        {btn('Auto tops', <Layers size={20} />, runAutoTops)}
        {btn('Auto kicks', <Ruler size={20} />, runAutoKicks)}
        {btn('Cutlist', <ListChecks size={20} />, () => useStore.setState({ dialog: 'cutlist' }))}
        {btn('Drawings', <Box size={20} />, () => useStore.setState({ dialog: 'drawings' }))}
        {btn('', s.theme === 'night' ? <Sun size={20} /> : <Moon size={20} />, () => setTheme(s.theme === 'night' ? 'standard' : 'night'))}
        {btn('', <HelpCircle size={20} />, () => setHelp(true))}
      </header>
      <div className="ip-body">
        {left && (
          <aside className={`ip-drawer left${wide ? ' docked' : ''}`}>
            <LeftPanel />
          </aside>
        )}
        <main className="ip-main">
          <Plan2D />
          <Toasts />
          {s.armed && (
            <div className="ip-banner">
              Tap the plan to place {armedName(s.armed)}
              <button className="tb-btn icon" aria-label="Cancel" onClick={() => useStore.setState({ armed: null })}>
                <X size={20} />
              </button>
            </div>
          )}
        </main>
        {right && (
          <aside className={`ip-drawer right${wide ? ' docked' : ''}`}>
            <button className="tb-btn icon ip-close" aria-label="Close" onClick={() => setRight(false)}>
              <X size={20} />
            </button>
            <RightPanel />
          </aside>
        )}
      </div>
      {item && (
        <footer className="ip-actions">
          {btn('Push left', <ArrowLeftToLine size={20} />, () => pushSelection('left'))}
          {btn('Push right', <ArrowRightToLine size={20} />, () => pushSelection('right'))}
          {btn('Rotate 90°', <RotateCw size={20} />, () => rotateSelection())}
          {btn('Mirror', <FlipHorizontal2 size={20} />, () => mirrorSelection(), { disabled: item.kind !== 'cabinet' })}
          {btn('Copy', <Copy size={20} />, () => duplicateSelection())}
          {btn('Edit', <Pencil size={20} />, () => setRight(true))}
          {btn('Delete', <Trash2 size={20} />, () => deleteSelection())}
        </footer>
      )}
      {help && (
        <Modal title="Touch gestures" icon={<HelpCircle size={18} />} onClose={() => setHelp(false)}>
          <ul className="ip-help">
            {GESTURES.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Modal>
      )}
      <Dialogs />
      <ConfirmDialog />
      <ContextMenu />
    </div>
  );
}
