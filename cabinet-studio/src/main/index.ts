import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { IPC, type AutosaveRecord, type ExportRequest, type MenuCommand, type PdfRequest, type SaveRequest } from '../shared/ipc';
import { clearAutosave, exportFile, openProject, openProjectAt, printPdf, readAutosave, saveProject, writeAutosave } from './files';
import { appliedSwitches, configureGpu, readGpuSettings, writeGpuSettings } from './gpu';

configureGpu();

let win: BrowserWindow | null = null;
let dirty = false;
let pendingOpenPath: string | null = process.argv.find((a) => a.toLowerCase().endsWith('.cabproj')) ?? null;

const send = (cmd: MenuCommand) => win?.webContents.send(IPC.menu, cmd);

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        { label: 'Cutlist & Hardware…', accelerator: 'CmdOrCtrl+L', click: () => send('cutlist') },
        { label: 'Export Cutlist (CSV)…', click: () => send('export-cutlist') },
        { label: 'Drawings (PDF)…', accelerator: 'CmdOrCtrl+P', click: () => send('drawings') },
        { label: 'Render Image…', accelerator: 'CmdOrCtrl+R', click: () => send('render') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { label: 'Duplicate   Ctrl+D', click: () => send('duplicate') },
        { label: 'Delete   Del', click: () => send('delete') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Floor Plan   1', click: () => send('view-plan') },
        { label: 'Front Elevation   2', click: () => send('view-front') },
        { label: 'Side Elevation   3', click: () => send('view-side') },
        { label: '3D Perspective   4', click: () => send('view-3d') },
        { label: 'Walkthrough   5', click: () => send('view-walk') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Graphics & GPU…', click: () => send('gpu') },
        { label: 'About Cabinet Studio', click: () => send('about') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#0d0f12',
    title: 'Cabinet Studio',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
  });
  win.once('ready-to-show', () => win?.show());

  // Nothing in the app navigates; external links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL;
    if (!dev || !url.startsWith(dev)) e.preventDefault();
  });

  win.on('close', (e) => {
    if (!dirty || !win) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'This project has unsaved changes.',
      detail: 'A recovery copy is kept and will be offered next time you open Cabinet Studio.',
    });
    if (choice === 1) e.preventDefault();
  });
  win.on('closed', () => (win = null));

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

function registerIpc(): void {
  const w = () => {
    if (!win) throw new Error('No window');
    return win;
  };
  ipcMain.handle(IPC.open, () => openProject(w()));
  ipcMain.handle(IPC.openAt, (_e, path: string) => openProjectAt(path));
  ipcMain.handle(IPC.save, (_e, req: SaveRequest) => saveProject(w(), req));
  ipcMain.handle(IPC.export, (_e, req: ExportRequest) => exportFile(w(), req));
  ipcMain.handle(IPC.printPdf, (_e, req: PdfRequest) => printPdf(w(), req));
  ipcMain.handle(IPC.autosaveWrite, (_e, rec: AutosaveRecord) => writeAutosave(rec));
  ipcMain.handle(IPC.autosaveRead, () => readAutosave());
  ipcMain.handle(IPC.autosaveClear, () => clearAutosave());
  ipcMain.handle(IPC.gpu, async () => ({
    featureStatus: app.getGPUFeatureStatus() as unknown as Record<string, string>,
    info: await app.getGPUInfo('basic').catch(() => null),
    switches: appliedSwitches,
    forceGpu: readGpuSettings().forceGpu,
  }));
  ipcMain.handle(IPC.forceGpu, (_e, on: boolean) => writeGpuSettings({ forceGpu: !!on }));
  ipcMain.handle(IPC.pendingOpen, () => {
    const p = pendingOpenPath;
    pendingOpenPath = null;
    return p;
  });
  ipcMain.on(IPC.title, (_e, title: string) => win?.setTitle(String(title)));
  ipcMain.on(IPC.dirty, (_e, d: boolean) => {
    dirty = !!d;
    win?.setDocumentEdited(dirty);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = argv.find((a) => a.toLowerCase().endsWith('.cabproj'));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (p) win.webContents.send(IPC.openPath, p);
    }
  });
  app.on('open-file', (e, path) => {
    e.preventDefault();
    if (win) win.webContents.send(IPC.openPath, path);
    else pendingOpenPath = path;
  });
  app.whenReady().then(() => {
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
