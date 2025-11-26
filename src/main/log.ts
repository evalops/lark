import { App } from 'electron';
import fs from 'fs';
import path from 'path';

let logPath: string | null = null;

export function initLogger(app: App): void {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    logPath = path.join(logsDir, `lark-${Date.now()}.log`);
  } catch {
    logPath = null;
  }
}

function writeLog(level: string, event: string, data?: unknown): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(data ? { data } : {}),
  };
  const line = JSON.stringify(entry) + '\n';
  console.log(`[${level}] ${event}`, data || '');
  if (logPath) {
    try {
      fs.appendFileSync(logPath, line);
    } catch {
      // ignore write errors
    }
  }
}

export function logEvent(event: string, data?: unknown): void {
  writeLog('INFO', event, data);
}

export function logError(event: string, error: Error, extra?: unknown): void {
  writeLog('ERROR', event, {
    message: error?.message,
    stack: error?.stack,
    ...(extra || {}),
  });
}
