import { DEFAULT_MATERIAL_ASSIGNMENT, LIBRARY_MATERIALS } from '../library/materials';
import { cloneStandard, STANDARD_PRESETS } from '../library/standards';
import { newId } from '../model/ids';
import type { ProjectDocument, RenderSettings } from '../model/types';
import { createRoom } from '../room/walls';

export const DEFAULT_RENDER: RenderSettings = {
  lighting: 'daylight',
  exposure: 1,
  sunAzimuth: 225,
  sunElevation: 48,
  sunIntensity: 2.4,
  underCabinetLights: false,
};

export interface NewProjectOptions {
  name?: string;
  roomWidth?: number;
  roomDepth?: number;
  ceilingHeight?: number;
  wallThickness?: number;
}

export function createProject(opts: NewProjectOptions = {}): ProjectDocument {
  const now = new Date().toISOString();
  const room = createRoom('Kitchen', opts.roomWidth ?? 4200, opts.roomDepth ?? 3200, opts.ceilingHeight ?? 2400, opts.wallThickness ?? 110);
  return {
    id: newId('prj'),
    name: opts.name ?? 'Untitled project',
    client: { name: '', address: '', phone: '', email: '' },
    notes: '',
    createdAt: now,
    updatedAt: now,
    rooms: [room],
    activeRoomId: room.id,
    standards: STANDARD_PRESETS.map(cloneStandard),
    defaultStandardId: STANDARD_PRESETS[0].id,
    materials: LIBRARY_MATERIALS.map((m) => ({ ...m, appearance: { ...m.appearance }, thicknesses: [...m.thicknesses] })),
    materialDefaults: { ...DEFAULT_MATERIAL_ASSIGNMENT },
    render: { ...DEFAULT_RENDER },
    cameras: [],
    counters: { cabinet: 0, panel: 0 },
  };
}
