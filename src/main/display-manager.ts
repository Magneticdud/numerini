import { BrowserWindow, screen, app, ipcMain } from 'electron';
import path from 'path';
import type { Config } from './config';
import { saveConfig, loadConfig, logError } from './config';
import { registerRenderer } from './events';

const RENDERER_DIR = path.resolve(__dirname, '../renderer');

let kioskWin: BrowserWindow | null = null;
let displayWin: BrowserWindow | null = null;
let isAssigning = false;

export function createWindows(config: Config): void {
  const displays = screen.getAllDisplays();

  const kiosk = findDisplay(displays, config.displays.kioskDisplayId);
  const disp  = findDisplay(displays, config.displays.displayDisplayId);

  if (!kiosk || needsAssignment(config, displays)) {
    openAssignmentWizard(config);
    return;
  }

  openKioskWindow(kiosk, config);
  if (disp && disp.id !== kiosk.id) {
    openDisplayWindow(disp, config);
  }

  // Re-open display if monitor is reconnected
  screen.on('display-added', () => {
    const cfg = loadConfig();
    const allDisplays = screen.getAllDisplays();
    const dispScreen = findDisplay(allDisplays, cfg.displays.displayDisplayId);
    if (dispScreen && !displayWin) {
      openDisplayWindow(dispScreen, cfg);
    } else if (!dispScreen && cfg.displays.displayDisplayId !== null) {
      // ID not found — trigger re-assignment
      openAssignmentWizard(cfg);
    }
  });

  screen.on('display-removed', () => {
    if (displayWin && displayWin.isDestroyed()) displayWin = null;
    if (kioskWin && kioskWin.isDestroyed()) kioskWin = null;
  });
}

function findDisplay(displays: Electron.Display[], id: number | null): Electron.Display | null {
  if (id === null) return displays[0] ?? null;
  return displays.find(d => d.id === id) ?? null;
}

function needsAssignment(config: Config, displays: Electron.Display[]): boolean {
  if (displays.length === 0) return true;
  if (config.displays.kioskDisplayId === null) return true;
  const found = displays.some(d => d.id === config.displays.kioskDisplayId);
  return !found;
}

function openKioskWindow(display: Electron.Display, config: Config): void {
  const { bounds } = display;
  kioskWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fullscreen: true,
    frame: false,
    kiosk: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  kioskWin.loadFile(path.join(RENDERER_DIR, 'kiosk.html'));
  registerRenderer(kioskWin.webContents);
  kioskWin.on('closed', () => { kioskWin = null; });
}

function openDisplayWindow(display: Electron.Display, config: Config): void {
  const { bounds } = display;
  displayWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    fullscreen: true,
    frame: false,
    kiosk: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  displayWin.loadFile(path.join(RENDERER_DIR, 'display.html'));
  registerRenderer(displayWin.webContents);
  displayWin.on('closed', () => { displayWin = null; });
}

export function openAssignmentWizard(config: Config): void {
  if (isAssigning) return;
  isAssigning = true;

  const wizard = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Numerini — Configurazione',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // For now, serve the wizard UI — in the kiosk renderer we'll detect wizard mode
  wizard.loadFile(path.join(RENDERER_DIR, 'kiosk.html'));
  wizard.webContents.once('did-finish-load', () => {
    wizard.webContents.send('wizard-mode', {
      displays: screen.getAllDisplays().map(d => ({
        id: d.id,
        label: `${d.bounds.width}×${d.bounds.height} (${d.id === screen.getPrimaryDisplay().id ? 'principale' : 'secondario'})`,
        bounds: d.bounds,
      })),
      config,
    });
  });

  ipcMain.once('wizard-complete', (_event, result: { kioskDisplayId: number; displayDisplayId: number | null }) => {
    isAssigning = false;
    const cfg = loadConfig();
    cfg.displays.kioskDisplayId = result.kioskDisplayId;
    cfg.displays.displayDisplayId = result.displayDisplayId;
    saveConfig(cfg);
    wizard.close();
    createWindows(cfg);
  });

  wizard.on('closed', () => { isAssigning = false; });
}

export function getKioskWin(): BrowserWindow | null { return kioskWin; }
export function getDisplayWin(): BrowserWindow | null { return displayWin; }
