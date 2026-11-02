import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type CabinetStudioBridge, type MenuCommand } from '../shared/ipc';

const bridge: CabinetStudioBridge = {
  platform: process.platform,
  appVersion: process.argv.find((a) => a.startsWith('--app-version='))?.split('=')[1] ?? '0.1.0',
  openProject: () => ipcRenderer.invoke(IPC.open),
  openProjectAt: (path) => ipcRenderer.invoke(IPC.openAt, path),
  saveProject: (req) => ipcRenderer.invoke(IPC.save, req),
  exportFile: (req) => ipcRenderer.invoke(IPC.export, req),
  writeAutosave: (rec) => ipcRenderer.invoke(IPC.autosaveWrite, rec),
  readAutosave: () => ipcRenderer.invoke(IPC.autosaveRead),
  clearAutosave: () => ipcRenderer.invoke(IPC.autosaveClear),
  gpuReport: () => ipcRenderer.invoke(IPC.gpu),
  setForceGpu: (on) => ipcRenderer.invoke(IPC.forceGpu, on),
  setTitle: (title) => ipcRenderer.send(IPC.title, title),
  setDirty: (dirty) => ipcRenderer.send(IPC.dirty, dirty),
  takePendingOpenPath: () => ipcRenderer.invoke(IPC.pendingOpen),
  onMenu: (cb) => {
    const h = (_e: IpcRendererEvent, cmd: MenuCommand) => cb(cmd);
    ipcRenderer.on(IPC.menu, h);
    return () => ipcRenderer.removeListener(IPC.menu, h);
  },
  onOpenPath: (cb) => {
    const h = (_e: IpcRendererEvent, path: string) => cb(path);
    ipcRenderer.on(IPC.openPath, h);
    return () => ipcRenderer.removeListener(IPC.openPath, h);
  },
};

contextBridge.exposeInMainWorld('cabinetStudio', bridge);
