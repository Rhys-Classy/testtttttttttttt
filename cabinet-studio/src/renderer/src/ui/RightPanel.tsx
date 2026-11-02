import { useMemo } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Copy, FlipHorizontal2, Plus, RotateCw, Trash2, X } from 'lucide-react';
import {
  activeRoom,
  bandingCode,
  clashesWith,
  degToRad,
  hasBenchtop,
  MATERIAL_SLOT_LABELS,
  newId,
  radToDeg,
  templateById,
  updateItem,
  updateOpening,
  updateRoom,
  updateWall,
  type CabinetItem,
  type ConstructionRules,
  type EndMode,
  type FrontKind,
  type FrontSection,
  type HandleStyle,
  type Item,
  type ItemBuild,
  type MaterialSlot,
  type Opening,
  type PanelItem,
  type ProjectDocument,
  type Wall,
} from '@engine/index';
import { deleteSelection, duplicateSelection, mirrorSelection, rotateSelection } from '../state/actions';
import { deriver, useDerived, useStore } from '../state/store';
import { wallName } from '../viewport/views';
import { NumberField, Row, Section, Seg, TextField } from './controls';
import { materialsForSlot } from './LeftPanel';

const S = () => useStore.getState();

/** Live edit (no history) — paired with endPreview on scrub release. */
const previewItem = (id: string, fn: (i: Item) => Item) => S().preview((d) => updateItem<Item>(d, id, fn));
const commitItem = (id: string, fn: (i: Item) => Item) => S().commit((d) => updateItem<Item>(d, id, fn));
const end = () => S().endPreview();

function cabParam<K extends keyof CabinetItem['params']>(id: string, key: K, live: boolean) {
  return (v: CabinetItem['params'][K]) => {
    const fn = (i: Item) => (i.kind === 'cabinet' ? { ...i, params: { ...i.params, [key]: v } } : i);
    if (live) previewItem(id, fn);
    else commitItem(id, fn);
  };
}

function DimField({ id, k, value, min, max, label }: { id: string; k: 'width' | 'height' | 'depth' | 'kickHeight'; value: number; min: number; max: number; label: string }) {
  return (
    <label className="stack-label">
      <span>{label}</span>
      <NumberField value={value} min={min} max={max} scrubLabel="↔" onCommit={cabParam(id, k, false)} onPreview={cabParam(id, k, true)} onScrubEnd={end} />
    </label>
  );
}

function PlacementFields({ item }: { item: Item }) {
  const doc = useStore((s) => s.doc);
  const p = item.placement;
  const setP = (patch: Partial<Item['placement']>, live = false) => (live ? previewItem : commitItem)(item.id, (i) => ({ ...i, placement: { ...i.placement, ...patch } }));
  return (
    <Section title="Position" extra={item.wallId ? `on wall ${wallName(doc, item.wallId)}` : 'free'}>
      <div className="row3">
        <label className="stack-label">
          <span>X</span>
          <NumberField value={p.x} onCommit={(v) => setP({ x: v })} />
        </label>
        <label className="stack-label">
          <span>Y</span>
          <NumberField value={p.y} onCommit={(v) => setP({ y: v })} />
        </label>
        <label className="stack-label">
          <span>Rotation</span>
          <NumberField value={radToDeg(p.rotation)} unit="°" step={1} onCommit={(v) => setP({ rotation: degToRad(v) })} />
        </label>
      </div>
      <Row label="Elevation" title="Height of the bottom above the floor">
        <NumberField value={p.elevation} min={0} max={4000} scrubLabel="↕" onCommit={(v) => setP({ elevation: v })} onPreview={(v) => setP({ elevation: v }, true)} onScrubEnd={end} />
      </Row>
      <div className="row3">
        <button className="btn small" onClick={() => rotateSelection(Math.PI / 2)}>
          <RotateCw size={13} /> 90°
        </button>
        <button className="btn small" onClick={mirrorSelection} disabled={item.kind !== 'cabinet'}>
          <FlipHorizontal2 size={13} /> Mirror
        </button>
        <button className="btn small" onClick={duplicateSelection}>
          <Copy size={13} /> Copy
        </button>
      </div>
    </Section>
  );
}

const KIND_LABEL: Record<FrontKind, string> = { doors: 'Doors', drawer: 'Drawer', open: 'Open', appliance: 'Appliance' };

