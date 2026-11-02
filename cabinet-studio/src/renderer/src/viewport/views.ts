import { activeRoom, type DerivedRoom, type ProjectDocument, type WallFace } from '@engine/index';
import type { State } from '../state/store';

export const VIEW_LABELS: Record<State['view'], string> = {
  plan: 'Floor plan',
  front: 'Front elevation',
  side: 'Side elevation',
  '3d': '3D perspective',
  walk: 'Walkthrough',
};

/** Letter names for walls in drawing order: A, B, C… */
export function wallName(doc: ProjectDocument, wallId: string): string {
  const i = activeRoom(doc).walls.findIndex((w) => w.id === wallId);
  if (i < 0) return '?';
  return i < 26 ? String.fromCharCode(65 + i) : `W${i + 1}`;
}

function preferredFace(d: DerivedRoom, wallId: string): WallFace | undefined {
  const faces = d.faces.filter((f) => f.wallId === wallId);
  return faces.find((f) => d.interiorFaceIds.has(f.id)) ?? faces.find((f) => f.side === 'left') ?? faces[0];
}

/** The wall face shown in front/side elevation. */
export function elevationFace(s: Pick<State, 'elevationWallId' | 'selection'>, d: DerivedRoom): WallFace | null {
  if (s.elevationWallId) {
    const f = preferredFace(d, s.elevationWallId);
    if (f) return f;
  }
  const sel = s.selection;
  if (sel?.kind === 'item') {
    const it = d.room.items.find((i) => i.id === sel.id);
    if (it?.wallId) {
      const f = preferredFace(d, it.wallId);
      if (f) return f;
    }
  }
  if (sel?.kind === 'wall') {
    const f = preferredFace(d, sel.id);
    if (f) return f;
  }
  const counts = new Map<string, number>();
  for (const it of d.room.items) if (it.wallId) counts.set(it.wallId, (counts.get(it.wallId) ?? 0) + 1);
  const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (busiest) {
    const f = preferredFace(d, busiest[0]);
    if (f) return f;
  }
  const interior = d.faces.filter((f) => d.interiorFaceIds.has(f.id));
  const pool = interior.length ? interior : d.faces;
  return [...pool].sort((a, b) => b.length - a.length)[0] ?? null;
}
