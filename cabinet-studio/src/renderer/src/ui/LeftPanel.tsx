import { useMemo, useState, type ReactElement } from 'react';
import { Box, ChevronDown, ChevronRight, DoorOpen, Home, ImagePlus, Layers, PenLine, Search, SquareDashed } from 'lucide-react';
import {
  activeRoom,
  CABINET_TEMPLATES,
  MATERIAL_SLOT_LABELS,
  newId,
  PANEL_TEMPLATES,
  setRectangularRoom,
  updateRoom,
  wallLength,
  type MaterialDef,
  type MaterialSlot,
} from '@engine/index';
import { addFromLibrary, type LibraryDrag } from '../state/actions';
import { useStore } from '../state/store';
import { libraryDrag } from '../viewport/Viewport';
import { wallName } from '../viewport/views';
import { NumberField, Row, Section } from './controls';
import { CabinetThumb, OpeningThumb, PanelThumb } from './Thumb';

type Tab = 'library' | 'room' | 'materials';

function dragProps(drag: LibraryDrag) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      libraryDrag.current = drag;
      e.dataTransfer.setData('text/plain', `${drag.kind}:${drag.id}`);
      e.dataTransfer.effectAllowed = 'copy';
    },
    onDragEnd: () => {
      libraryDrag.current = null;
    },
    onDoubleClick: () => addFromLibrary(drag),
    title: 'Drag into the room, or double-click to add',
  };
}

function Library() {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const match = (s: string) => !ql || s.toLowerCase().includes(ql);
    const g = new Map<string, ReactElement[]>();
    for (const t of CABINET_TEMPLATES) {
      if (!match(`${t.name} ${t.group} ${t.description}`)) continue;
      const list = g.get(t.group) ?? [];
      list.push(
        <button key={t.id} className="lib-card" {...dragProps({ kind: 'cabinet', id: t.id })}>
          <div className="thumb">
            <CabinetThumb t={t} />
          </div>
          <div className="name">{t.name}</div>
          <div className="size">
            {t.params.width}×{t.params.height}×{t.params.depth}
          </div>
        </button>,
      );
      g.set(t.group, list);
    }
    for (const t of PANEL_TEMPLATES) {
      if (!match(`${t.name} ${t.group} ${t.description}`)) continue;
      const list = g.get(t.group) ?? [];
      list.push(
        <button key={t.id} className="lib-card" {...dragProps({ kind: 'panel', id: t.id })}>
          <div className="thumb">
            <PanelThumb t={t} />
          </div>
          <div className="name">{t.name}</div>
          <div className="size">
            {t.width}×{t.height}×{t.depth}
          </div>
        </button>,
      );
      g.set(t.group, list);
    }
    return [...g.entries()];
  }, [q]);
  return (
    <>
      <div className="search">
        <Search size={15} />
        <input placeholder="Search cabinets, panels…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      {groups.map(([name, cards]) => (
        <div key={name}>
          <button className="group-head" onClick={() => setClosed({ ...closed, [name]: !closed[name] })}>
            {closed[name] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            {name}
            <span className="count">{cards.length}</span>
          </button>
          {!closed[name] && <div className="lib-grid">{cards}</div>}
        </div>
      ))}
      {groups.length === 0 && <div className="empty">Nothing matches “{q}”.</div>}
    </>
  );
}

