import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface QueueConfig {
  id: number;
  name: string;
  description: string;
  type: 'normal' | 'order_pickup';
  orderCheckUrl?: string;
}

export interface Config {
  queues: QueueConfig[];
  displays: {
    kioskDisplayId: number | null;
    displayDisplayId: number | null;
  };
  printerPath: string;
  adminToken: string;
  brandColor: string;
  slidesDir: string;
  slideshowIntervalMs: number;
  openTime: string;
  closeTime: string;
  resetTime: string;
  lastReset: string;
  ttsEnabled: boolean;
  ttsLanguage: string;
  language: string;
  cfTunnelToken?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'numerini');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const BRAND_DIR = path.join(os.homedir(), 'numerini', 'brand');
const SLIDES_DIR = path.join(os.homedir(), 'numerini', 'slides');
const LOGS_DIR = path.join(CONFIG_DIR, 'logs');

export function ensureDirs(): void {
  [CONFIG_DIR, BRAND_DIR, SLIDES_DIR, LOGS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function loadConfig(): Config {
  ensureDirs();
  if (!configExists()) {
    return getDefaultConfig();
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...getDefaultConfig(), ...JSON.parse(raw) };
  } catch {
    return getDefaultConfig();
  }
}

export function saveConfig(config: Config): void {
  ensureDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getDefaultConfig(): Config {
  return {
    queues: [{ id: 1, name: 'Coda principale', description: '', type: 'normal' }],
    displays: { kioskDisplayId: null, displayDisplayId: null },
    printerPath: '/dev/usb/lp0',
    adminToken: crypto.randomBytes(32).toString('hex'),
    brandColor: '#3182ce',
    slidesDir: SLIDES_DIR,
    slideshowIntervalMs: 10000,
    openTime: '09:00',
    closeTime: '19:00',
    resetTime: '09:00',
    lastReset: '',
    ttsEnabled: true,
    ttsLanguage: 'it',
    language: 'it',
  };
}

export function logError(message: string): void {
  ensureDirs();
  const logFile = path.join(LOGS_DIR, 'app.log');
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf-8');
  } catch { /* ignore log errors */ }
}

export const BRAND_DIR_PATH = BRAND_DIR;
export const LOGO_PATH = path.join(BRAND_DIR, 'logo.png');
export const LOGO_RECEIPT_PATH = path.join(BRAND_DIR, 'logo-receipt.png');
