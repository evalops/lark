import { App } from 'electron';
import fs from 'fs';
import path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  data?: unknown;
  pid?: number;
  sessionId?: string;
}

let logPath: string | null = null;
let sessionId: string | null = null;
let minLevel: LogLevel = 'INFO';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

export function initLogger(app: App): void {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    
    // Clean up old log files (keep last 10)
    const files = fs.readdirSync(logsDir)
      .filter(f => f.startsWith('lark-') && f.endsWith('.log'))
      .sort()
      .reverse();
    
    for (const file of files.slice(10)) {
      try {
        fs.unlinkSync(path.join(logsDir, file));
      } catch {
        // ignore cleanup errors
      }
    }
    
    sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    logPath = path.join(logsDir, `lark-${sessionId}.log`);
    
    // Set log level from environment
    const envLevel = process.env.LOG_LEVEL?.toUpperCase() as LogLevel;
    if (envLevel && LEVEL_PRIORITY[envLevel] !== undefined) {
      minLevel = envLevel;
    }
  } catch {
    logPath = null;
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatConsoleOutput(level: LogLevel, event: string, data?: unknown): string {
  const timestamp = new Date().toISOString().slice(11, 23);
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  return `${timestamp} [${level.padEnd(5)}] ${event}${dataStr}`;
}

function writeLog(level: LogLevel, event: string, data?: unknown): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(data !== undefined ? { data } : {}),
    pid: process.pid,
    ...(sessionId ? { sessionId } : {}),
  };

  const line = JSON.stringify(entry) + '\n';
  
  // Console output with colors in development
  const consoleMethod = level === 'ERROR' ? console.error 
    : level === 'WARN' ? console.warn 
    : console.log;
  consoleMethod(formatConsoleOutput(level, event, data));

  if (logPath) {
    try {
      fs.appendFileSync(logPath, line);
    } catch {
      // ignore write errors
    }
  }
}

export function logDebug(event: string, data?: unknown): void {
  writeLog('DEBUG', event, data);
}

export function logEvent(event: string, data?: unknown): void {
  writeLog('INFO', event, data);
}

export function logWarn(event: string, data?: unknown): void {
  writeLog('WARN', event, data);
}

export function logError(event: string, error: Error, extra?: unknown): void {
  writeLog('ERROR', event, {
    message: error?.message,
    stack: error?.stack,
    name: error?.name,
    ...(extra || {}),
  });
}

export function getLogPath(): string | null {
  return logPath;
}

export function getSessionId(): string | null {
  return sessionId;
}
