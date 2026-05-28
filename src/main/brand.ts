import fs from 'fs';
import path from 'path';
import { BRAND_DIR_PATH, LOGO_PATH, LOGO_RECEIPT_PATH, logError } from './config';

export async function convertLogoForReceipt(): Promise<boolean> {
  if (!fs.existsSync(LOGO_PATH)) return false;
  try {
    const Jimp = (await import('jimp')).default;
    const img = await Jimp.read(LOGO_PATH);
    // Scale to max 384px wide (58mm paper at 203dpi), preserve aspect
    if (img.getWidth() > 384) {
      img.resize(384, Jimp.AUTO);
    }
    img.greyscale().contrast(0.5);
    await img.writeAsync(LOGO_RECEIPT_PATH);
    return true;
  } catch (err: any) {
    logError(`Logo conversion failed: ${err.message}`);
    return false;
  }
}

export function logoExists(): boolean {
  return fs.existsSync(LOGO_PATH);
}

export function logoReceiptExists(): boolean {
  return fs.existsSync(LOGO_RECEIPT_PATH);
}

export function saveBrandColor(hexColor: string): void {
  const colorFile = path.join(BRAND_DIR_PATH, 'color.json');
  fs.writeFileSync(colorFile, JSON.stringify({ hex: hexColor }), 'utf-8');
}

export function saveLogoFromPath(sourcePath: string): boolean {
  try {
    if (!fs.existsSync(sourcePath)) return false;
    fs.copyFileSync(sourcePath, LOGO_PATH);
    return true;
  } catch {
    return false;
  }
}