function FrontsEditor({ cab, build }: { cab: CabinetItem; build: ItemBuild }) {
  const fronts = cab.params.fronts;
  const set = (next: FrontSection[]) => commitItem(cab.id, (i) => (i.kind === 'cabinet' ? { ...i, params: { ...i.params, fronts: next } } : i));
  const patch = (idx: number, p: Partial<FrontSection>) => set(fronts.map((f, i) => (i === idx ? { ...f, ...p } : f)));
  const actual = (idx: number): number | null => {
    const part = build.parts.find((p) => p.key === `door-${idx}-0` || p.key === `drawer-${idx}`);
    if (part) return part.box.sz;
    const app = build.appliances.find((a) => a.key === `appliance-${idx}`);
    return app ? app.box.sz : null;
  };
  const move = (idx: number, d: number) => {
    const j = idx + d;
    if (j < 0 || j >= fronts.length) return;
    const next = [...fronts];
    [next[idx], next[j]] = [next[j], next[idx]];
    set(next);
  };
  return (
    <Section title="Fronts & interior" extra={`${fronts.length} · top → bottom`}>
      {fronts.map((f, idx) => {
        const h = actual(idx);
        return (
          <div className="front-row" key={f.id}>
            <select className="select" value={f.kind} onChange={(e) => patch(idx, { kind: e.target.value as FrontKind, ...(e.target.value === 'appliance' ? { appliance: 'Oven' } : {}) })}>
              {(Object.keys(KIND_LABEL) as FrontKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            {f.height == null ? (
              <button className="btn small" title="Height shares the remaining space — click to fix it" onClick={() => patch(idx, { height: Math.round(h ?? 200) })}>
                Auto {h != null ? `· ${Math.round(h * 10) / 10}` : ''}
              </button>
            ) : (
              <NumberField value={f.height} min={20} max={3000} onCommit={(v) => patch(idx, { height: v })} title="Visible front height" />
            )}
            <button className="btn small ghost" title="Remove section" onClick={() => set(fronts.filter((_, i) => i !== idx))} disabled={fronts.length <= 1}>
              <X size={13} />
            </button>
            <div className="sub">
              {f.height != null && (
                <button className="btn small" onClick={() => patch(idx, { height: null })}>
                  Make auto
                </button>
              )}
              {(f.kind === 'doors' || f.kind === 'open') && f.interior !== 'hanging' && (
                <label className="stack-label">
                  <NumberField value={f.shelves ?? 0} min={0} max={12} step={1} unit="shelves" decimals={0} onCommit={(v) => patch(idx, { shelves: Math.round(v) })} />
                </label>
              )}
              {f.kind === 'doors' && (
                <select className="select" value={String(f.doorCount ?? 'auto')} onChange={(e) => patch(idx, { doorCount: e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as 1 | 2) })}>
                  <option value="auto">Doors: auto</option>
                  <option value="1">1 door</option>
                  <option value="2">2 doors</option>
                </select>
              )}
              {f.kind === 'doors' && (
                <select className="select" value={f.interior ?? 'shelves'} onChange={(e) => patch(idx, { interior: e.target.value as FrontSection['interior'] })}>
                  <option value="shelves">Shelves</option>
                  <option value="hanging">Hanging rail</option>
                </select>
              )}
              {f.kind === 'appliance' && (
                <select className="select" value={f.appliance ?? 'Oven'} onChange={(e) => patch(idx, { appliance: e.target.value })}>
                  {['Oven', 'Microwave', 'Coffee machine', 'Warming drawer', 'Appliance'].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              )}
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn small ghost" onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">
                  <ArrowUp size={13} />
                </button>
                <button className="btn small ghost" onClick={() => move(idx, 1)} disabled={idx === fronts.length - 1} title="Move down">
                  <ArrowDown size={13} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <div className="row3">
        <button className="btn small" onClick={() => set([{ id: newId('fs'), kind: 'drawer', height: 180 }, ...fronts])}>
          <Plus size={13} /> Drawer
        </button>
        <button className="btn small" onClick={() => set([...fronts, { id: newId('fs'), kind: 'doors', height: null, doorCount: 'auto', shelves: 1 }])}>
          <Plus size={13} /> Doors
        </button>
        <button
          className="btn small"
          onClick={() => {
            const n = Math.max(1, fronts.filter((f) => f.kind === 'drawer').length + 1);
            set(Array.from({ length: n }, () => ({ id: newId('fs'), kind: 'drawer' as const, height: null })));
          }}
          title="Replace with equal drawers"
        >
          {fronts.filter((f) => f.kind === 'drawer').length + 1}× drawers
        </button>
      </div>
      <div className="row2">
        <label className="stack-label">
          <span>Handles</span>
          <select className="select" value={cab.params.handle} onChange={(e) => cabParam(cab.id, 'handle', false)(e.target.value as HandleStyle)}>
            <option value="bar-128">Bar 128 mm</option>
            <option value="bar-160">Bar 160 mm</option>
            <option value="bar-192">Bar 192 mm</option>
            <option value="bar-320">Bar 320 mm</option>
            <option value="knob">Knob</option>
            <option value="none">Handleless</option>
          </select>
        </label>
        <label className="stack-label">
          <span>Single-door hinge</span>
          <Seg value={cab.params.hingeSide} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={(v) => cabParam(cab.id, 'hingeSide', false)(v)} />
        </label>
      </div>
      {cab.params.blind && (
        <div className="row2">
          <label className="stack-label">
            <span>Blind side</span>
            <Seg value={cab.params.blind.side} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={(side) => cabParam(cab.id, 'blind', false)({ ...cab.params.blind!, side })} />
          </label>
          <label className="stack-label">
            <span>Blind width</span>
            <NumberField value={cab.params.blind.width} min={100} max={cab.params.width - 150} onCommit={(width) => cabParam(cab.id, 'blind', false)({ ...cab.params.blind!, width })} />
          </label>
        </div>
      )}
    </Section>
  );
}

function EndsEditor({ cab }: { cab: CabinetItem }) {
  const d = useDerived();
  const st = d.ends.get(cab.id);
  const opts: { value: EndMode; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'finished', label: 'Finished' },
    { value: 'unfinished', label: 'Plain' },
  ];
  const set = (side: 'left' | 'right', v: EndMode) => cabParam(cab.id, 'ends', false)({ ...cab.params.ends, [side]: v });
  const desc = (fin?: boolean) => (fin ? 'finished (matches fronts)' : 'carcass');
  return (
    <Section title="Ends" extra={st ? `L ${st.left ? 'finished' : 'plain'} · R ${st.right ? 'finished' : 'plain'}` : ''}>
      <Row label="Left end" title={`Currently ${desc(st?.left)}`}>
        <Seg value={cab.params.ends.left} options={opts} onChange={(v) => set('left', v)} />
      </Row>
      <Row label="Right end" title={`Currently ${desc(st?.right)}`}>
        <Seg value={cab.params.ends.right} options={opts} onChange={(v) => set('right', v)} />
      </Row>
      <div className="hint">Auto: exposed ends are built in the front material; ends against a wall or cabinet stay carcass.</div>
    </Section>
  );
}

function ConstructionEditor({ cab, doc }: { cab: CabinetItem; doc: ProjectDocument }) {
  const stdId = cab.standardId ?? doc.defaultStandardId;
  const std = doc.standards.find((s) => s.id === stdId) ?? doc.standards[0];
  const rules: ConstructionRules = { ...std.rules, ...cab.overrides };
  const setOverrides = (patch: Partial<ConstructionRules>) =>
    commitItem(cab.id, (i) => (i.kind === 'cabinet' ? { ...i, overrides: { ...i.overrides, ...patch } } : i));
  const setOverride = <K extends keyof ConstructionRules>(k: K, v: ConstructionRules[K]) => setOverrides({ [k]: v } as Partial<ConstructionRules>);
  const overridden = Object.keys(cab.overrides ?? {}).length;
  return (
    <Section title="Construction" extra={overridden ? `${overridden} override${overridden === 1 ? '' : 's'}` : 'standard'} defaultOpen={false}>
      <Row label="Standard">
        <select className="select" value={stdId} onChange={(e) => commitItem(cab.id, (i) => (i.kind === 'cabinet' ? { ...i, standardId: e.target.value } : i))}>
          {doc.standards.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Row>
      <div className="row2">
        <label className="stack-label">
          <span>Carcass thickness</span>
          <NumberField value={rules.carcassThickness} min={9} max={32} onCommit={(v) => setOverride('carcassThickness', v)} />
        </label>
        <label className="stack-label">
          <span>Front thickness</span>
          <NumberField value={rules.frontThickness} min={6} max={40} onCommit={(v) => setOverride('frontThickness', v)} />
        </label>
        <label className="stack-label">
          <span>Back</span>
          <select className="select" value={rules.backMethod} onChange={(e) => setOverride('backMethod', e.target.value as ConstructionRules['backMethod'])}>
            <option value="inset">Inset between sides</option>
            <option value="groove">In groove</option>
            <option value="applied">Applied to rear</option>
          </select>
        </label>
        <label className="stack-label">
          <span>Back thickness</span>
          <NumberField value={rules.backThickness} min={3} max={25} onCommit={(v) => setOverride('backThickness', v)} />
        </label>
        <label className="stack-label">
          <span>Joinery</span>
          <select className="select" value={rules.joinery} onChange={(e) => setOverride('joinery', e.target.value as ConstructionRules['joinery'])}>
            <option value="confirmat">Confirmat</option>
            <option value="dowel">Dowel</option>
            <option value="cam">Cam &amp; bolt</option>
            <option value="rafix">Rafix</option>
            <option value="screw">Screw</option>
            <option value="butt-glue">Butt / glue</option>
          </select>
        </label>
        <label className="stack-label">
          <span>Housing (dado)</span>
          <NumberField value={rules.housingDepth} min={0} max={10} onCommit={(v) => setOverride('housingDepth', v)} />
        </label>
        <label className="stack-label">
          <span>Bottom</span>
          <select className="select" value={rules.bottomJoint} onChange={(e) => setOverride('bottomJoint', e.target.value as ConstructionRules['bottomJoint'])}>
            <option value="between-sides">Between sides</option>
            <option value="full-width">Under sides</option>
          </select>
        </label>
        <label className="stack-label">
          <span>Fronts</span>
          <select className="select" value={rules.frontStyle} onChange={(e) => setOverride('frontStyle', e.target.value as ConstructionRules['frontStyle'])}>
            <option value="overlay">Full overlay</option>
            <option value="inset">Inset</option>
          </select>
        </label>
        <label className="stack-label">
          <span>Front gap</span>
          <NumberField value={rules.frontGap} min={0} max={10} step={0.5} onCommit={(v) => setOverride('frontGap', v)} />
        </label>
        <label className="stack-label">
          <span>Edge banding</span>
          <NumberField value={rules.frontBanding} min={0} max={3} step={0.1} onCommit={(v) => setOverrides({ frontBanding: v, carcassBanding: v })} />
        </label>
        {hasBenchtop(cab.category) && (
          <label className="stack-label">
            <span>Top</span>
            <select className="select" value={rules.baseTopType} onChange={(e) => setOverride('baseTopType', e.target.value as ConstructionRules['baseTopType'])}>
              <option value="rails">Rails</option>
              <option value="full">Full top</option>
            </select>
          </label>
        )}
      </div>
      {overridden > 0 && (
        <button className="btn small" onClick={() => commitItem(cab.id, (i) => (i.kind === 'cabinet' ? { ...i, overrides: {} } : i))}>
          Reset to standard
        </button>
      )}
    </Section>
  );
}

const CAB_SLOTS: MaterialSlot[] = ['front', 'carcass', 'back', 'drawerBox', 'kick'];

function MaterialEditor({ cab, doc }: { cab: CabinetItem; doc: ProjectDocument }) {
  return (
    <Section title="Materials" defaultOpen={false}>
      {CAB_SLOTS.map((slot) => {
        const def = doc.materials.find((m) => m.id === doc.materialDefaults[slot]);
        return (
          <Row key={slot} label={MATERIAL_SLOT_LABELS[slot]}>
            <select
              className="select"
              value={cab.materials?.[slot] ?? ''}
              onChange={(e) =>
                commitItem(cab.id, (i) => {
                  if (i.kind !== 'cabinet') return i;
                  const m = { ...i.materials };
                  if (e.target.value) m[slot] = e.target.value;
                  else delete m[slot];
                  return { ...i, materials: m };
                })
              }
            >
              <option value="">Project: {def?.name ?? '—'}</option>
              {materialsForSlot(doc.materials, slot).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Row>
        );
      })}
    </Section>
  );
}

function BuildSummary({ build }: { build: ItemBuild }) {
  const counts = useMemo(() => {
    const hw = new Map<string, number>();
    for (const h of build.hardware) hw.set(h.type, (hw.get(h.type) ?? 0) + h.qty);
    return hw;
  }, [build]);
  return (
    <Section title="Parts & hardware" extra={`${build.parts.length} parts`} defaultOpen={false}>
      <table className="parts-table">
        <tbody>
          {build.parts.map((p) => (
            <tr key={p.key} title={p.comment}>
              <td>{p.name}</td>
              <td className="num">
                {Math.round(p.cutLength * 10) / 10} × {Math.round(p.cutWidth * 10) / 10} × {p.thickness}
              </td>
              <td className="num">{bandingCode(p.banding)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint">Cut sizes (banding deducted) · L1,L2,W1,W2 banding.</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {[...counts.entries()].map(([t, q]) => (
          <span key={t} className="chip">
            {q} {t.replace('-', ' ')}
            {q === 1 ? '' : 's'}
          </span>
        ))}
      </div>
    </Section>
  );
}

function Warnings({ build }: { build: ItemBuild }) {
  const doc = useStore((s) => s.doc);
  const clashes = useMemo(() => clashesWith(activeRoom(doc), build.itemId, (i) => deriver.extents(doc, i)), [doc, build.itemId]);
  if (!build.warnings.length && !clashes.length) return null;
  return (
    <>
      {clashes.length > 0 && (
        <div className="warn error">
          <AlertTriangle size={14} style={{ flex: 'none', marginTop: 1 }} /> Clashes with {clashes.map((c) => c.label).join(', ')} — move or resize before manufacturing.
        </div>
      )}
      {build.warnings.map((w) => (
        <div key={w} className={`warn${build.invalid ? ' error' : ''}`}>
          <AlertTriangle size={14} style={{ flex: 'none', marginTop: 1 }} /> {w}
        </div>
      ))}
    </>
  );
}

function CabinetProps({ cab, build }: { cab: CabinetItem; build: ItemBuild }) {
  const doc = useStore((s) => s.doc);
  const t = templateById(cab.templateId);
  return (
    <>
      <div className="section" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="chip blue">{cab.label}</span>
          <span className="muted">{t?.group ?? cab.category}</span>
        </div>
        <TextField value={cab.name} onCommit={(name) => commitItem(cab.id, (i) => ({ ...i, name }) as Item)} />
      </div>
      <Warnings build={build} />
      <Section title="Size">
        <div className="row2">
          <DimField id={cab.id} k="width" label="Width" value={cab.params.width} min={60} max={3600} />
          <DimField id={cab.id} k="height" label="Height" value={cab.params.height} min={100} max={3000} />
          <DimField id={cab.id} k="depth" label="Depth (carcass)" value={cab.params.depth} min={100} max={1200} />
          <DimField id={cab.id} k="kickHeight" label="Kick height" value={cab.params.kickHeight} min={0} max={300} />
        </div>
      </Section>
      <FrontsEditor cab={cab} build={build} />
      <PlacementFields item={cab} />
      <EndsEditor cab={cab} />
      <ConstructionEditor cab={cab} doc={doc} />
      <MaterialEditor cab={cab} doc={doc} />
      <BuildSummary build={build} />
      <button className="btn danger block" onClick={deleteSelection}>
        <Trash2 size={14} /> Delete {cab.label}
      </button>
    </>
  );
}

function PanelProps({ panel, build }: { panel: PanelItem; build: ItemBuild }) {
  const doc = useStore((s) => s.doc);
  const field = (k: 'width' | 'depth' | 'height') => ({
    onCommit: (v: number) => commitItem(panel.id, (i) => ({ ...i, [k]: v }) as Item),
    onPreview: (v: number) => previewItem(panel.id, (i) => ({ ...i, [k]: v }) as Item),
    onScrubEnd: end,
  });
  return (
    <>
      <div className="section" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="chip blue">{panel.label}</span>
          <span className="muted">{panel.panelType.replace('-', ' ')}</span>
          {panel.auto && <span className="chip">auto</span>}
        </div>
        <TextField value={panel.name} onCommit={(name) => commitItem(panel.id, (i) => ({ ...i, name }) as Item)} />
      </div>
      <Warnings build={build} />
      <Section title="Size">
        <div className="row3">
          <label className="stack-label">
            <span>Width</span>
            <NumberField value={panel.width} min={1} max={6000} scrubLabel="↔" {...field('width')} />
          </label>
          <label className="stack-label">
            <span>Depth</span>
            <NumberField value={panel.depth} min={1} max={3000} scrubLabel="↔" {...field('depth')} />
          </label>
          <label className="stack-label">
            <span>Height</span>
            <NumberField value={panel.height} min={1} max={4000} scrubLabel="↕" {...field('height')} />
          </label>
        </div>
        <Row label="Material">
          <select
            className="select"
            value={panel.materialId ?? ''}
            onChange={(e) => commitItem(panel.id, (i) => ({ ...i, materialId: e.target.value || null }) as Item)}
          >
            <option value="">Project: {doc.materials.find((m) => m.id === doc.materialDefaults[panel.materialSlot])?.name}</option>
            {materialsForSlot(doc.materials, panel.materialSlot).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <PlacementFields item={panel} />
      <BuildSummary build={build} />
      <button className="btn danger block" onClick={deleteSelection}>
        <Trash2 size={14} /> Delete {panel.label}
      </button>
    </>
  );
}

function WallProps({ wall }: { wall: Wall }) {
  const doc = useStore((s) => s.doc);
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const setLen = (l: number) => {
    const k = l / (len || 1);
    S().commit((d) => updateWall(d, wall.id, { end: { x: wall.start.x + (wall.end.x - wall.start.x) * k, y: wall.start.y + (wall.end.y - wall.start.y) * k } }));
  };
  return (
    <>
      <div className="section" style={{ padding: 12 }}>
        <span className="chip blue">Wall {wallName(doc, wall.id)}</span>
      </div>
      <Section title="Wall">
        <Row label="Length">
          <NumberField value={len} min={100} max={50000} onCommit={setLen} />
        </Row>
        <Row label="Thickness">
          <NumberField value={wall.thickness} min={20} max={1000} onCommit={(v) => S().commit((d) => updateWall(d, wall.id, { thickness: v }))} />
        </Row>
        <Row label="Height">
          <NumberField value={wall.height} min={500} max={8000} onCommit={(v) => S().commit((d) => updateWall(d, wall.id, { height: v }))} />
        </Row>
        <div className="row2">
          <label className="stack-label">
            <span>Start X</span>
            <NumberField value={wall.start.x} onCommit={(v) => S().commit((d) => updateWall(d, wall.id, { start: { ...wall.start, x: v } }))} />
          </label>
          <label className="stack-label">
            <span>Start Y</span>
            <NumberField value={wall.start.y} onCommit={(v) => S().commit((d) => updateWall(d, wall.id, { start: { ...wall.start, y: v } }))} />
          </label>
          <label className="stack-label">
            <span>End X</span>
            <NumberField value={wall.end.x} onCommit={(v) => S().commit((d) => updateWall(d, wall.id, { end: { ...wall.end, x: v } }))} />
          </label>
          <label className="stack-label">
            <span>End Y</span>
            <NumberField value={wall.end.y} onCommit={(v) => S().commit((d) => updateWall(d, wall.id, { end: { ...wall.end, y: v } }))} />
          </label>
        </div>
        <button className="btn block" onClick={() => useStore.setState({ elevationWallId: wall.id, view: 'front' })}>
          Front elevation of this wall
        </button>
      </Section>
      <button className="btn danger block" onClick={deleteSelection}>
        <Trash2 size={14} /> Delete wall
      </button>
    </>
  );
}

function OpeningProps({ o }: { o: Opening }) {
  const set = (p: Partial<Opening>) => S().commit((d) => updateOpening(d, o.id, p));
  return (
    <>
      <div className="section" style={{ padding: 12 }}>
        <span className="chip blue">{o.kind === 'window' ? 'Window' : 'Door'}</span>
      </div>
      <Section title="Opening">
        <Row label="Type">
          <Seg value={o.kind} options={[{ value: 'window', label: 'Window' }, { value: 'door', label: 'Door' }]} onChange={(kind) => set({ kind, ...(kind === 'door' ? { sill: 0 } : {}) })} />
        </Row>
        <Row label="Width">
          <NumberField value={o.width} min={200} max={6000} onCommit={(v) => set({ width: v })} />
        </Row>
        <Row label="Height">
          <NumberField value={o.height} min={200} max={4000} onCommit={(v) => set({ height: v })} />
        </Row>
        <Row label="Sill height">
          <NumberField value={o.sill} min={0} max={3000} onCommit={(v) => set({ sill: v })} />
        </Row>
        <Row label="From wall start">
          <NumberField value={o.offset} min={0} max={50000} onCommit={(v) => set({ offset: v })} />
        </Row>
      </Section>
      <button className="btn danger block" onClick={deleteSelection}>
        <Trash2 size={14} /> Delete opening
      </button>
    </>
  );
}

function ProjectProps() {
  const doc = useStore((s) => s.doc);
  const room = activeRoom(doc);
  const c = doc.client;
  const setClient = (k: keyof typeof c) => (v: string) => S().commit((d) => ({ ...d, client: { ...d.client, [k]: v } }));
  const items = room.items;
  return (
    <>
      <Section title="Project">
        <Row label="Name">
          <TextField value={doc.name} onCommit={(name) => S().commit((d) => ({ ...d, name }))} />
        </Row>
        <Row label="Client">
          <TextField value={c.name} placeholder="Client name" onCommit={setClient('name')} />
        </Row>
        <Row label="Address">
          <TextField value={c.address} placeholder="Site address" onCommit={setClient('address')} />
        </Row>
        <Row label="Phone">
          <TextField value={c.phone} onCommit={setClient('phone')} />
        </Row>
        <Row label="Email">
          <TextField value={c.email} onCommit={setClient('email')} />
        </Row>
        <textarea
          className="textarea"
          placeholder="Job notes"
          defaultValue={doc.notes}
          key={doc.id}
          onBlur={(e) => e.target.value !== doc.notes && S().commit((d) => ({ ...d, notes: e.target.value }))}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </Section>
      <Section title="Room" extra={room.name}>
        <Row label="Ceiling height">
          <NumberField
            value={room.ceilingHeight}
            min={1800}
            max={8000}
            onCommit={(v) => S().commit((d) => updateRoom(d, (r) => ({ ...r, ceilingHeight: v, walls: r.walls.map((w) => ({ ...w, height: v })) })))}
          />
        </Row>
        <Row label="Default standard">
          <select className="select" value={doc.defaultStandardId} onChange={(e) => S().commit((d) => ({ ...d, defaultStandardId: e.target.value }))}>
            {doc.standards.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Row>
        <div className="hint">{doc.standards.find((s) => s.id === doc.defaultStandardId)?.description}</div>
      </Section>
      <Section title="In this room">
        <div className="kv">
          <div>Cabinets</div>
          <div>{items.filter((i) => i.kind === 'cabinet').length}</div>
          <div>Panels & tops</div>
          <div>{items.filter((i) => i.kind === 'panel').length}</div>
          <div>Walls / openings</div>
          <div>
            {room.walls.length} / {room.openings.length}
          </div>
        </div>
        <div className="hint">Select anything in the viewport to edit it here. Drag cabinets in from the Library.</div>
      </Section>
    </>
  );
}

export function RightPanel() {
  const sel = useStore((s) => s.selection);
  const doc = useStore((s) => s.doc);
  const d = useDerived();
  const room = activeRoom(doc);
  let body: React.ReactNode = <ProjectProps />;
  let title = 'Project';
  if (sel?.kind === 'item') {
    const item = room.items.find((i) => i.id === sel.id);
    const build = item && d.builds.get(item.id);
    if (item && build) {
      title = item.kind === 'cabinet' ? 'Cabinet' : 'Panel';
      body = item.kind === 'cabinet' ? <CabinetProps cab={item} build={build} /> : <PanelProps panel={item} build={build} />;
    }
  } else if (sel?.kind === 'wall') {
    const w = room.walls.find((x) => x.id === sel.id);
    if (w) {
      title = 'Wall';
      body = <WallProps wall={w} />;
    }
  } else if (sel?.kind === 'opening') {
    const o = room.openings.find((x) => x.id === sel.id);
    if (o) {
      title = 'Opening';
      body = <OpeningProps o={o} />;
    }
  }
  return (
    <>
      <div className="panel-title">
        {title}
        {sel && (
          <button className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={() => S().select(null)} title="Deselect (Esc)">
            <X size={13} />
          </button>
        )}
      </div>
      <div className="panel-body">{body}</div>
    </>
  );
}
