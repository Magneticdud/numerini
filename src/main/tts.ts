import { execFile } from 'child_process';
import { logError } from './config';

export function speak(text: string, language: string): void {
  execFile('espeak-ng', ['-l', language, text], (err) => {
    if (err) logError(`TTS error: ${err.message}`);
  });
}

export function announceNumber(number: number, queueName: string, language: string): void {
  const msgs: Record<string, string> = {
    it: `Numero ${number}, ${queueName}`,
    en: `Number ${number}, ${queueName}`,
    fr: `Numéro ${number}, ${queueName}`,
    de: `Nummer ${number}, ${queueName}`,
    es: `Número ${number}, ${queueName}`,
  };
  speak(msgs[language] ?? msgs['it'], language);
}

export function isTtsAvailable(): boolean {
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('which', ['espeak-ng'], { timeout: 2000 });
    return result.status === 0;
  } catch {
    return false;
  }
}
