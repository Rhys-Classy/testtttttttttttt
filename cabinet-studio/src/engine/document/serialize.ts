// Project file format (.cabproj): versioned JSON with a format marker. Older schema
// versions are migrated forward on load; unknown future versions are refused instead of
// being silently mangled.

import { createProject } from './project';
import type { ProjectDocument } from '../model/types';

export const FILE_FORMAT = 'cabinet-studio-project';
export const SCHEMA_VERSION = 1;
export const FILE_EXTENSION = 'cabproj';

export interface ProjectFile {
  format: typeof FILE_FORMAT;
  schemaVersion: number;
  savedAt: string;
  app: { name: string; version: string };
  project: ProjectDocument;
}

export class ProjectFileError extends Error {}

export function serializeProject(doc: ProjectDocument, appVersion = '0.1.0'): string {
  const file: ProjectFile = {
    format: FILE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    app: { name: 'Cabinet Studio', version: appVersion },
    project: doc,
  };
  return JSON.stringify(file);
}

type Migration = (project: Record<string, unknown>) => Record<string, unknown>;
/** migrations[n] upgrades schema n → n + 1. */
const migrations: Record<number, Migration> = {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseProject(text: string): { doc: ProjectDocument; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('This file is not a Cabinet Studio project (it is not valid JSON).');
  }
  if (!isObj(raw) || raw.format !== FILE_FORMAT) throw new ProjectFileError('This file is not a Cabinet Studio project.');
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new ProjectFileError(`This project was saved by a newer version of Cabinet Studio (format ${version}). Update the app to open it.`);
  }
  if (!isObj(raw.project)) throw new ProjectFileError('The project file is damaged: no project data found.');
  let project = raw.project;
  const warnings: string[] = [];
  while (version < SCHEMA_VERSION) {
    const m = migrations[version];
    if (!m) throw new ProjectFileError(`Projects in format ${version} can't be upgraded.`);
    project = m(project);
    version++;
  }
  // Fill anything missing from defaults so older/partial files still open.
  const defaults = createProject();
  const doc = { ...defaults, ...project } as ProjectDocument;
  if (!Array.isArray(doc.rooms) || doc.rooms.length === 0) throw new ProjectFileError('The project file is damaged: it has no rooms.');
  for (const r of doc.rooms) {
    if (!Array.isArray(r.walls) || !Array.isArray(r.items)) throw new ProjectFileError(`The project file is damaged: room "${r.name ?? '?'}" is incomplete.`);
    r.openings ??= [];
  }
  if (!doc.rooms.some((r) => r.id === doc.activeRoomId)) doc.activeRoomId = doc.rooms[0].id;
  if (!Array.isArray(doc.standards) || doc.standards.length === 0) {
    doc.standards = defaults.standards;
    warnings.push('Construction standards were missing and have been reset to defaults.');
  }
  // Materials added to the library since the file was saved become available too.
  const have = new Set(doc.materials.map((m) => m.id));
  const added = defaults.materials.filter((m) => !have.has(m.id));
  if (added.length) doc.materials = [...doc.materials, ...added];
  doc.materialDefaults = { ...defaults.materialDefaults, ...doc.materialDefaults };
  doc.render = { ...defaults.render, ...doc.render };
  doc.counters = { ...defaults.counters, ...doc.counters };
  return { doc, warnings };
}
