import cron from 'node-cron';
import { resetAllQueues } from './queue';
import { loadConfig, saveConfig, logError } from './config';

let scheduledTask: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  const config = loadConfig();
  scheduleReset(config.resetTime);
  checkMissedReset(config.resetTime, config.lastReset);
}

function scheduleReset(resetTime: string): void {
  if (scheduledTask) scheduledTask.stop();

  const [hour, minute] = resetTime.split(':').map(Number);
  if (isNaN(hour) || isNaN(minute)) {
    logError(`Invalid reset time: ${resetTime}`);
    return;
  }

  scheduledTask = cron.schedule(`${minute} ${hour} * * *`, () => {
    try {
      resetAllQueues();
      const config = loadConfig();
      config.lastReset = new Date().toISOString().split('T')[0];
      saveConfig(config);
    } catch (err: any) {
      logError(`Scheduled reset failed: ${err.message}`);
    }
  });
}

function checkMissedReset(resetTime: string, lastReset: string): void {
  const today = new Date().toISOString().split('T')[0];
  if (lastReset === today) return;

  const [hour, minute] = resetTime.split(':').map(Number);
  const now = new Date();
  const scheduledToday = new Date();
  scheduledToday.setHours(hour, minute, 0, 0);

  // If we're past the reset time and haven't reset today, do it now
  if (now >= scheduledToday) {
    try {
      resetAllQueues();
      const config = loadConfig();
      config.lastReset = today;
      saveConfig(config);
    } catch (err: any) {
      logError(`Startup reset failed: ${err.message}`);
    }
  }
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}
