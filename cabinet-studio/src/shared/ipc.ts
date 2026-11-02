// Contract between the Electron main process and the renderer. The renderer only ever
// sees this narrow bridge (contextIsolation + sandbox): no Node, no fs, no shell.

export interface OpenedFile {
  path: string | null;
  name: string;
  content: string;
}

export interface SaveRequest {
  content: string;
  path: string | null;
  suggestedName: string;
  saveAs: boolean;
}

export interface SavedFile {
  path: string | null;
  name: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface ExportRequest {
  /** UTF-8 text, or base64 when `encoding` is 'base64'. */
  data: string;
  encoding: 'utf8' | 'base64';
  suggestedName: string;
  filters: FileFilter[];
}

export interface PdfRequest {
  /** Self-contained HTML (inline SVG, no scripts). */
  html: string;
  suggestedName: string;
  /** Save to this path without a dialog (automation/tests). */
  path?: string;
}

export interface AutosaveRecord {
  content: string;
  savedAt: string;
  projectName: string;
  path: string | null;
}

export interface GpuReport {
  featureStatus: Record<string, string>;
  info: unknown;
  switches: string[];
  forceGpu: boolean;
}

export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'delete'
  | 'export-cutlist'
  | 'export-image'
  | 'cutlist'
  | 'drawings'
  | 'render'
  | 'view-plan'
  | 'view-front'
  | 'view-side'
  | 'view-3d'
  | 'view-walk'
  | 'gpu'
  | 'about';

export interface CabinetStudioBridge {
  platform: string;
  appVersion: string;
  openProject(): Promise<OpenedFile | null>;
  openProjectAt(path: string): Promise<OpenedFile>;
  saveProject(req: SaveRequest): Promise<SavedFile | null>;
  exportFile(req: ExportRequest): Promise<string | null>;
  /** Render HTML to a PDF file. Returns the saved path, or null if cancelled. */
  printPdf(req: PdfRequest): Promise<string | null>;
  writeAutosave(rec: AutosaveRecord): Promise<void>;
  readAutosave(): Promise<AutosaveRecord | null>;
  clearAutosave(): Promise<void>;
  gpuReport(): Promise<GpuReport>;
  setForceGpu(on: boolean): Promise<void>;
  setTitle(title: string): void;
  setDirty(dirty: boolean): void;
  takePendingOpenPath(): Promise<string | null>;
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  onOpenPath(cb: (path: string) => void): () => void;
}

export const IPC = {
  open: 'project:open',
  openAt: 'project:open-at',
  save: 'project:save',
  export: 'file:export',
  printPdf: 'file:print-pdf',
  autosaveWrite: 'autosave:write',
  autosaveRead: 'autosave:read',
  autosaveClear: 'autosave:clear',
  gpu: 'gpu:report',
  forceGpu: 'gpu:force',
  title: 'window:title',
  dirty: 'window:dirty',
  pendingOpen: 'app:pending-open',
  menu: 'menu:command',
  openPath: 'app:open-path',
} as const;
