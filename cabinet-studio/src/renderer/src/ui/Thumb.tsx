// Library thumbnails drawn from the construction engine's real front layout, so the
// picture always matches what will be built.

import { useMemo } from 'react';
import {
  buildCabinet,
  DEFAULT_MATERIAL_ASSIGNMENT,
  DEFAULT_RULES,
  LIBRARY_MATERIALS,
  cabinetFromTemplate,
  type CabinetTemplate,
  type PanelTemplate,
} from '@engine/index';

const materials = new Map(LIBRARY_MATERIALS.map((m) => [m.id, m]));

export function CabinetThumb({ t }: { t: CabinetTemplate }) {
  const svg = useMemo(() => {
    const cab = cabinetFromTemplate(t, 'T');
    const b = buildCabinet(cab, { rules: DEFAULT_RULES, materialFor: (s) => DEFAULT_MATERIAL_ASSIGNMENT[s], materials, finishedEnds: { left: false, right: false } });
    const W = cab.params.width;
    const H = cab.params.height;
    const fronts = b.parts.filter((p) => p.role === 'door' || p.role === 'drawer-front' || p.role === 'blind-panel');
    const handles = b.hardware.filter((h) => h.visual?.kind === 'bar' || h.visual?.kind === 'knob');
    const app = b.appliances;
    return { W, H, k: cab.params.kickHeight, fronts, handles, app, open: cab.params.fronts.some((f) => f.kind === 'open'), shelves: b.parts.filter((p) => p.role === 'shelf') };
  }, [t]);
  const pad = 40;
  const vw = svg.W + pad * 2;
  const vh = svg.H + pad * 2;
  const y = (z: number) => pad + svg.H - z;
  return (
    <svg viewBox={`0 0 ${vw} ${vh}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <rect x={pad} y={pad} width={svg.W} height={svg.H - svg.k} fill="#2b323c" stroke="#55606e" strokeWidth={Math.max(4, svg.W / 120)} rx="6" />
      {svg.k > 0 && <rect x={pad + 20} y={y(svg.k)} width={svg.W - 40} height={svg.k} fill="#1b1f25" />}
      {svg.open && svg.shelves.map((s) => <rect key={s.key} x={pad + 16} y={y(s.box.z + s.box.sz)} width={svg.W - 32} height={s.box.sz} fill="#55606e" />)}
      {svg.app.map((a) => (
        <rect key={a.key} x={pad + a.box.x} y={y(a.box.z + a.box.sz)} width={a.box.sx} height={a.box.sz} fill="#0b0c0e" stroke="#3a4250" strokeWidth={6} />
      ))}
      {svg.fronts.map((f) => (
        <rect key={f.key} x={pad + f.box.x} y={y(f.box.z + f.box.sz)} width={f.box.sx} height={f.box.sz} fill="#dfe6ee" stroke="#9fb0c3" strokeWidth={4} rx="4" />
      ))}
      {svg.handles.map((h) => {
        const v = h.visual!;
        if (v.kind === 'knob') return <circle key={h.key} cx={pad + v.center.x} cy={y(v.center.z)} r={16} fill="#3d8bff" />;
        return v.axis === 'x' ? (
          <rect key={h.key} x={pad + v.center.x - v.length / 2} y={y(v.center.z) - 8} width={v.length} height={16} rx={8} fill="#3d8bff" />
        ) : (
          <rect key={h.key} x={pad + v.center.x - 8} y={y(v.center.z) - v.length / 2} width={16} height={v.length} rx={8} fill="#3d8bff" />
        );
      })}
    </svg>
  );
}

export function PanelThumb({ t }: { t: PanelTemplate }) {
  const front = t.panelType === 'end-panel' ? { w: t.depth, h: t.height } : t.panelType === 'benchtop' ? { w: t.width, h: t.depth } : { w: t.width, h: t.height };
  const pad = Math.max(front.w, front.h) * 0.08;
  const fill = t.panelType === 'benchtop' ? '#e9e6e0' : t.panelType === 'splashback' ? '#cfe3ea' : '#dfe6ee';
  return (
    <svg viewBox={`0 0 ${front.w + pad * 2} ${front.h + pad * 2}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <rect x={pad} y={pad} width={front.w} height={front.h} fill={fill} stroke="#9fb0c3" strokeWidth={Math.max(4, front.w / 80)} rx={6} />
      {t.panelType === 'filler' && <rect x={pad + front.w * 0.3} y={pad} width={front.w * 0.4} height={front.h} fill="#55606e" />}
    </svg>
  );
}

export function OpeningThumb({ kind }: { kind: 'window' | 'door' }) {
  return kind === 'window' ? (
    <svg viewBox="0 0 120 80" width="100%" height="100%">
      <rect x="18" y="10" width="84" height="60" fill="#9ecbe3" fillOpacity="0.35" stroke="#dfe6ee" strokeWidth="5" />
      <line x1="60" y1="10" x2="60" y2="70" stroke="#dfe6ee" strokeWidth="4" />
    </svg>
  ) : (
    <svg viewBox="0 0 120 80" width="100%" height="100%">
      <rect x="40" y="6" width="40" height="70" fill="#c9a479" stroke="#dfe6ee" strokeWidth="4" />
      <circle cx="73" cy="44" r="3" fill="#1a1b1d" />
    </svg>
  );
}