function RoomTab() {
  const doc = useStore((s) => s.doc);
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const room = activeRoom(doc);
  const loop = room.walls.length;
  const [size, setSize] = useState({ width: 4200, depth: 3200, height: room.ceilingHeight, thickness: room.walls[0]?.thickness ?? 110 });
  const s = useStore.getState();
  const floors = doc.materials.filter((m) => m.category === 'floor' || m.category === 'stone' || m.category === 'engineered-stone' || m.category === 'solid-timber');
  const wallsM = doc.materials.filter((m) => m.category === 'wall' || m.category === 'paint' || m.category === 'custom');
  return (
    <>
      <Section title="Rectangular room" extra="clear inside sizes">
        <div className="row2">
          <label className="stack-label">
            <span>Width</span>
            <NumberField value={size.width} min={500} max={30000} onCommit={(v) => setSize({ ...size, width: v })} />
          </label>
          <label className="stack-label">
            <span>Depth</span>
            <NumberField value={size.depth} min={500} max={30000} onCommit={(v) => setSize({ ...size, depth: v })} />
          </label>
          <label className="stack-label">
            <span>Ceiling height</span>
            <NumberField value={size.height} min={1800} max={6000} onCommit={(v) => setSize({ ...size, height: v })} />
          </label>
          <label className="stack-label">
            <span>Wall thickness</span>
            <NumberField value={size.thickness} min={50} max={600} onCommit={(v) => setSize({ ...size, thickness: v })} />
          </label>
        </div>
        <button
          className="btn primary block"
          onClick={() => {
            if (loop && !window.confirm('Replace the current walls with a rectangular room? Cabinets are kept; windows and doors are removed.')) return;
            s.commit((d) => setRectangularRoom(d, size.width, size.depth, size.height, size.thickness));
            useStore.setState({ frameRequest: useStore.getState().frameRequest + 1 });
          }}
        >
          <Home size={15} /> {loop ? 'Rebuild room' : 'Create room'}
        </button>
      </Section>
      <Section title="Walls" extra={`${room.walls.length}`}>
        <button className={`btn block${tool === 'wall' ? ' primary' : ''}`} onClick={() => s.setTool(tool === 'wall' ? 'select' : 'wall')}>
          <PenLine size={15} /> {tool === 'wall' ? 'Finish drawing walls' : 'Draw walls'}
        </button>
        <div className="list">
          {room.walls.map((w) => (
            <button key={w.id} className={`list-item${selection?.kind === 'wall' && selection.id === w.id ? ' active' : ''}`} onClick={() => s.select({ kind: 'wall', id: w.id })}>
              <SquareDashed size={14} /> Wall {wallName(doc, w.id)}
              <span className="right">{Math.round(wallLength(w))} mm</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Windows & doors">
        <div className="lib-grid">
          {(['window', 'door'] as const).map((k) => (
            <button key={k} className="lib-card" {...dragProps({ kind: 'opening', id: k })}>
              <div className="thumb">
                <OpeningThumb kind={k} />
              </div>
              <div className="name">{k === 'window' ? 'Window' : 'Door'}</div>
              <div className="size">{k === 'window' ? '1200×1050' : '820×2040'}</div>
            </button>
          ))}
        </div>
        <div className="hint">Drag onto a wall. Drag an opening to slide it along its wall.</div>
      </Section>
      <Section title="Room finishes">
        <Row label="Floor">
          <select className="select" value={room.floorMaterialId} onChange={(e) => s.commit((d) => updateRoom(d, (r) => ({ ...r, floorMaterialId: e.target.value })))}>
            {floors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Walls">
          <select className="select" value={room.wallMaterialId} onChange={(e) => s.commit((d) => updateRoom(d, (r) => ({ ...r, wallMaterialId: e.target.value })))}>
            {wallsM.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
      </Section>
    </>
  );
}

export function swatchStyle(m: MaterialDef): React.CSSProperties {
  const a = m.appearance;
  if (a.kind === 'image' && a.imageDataUrl) return { backgroundImage: `url(${a.imageDataUrl})` };
  if (a.kind === 'wood') return { background: `repeating-linear-gradient(90deg, ${a.color} 0 5px, ${a.color2 ?? a.color} 5px 7px)` };
  if (a.kind === 'stone') return { background: `linear-gradient(135deg, ${a.color} 40%, ${a.color2 ?? a.color} 46%, ${a.color} 52%)` };
  if (a.kind === 'metal') return { background: `linear-gradient(180deg, #fff 0%, ${a.color} 45%, #777 100%)` };
  if (a.kind === 'glass') return { background: `linear-gradient(135deg, ${a.color}55, ${a.color}cc)` };
  return { background: a.color };
}

const SLOT_CATEGORIES: Record<MaterialSlot, string[] | null> = {
  carcass: ['melamine', 'laminate', 'veneer', 'mdf', 'plywood', 'board', 'custom'],
  front: ['melamine', 'laminate', 'veneer', 'solid-timber', 'mdf', 'plywood', 'paint', 'custom'],
  back: ['melamine', 'board', 'mdf', 'plywood', 'custom'],
  drawerBox: ['melamine', 'plywood', 'mdf', 'veneer', 'custom'],
  drawerBottom: ['board', 'melamine', 'plywood', 'mdf', 'custom'],
  kick: ['melamine', 'laminate', 'veneer', 'aluminium', 'stainless', 'custom'],
  panel: ['melamine', 'laminate', 'veneer', 'solid-timber', 'mdf', 'plywood', 'paint', 'custom'],
  benchtop: ['stone', 'engineered-stone', 'laminate', 'solid-timber', 'stainless', 'custom'],
  splashback: ['glass', 'stone', 'engineered-stone', 'laminate', 'stainless', 'custom'],
  handle: ['aluminium', 'stainless', 'custom'],
};

export function materialsForSlot(all: MaterialDef[], slot: MaterialSlot): MaterialDef[] {
  const cats = SLOT_CATEGORIES[slot];
  return cats ? all.filter((m) => cats.includes(m.category)) : all;
}

function MaterialsTab() {
  const doc = useStore((s) => s.doc);
  const s = useStore.getState();
  const importTexture = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 12 * 1024 * 1024) {
        s.toast('error', 'That image is over 12 MB — use a smaller texture.');
        return;
      }
      const url = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      });
      const def: MaterialDef = {
        id: newId('mat'),
        name: f.name.replace(/\.[a-z]+$/i, ''),
        category: 'custom',
        thicknesses: [16, 18],
        sheet: { length: 3600, width: 1800 },
        grain: true,
        appearance: { kind: 'image', color: '#ffffff', roughness: 0.5, metalness: 0, textureScale: 800, imageDataUrl: url },
      };
      s.commit((d) => ({ ...d, materials: [...d.materials, def] }));
      s.toast('success', `Imported “${def.name}”. Assign it under Project defaults or per cabinet.`);
    };
    input.click();
  };
  const groups = new Map<string, MaterialDef[]>();
  for (const m of doc.materials) groups.set(m.category, [...(groups.get(m.category) ?? []), m]);
  return (
    <>
      <Section title="Project defaults" extra="all cabinets">
        {(Object.keys(MATERIAL_SLOT_LABELS) as MaterialSlot[]).map((slot) => (
          <Row key={slot} label={MATERIAL_SLOT_LABELS[slot]}>
            <select
              className="select"
              value={doc.materialDefaults[slot]}
              onChange={(e) => s.commit((d) => ({ ...d, materialDefaults: { ...d.materialDefaults, [slot]: e.target.value } }))}
            >
              {materialsForSlot(doc.materials, slot).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Row>
        ))}
      </Section>
      <button className="btn block" onClick={importTexture} style={{ marginBottom: 10 }}>
        <ImagePlus size={15} /> Import texture…
      </button>
      {[...groups.entries()].map(([cat, list]) => (
        <Section key={cat} title={cat.replace('-', ' ').replace(/^\w/, (c) => c.toUpperCase())} extra={list.length} defaultOpen={false}>
          <div className="list">
            {list.map((m) => (
              <div key={m.id} className="list-item">
                <span className="swatch" style={swatchStyle(m)} />
                <span>
                  {m.name}
                  {m.supplier && <span className="muted"> · {m.supplier}</span>}
                </span>
                <span className="right">{m.thicknesses.length ? m.thicknesses.join('/') : '—'}</span>
              </div>
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('library');
  return (
    <>
      <div className="tabs">
        <button className={`tab${tab === 'library' ? ' active' : ''}`} onClick={() => setTab('library')}>
          <Box size={14} /> Library
        </button>
        <button className={`tab${tab === 'room' ? ' active' : ''}`} onClick={() => setTab('room')}>
          <DoorOpen size={14} /> Room
        </button>
        <button className={`tab${tab === 'materials' ? ' active' : ''}`} onClick={() => setTab('materials')}>
          <Layers size={14} /> Materials
        </button>
      </div>
      <div className="panel-body">
        {tab === 'library' && <Library />}
        {tab === 'room' && <RoomTab />}
        {tab === 'materials' && <MaterialsTab />}
      </div>
    </>
  );
}
