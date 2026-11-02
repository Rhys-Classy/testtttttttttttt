// Platform services. In the desktop app these go through the Electron preload bridge;
// in a plain browser (dev:web, automated tests) they fall back to downloads, file
// pickers and localStorage so every feature still works.

import type { AutosaveRecord, CabinetStudioBridge, ExportRequest, GpuReport, MenuCommand, OpenedFile, PdfRequest, SaveRequest, SavedFile } from '@shared/ipc';

declare global {
  interface Window {
    cabinetStudio?: CabinetStudioBridge;
  }
}

const AUTOSAVE_KEY = 'cabinet-studio:recovery';

interface HostDownloads {
  save(req: { filename: string; data: string | Blob }): Promise<{ status: string }>;
}
type HostClaude = { use?: (name: string) => Promise<unknown> };

let hostDownloads: Promise<HostDownloads | null> | null = null;
/** claude.ai pages can't start downloads themselves; the host's downloads capability can. */
function getHostDownloads(): Promise<HostDownloads | null> {
  const c = (window as unknown as { claude?: HostClaude }).claude;
  if (!c?.use) return Promise.resolve(null);
  hostDownloads ??= c.use('downloads').then((d) => (d as HostDownloads | null) ?? null).catch(() => null);
  return hostDownloads;
}

/** Save a generated file: the host's save prompt when embedded, a normal download otherwise. */
async function saveFile(name: string, blob: Blob): Promise<boolean> {
  const host = await getHostDownloads();
  if (host) {
    try {
      await host.save({ filename: name, data: blob });
      return true;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return false;
      throw new Error(code === 'rejected_extension' ? `This viewer can't save ${name.split('.').pop()} files.` : 'Saving files is not available here.');
    }
  }
  download(name, blob);
  return true;
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const browserBridge: CabinetStudioBridge = {
  platform: 'web',
  appVersion: '0.1.0',
  async openProject(): Promise<OpenedFile | null> {
    const f = await pickFile('.cabproj,.json,application/json');
    return f ? { path: null, name: f.name, content: await f.text() } : null;
  },
  async openProjectAt(): Promise<OpenedFile> {
    throw new Error('Opening by path is only available in the desktop app.');
  },
  async saveProject(req: SaveRequest): Promise<SavedFile | null> {
    // Embedded hosts only accept common extensions, so the project rides as .cabproj.json there.
    const name = (await getHostDownloads()) ? `${req.suggestedName}.cabproj.json` : `${req.suggestedName}.cabproj`;
    const ok = await saveFile(name, new Blob([req.content], { type: 'application/json' }));
    return ok ? { path: null, name } : null;
  },
  async exportFile(req: ExportRequest): Promise<string | null> {
    const blob = req.encoding === 'base64' ? new Blob([b64ToBytes(req.data) as BlobPart]) : new Blob([req.data], { type: 'text/plain' });
    return (await saveFile(req.suggestedName, blob)) ? req.suggestedName : null;
  },
  async printPdf(req: PdfRequest): Promise<string | null> {
    // Embedded host: no print dialog, so hand over the A3 sheets as an HTML file to print to PDF.
    if (await getHostDownloads()) {
      const name = req.suggestedName.replace(/\.pdf$/i, '') + ' (open and print to PDF).html';
      return (await saveFile(name, new Blob([req.html], { type: 'text/html' }))) ? name : null;
    }
    // Plain browser: open the sheets and use the print dialog (Save as PDF).
    const w = window.open('', '_blank');
    if (!w) throw new Error('Allow pop-ups to print drawings.');
    w.document.open();
    w.document.write(req.html);
    w.document.close();
    setTimeout(() => w.print(), 300);
    return req.suggestedName;
  },
  async writeAutosave(rec: AutosaveRecord): Promise<void> {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(rec));
    } catch {
      // storage full or unavailable — autosave is best effort in the browser
    }
  },
  async readAutosave(): Promise<AutosaveRecord | null> {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      return raw ? (JSON.parse(raw) as AutosaveRecord) : null;
    } catch {
      return null;
    }
  },
  async clearAutosave(): Promise<void> {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // ignore
    }
  },
  async gpuReport(): Promise<GpuReport> {
    return { featureStatus: {}, info: null, switches: [], forceGpu: false };
  },
  async setForceGpu(): Promise<void> {},
  setTitle(title: string) {
    document.title = title;
  },
  setDirty() {},
  async takePendingOpenPath() {
    return null;
  },
  onMenu(_cb: (cmd: MenuCommand) => void) {
    return () => {};
  },
  onOpenPath() {
    return () => {};
  },
};

export const platform: CabinetStudioBridge = window.cabinetStudio ?? browserBridge;
export const isDesktop = !!window.cabinetStudio;
