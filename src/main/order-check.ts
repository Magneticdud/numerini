import { execFile } from 'child_process';
import { logError } from './config';

export type OrderCheckResult = 'ready' | 'not_ready' | 'error';

const TIMEOUT_MS = 3000;
const ORDER_NUM_RE = /^\d+$/;

export async function checkOrder(orderCheckUrl: string, orderNumber: string): Promise<OrderCheckResult> {
  if (!ORDER_NUM_RE.test(orderNumber)) {
    logError(`Invalid order number format: ${orderNumber}`);
    return 'error';
  }

  const url = `${orderCheckUrl.replace(/\/$/, '')}/${orderNumber}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return 'error';

    const data = await response.json();
    if (typeof data.ready !== 'boolean') return 'error';
    return data.ready ? 'ready' : 'not_ready';
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      logError(`Order check failed for ${url}: ${err?.message}`);
    }
    return 'error';
  }
}
