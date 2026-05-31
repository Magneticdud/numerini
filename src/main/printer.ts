import fs from 'fs';
import path from 'path';
import { logError } from './config';

const PRINT_TIMEOUT_MS = 5000;

// ESC/POS command bytes
const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

function cmd(...bytes: number[]): Buffer { return Buffer.from(bytes); }

const INIT        = cmd(ESC, 0x40);
const ALIGN_C     = cmd(ESC, 0x61, 0x01);
const ALIGN_L     = cmd(ESC, 0x61, 0x00);
const BOLD_ON     = cmd(ESC, 0x45, 0x01);
const BOLD_OFF    = cmd(ESC, 0x45, 0x00);
const DOUBLE_H_ON = cmd(ESC, 0x21, 0x10);
const DOUBLE_H_OFF= cmd(ESC, 0x21, 0x00);
const CUT         = cmd(GS,  0x56, 0x42, 0x00);

function text(s: string): Buffer { return Buffer.from(s + '\n', 'utf-8'); }

interface ReceiptData {
  shopName: string;
  queueName: string;
  ticketLabel: string; // '022' for normal tickets, '22B' for transfers
  waitUrl?: string;
  logoPath?: string;
  advisory?: string;
}

export async function printTicket(printerPath: string, data: ReceiptData): Promise<void> {
  const parts: Buffer[] = [
    INIT,
    ALIGN_C,
    BOLD_ON, DOUBLE_H_ON, text(data.shopName), DOUBLE_H_OFF, BOLD_OFF,
    text('─────────────────────────'),
    ALIGN_L,
    text(`Data: ${new Date().toLocaleDateString('it-IT')}  Ora: ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`),
    text(`Coda: ${data.queueName}`),
    text('─────────────────────────'),
    ALIGN_C,
    BOLD_ON, DOUBLE_H_ON,
    text(data.ticketLabel.padStart(4, ' ')),
    DOUBLE_H_OFF, BOLD_OFF,
    text('─────────────────────────'),
  ];

  if (data.advisory) {
    parts.push(ALIGN_L, text(data.advisory));
  }

  if (data.waitUrl) {
    parts.push(ALIGN_C, text('Segui il tuo numero:'), text(data.waitUrl));
  }

  parts.push(Buffer.from([LF, LF, LF]), CUT);

  const receipt = Buffer.concat(parts);
  await writeWithTimeout(printerPath, receipt);
}

async function writeWithTimeout(printerPath: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Print timeout')), PRINT_TIMEOUT_MS);

    // Check lp group permission first
    if (!fs.existsSync(printerPath)) {
      clearTimeout(timer);
      reject(new Error(`Printer not found at ${printerPath}`));
      return;
    }

    fs.open(printerPath, 'w', (err, fd) => {
      if (err) {
        clearTimeout(timer);
        reject(new Error(`Cannot open printer: ${err.message}`));
        return;
      }
      fs.write(fd, data, 0, data.length, null, (writeErr) => {
        fs.close(fd, () => {
          clearTimeout(timer);
          if (writeErr) reject(new Error(`Print write failed: ${writeErr.message}`));
          else resolve();
        });
      });
    });
  });
}

export function detectPrinter(): string | null {
  const candidates = [
    '/dev/usb/lp0',
    '/dev/usb/lp1',
    '/dev/usb/lp2',
    '/dev/ttyUSB0',
    '/dev/ttyUSB1',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
