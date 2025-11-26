import { app, BrowserWindow, screen, dialog, shell, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { captureToFile } from './screen';
import { mouse, keyboard, Point } from '@nut-tree-fork/nut-js';
import macPermissions from 'node-mac-permissions';
import { logEvent, logError, initLogger } from './log';
import { processComputerUseClaude } from './services/agent';
import { config, validateConfig, getUserEnvPath, refreshConfig } from './config';
import { setMainWindow } from './statusManager';
import { ClaudeModelClient } from './services/modelClient';

// Global abort controller for cancelling computer use
let currentAbortController: AbortController | null = null;

// Model client (Claude-only)
let claudeClient: ClaudeModelClient | null = null;

function initializeModelClient(): void {
  claudeClient = new ClaudeModelClient({
    apiKey: config.claude.apiKey,
    model: config.claude.model,
  });
  logEvent('model_client_init', { provider: 'claude', model: config.claude.model });
}

let win: BrowserWindow | null = null;

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
}

let history: HistoryMessage[] = [];

function historyPath(): string {
  return path.join(app.getPath('userData'), 'history.json');
}

async function loadHistory(): Promise<void> {
  try {
    const p = historyPath();
    if (fs.existsSync(p)) {
      const data = await fsp.readFile(p, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        history = parsed.filter(
          (m: unknown) =>
            m &&
            typeof m === 'object' &&
            ((m as HistoryMessage).role === 'user' || (m as HistoryMessage).role === 'assistant') &&
            typeof (m as HistoryMessage).content === 'string'
        );
      }
    }
  } catch (err) {
    logError('history_load_error', err as Error);
    history = [];
  }
}

async function saveHistory(): Promise<void> {
  try {
    const p = historyPath();
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, JSON.stringify(history.slice(-config.ui.maxHistoryEntries)), 'utf8');
  } catch (err) {
    logError('history_save_error', err as Error);
  }
}

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 400;
  const windowHeight = config.ui.pillBaseHeight;

  win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((width - windowWidth) / 2),
    y: height - windowHeight,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch (err) {
    logError('set_all_workspaces_error', err as Error);
  }

  const basePublicPath = app.isPackaged
    ? path.join(app.getAppPath(), 'public')
    : path.join(process.cwd(), 'public');
  const indexPath = path.join(basePublicPath, 'index.html');
  win.loadFile(indexPath);

  // Open DevTools in development
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  setMainWindow(win);
}

function ensureRuntimeConfig(): boolean {
  const errors = validateConfig();
  const criticalErrors = errors.filter((e) => !e.includes('API_KEY'));
  if (criticalErrors.length === 0) return true;

  const detail = [
    'Set the following environment variables (or add them to the user override file):',
    '',
    ...criticalErrors.map((err) => `• ${err}`),
    '',
    `User override file: ${getUserEnvPath()}`,
  ].join('\n');

  dialog.showMessageBoxSync({
    type: 'error',
    buttons: ['Quit'],
    title: 'Lark',
    message: 'Missing configuration',
    detail,
  });

  app.quit();
  return false;
}

app.whenReady().then(async () => {
  initLogger(app);
  logEvent('app_start');

  if (!ensureRuntimeConfig()) {
    return;
  }

  initializeModelClient();

  // Request accessibility permission
  const accessStatus = macPermissions.getAuthStatus('accessibility');
  if (accessStatus !== 'authorized') {
    macPermissions.askForAccessibilityAccess();
    dialog.showMessageBox({
      message: 'Accessibility permission is required for mouse and keyboard control.',
    });
  }
  logEvent('permission_accessibility_status', { status: accessStatus });

  // Request screen capture permission
  const screenStatus = macPermissions.getAuthStatus('screen');
  if (screenStatus !== 'authorized') {
    macPermissions.askForScreenCaptureAccess();
    dialog.showMessageBox({
      message: 'Screen recording permission is required for screenshots.',
    });
  }
  logEvent('permission_screen_status', { status: screenStatus });

  createWindow();
  await loadHistory();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handler for computer-use
ipcMain.handle('ask-openai', async (_event, prompt: unknown) => {
  try {
    const p = typeof prompt === 'string' ? prompt.trim() : '';
    if (!p) {
      logError('model_invalid_prompt', new Error('Empty prompt'));
      return 'Please enter a prompt.';
    }

    const safePrompt = p.slice(0, config.ui.maxPromptLength);
    logEvent('model_request', { prompt_length: safePrompt.length });

    currentAbortController = new AbortController();

    try {
      if (!claudeClient) {
        throw new Error('No Claude client initialized');
      }

      const content = await processComputerUseClaude(
        claudeClient,
        safePrompt,
        currentAbortController.signal
      );

      const now = Date.now();
      const MAX_SAVE_LEN = 4000;
      const truncate = (s: string) => (s || '').slice(0, MAX_SAVE_LEN);
      history.push({ role: 'user', content: truncate(safePrompt), ts: now });
      history.push({ role: 'assistant', content: truncate(content), ts: now + 1 });
      saveHistory();

      logEvent('model_response', { content_length: content?.length ?? 0 });
      return content;
    } catch (error) {
      if (
        (error as Error).name === 'AbortError' ||
        currentAbortController?.signal.aborted
      ) {
        logEvent('computer_use_aborted');
        return 'Task stopped by user';
      }
      throw error;
    } finally {
      currentAbortController = null;
    }
  } catch (err) {
    logError('model_error', err as Error);
    return 'Error processing your request.';
  }
});

ipcMain.handle('stop-computer-use', async () => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    logEvent('computer_use_cancelled');
  }
});

ipcMain.handle('control-mouse', async (_event, coords: unknown) => {
  try {
    const c = coords as { x?: number; y?: number };
    let x = Number(c?.x);
    let y = Number(c?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid coordinates');

    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
    x = clamp(Math.round(x), wa.x, wa.x + wa.width - 1);
    y = clamp(Math.round(y), wa.y, wa.y + wa.height - 1);

    await mouse.setPosition(new Point(x, y));
    logEvent('mouse_move', { x, y });
    return 'Mouse moved';
  } catch (err) {
    logError('mouse_move_invalid', err as Error);
    return 'Invalid mouse coordinates';
  }
});

ipcMain.handle('control-keyboard', async (_event, text: unknown) => {
  const t = typeof text === 'string' ? text : '';
  const toType = t.slice(0, config.ui.maxTypeLength);
  try {
    if (!toType) return 'Nothing to type';
    await keyboard.type(toType);
    logEvent('keyboard_type', { length: toType.length });
    return 'Typed';
  } catch (err) {
    logError('keyboard_type_error', err as Error);
    return 'Typing failed';
  }
});

ipcMain.handle('capture-screen', async () => {
  try {
    const imgPath = path.join(app.getPath('pictures'), `capture-${Date.now()}.png`);
    await captureToFile(imgPath);
    logEvent('screen_captured', { path: imgPath });
    return imgPath;
  } catch (err) {
    logError('screen_capture_error', err as Error);
    return 'Failed to capture screen';
  }
});

ipcMain.handle('resize-window', (_event, requestedHeight: unknown) => {
  if (!win) return;
  try {
    const reqH = Number(requestedHeight);
    if (!Number.isFinite(reqH)) return;

    const bounds = win.getBounds();
    const minH = config.ui.pillBaseHeight;
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const safeMargin = 40;
    const workAreaMax = Math.max(minH, (workArea?.height ?? 600) - safeMargin);
    const configuredMax = config.ui.windowMaxHeight;
    const dynamicMaxH = Math.max(minH, Math.min(workAreaMax, configuredMax));
    const newHeight = Math.max(minH, Math.min(Math.floor(reqH || minH), dynamicMaxH));
    const newY = bounds.y + (bounds.height - newHeight);
    win.setBounds({ x: bounds.x, y: newY, width: bounds.width, height: newHeight });
  } catch (err) {
    logError('resize_window_error', err as Error);
  }
});

ipcMain.handle('get-history', async () => {
  try {
    if (!history.length) await loadHistory();
    return history.slice(-config.ui.maxHistoryEntries);
  } catch (err) {
    logError('get_history_error', err as Error);
    return [];
  }
});

ipcMain.handle('clear-history', async () => {
  try {
    history = [];
    await saveHistory();
  } catch (err) {
    logError('clear_history_error', err as Error);
  }
});

ipcMain.handle('get-constants', async () => ({
  PILL_BASE_HEIGHT: config.ui.pillBaseHeight,
}));

ipcMain.handle('get-config-status', async () => {
  const provider = 'claude';
  const needsApiKey = true;
  const hasApiKey = !!config.claude.apiKey;
  return { provider, needsApiKey, hasApiKey };
});

ipcMain.handle('save-api-key', async (_event, apiKey: unknown) => {
  try {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) {
      return { success: false, error: 'API key cannot be empty' };
    }

    if (!key.startsWith('sk-ant-')) {
      return { success: false, error: 'Invalid key format. Anthropic keys start with sk-ant-' };
    }

    const envVarName = 'ANTHROPIC_API_KEY';
    const provider = 'claude';

    const userEnvPath = getUserEnvPath();
    let content = '';
    try {
      await fsp.mkdir(path.dirname(userEnvPath), { recursive: true });
      if (fs.existsSync(userEnvPath)) {
        content = await fsp.readFile(userEnvPath, 'utf8');
      }
    } catch {
      // ignore
    }

    const lines = content.split('\n');
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(`${envVarName}=`)) {
        lines[i] = `${envVarName}=${key}`;
        found = true;
        break;
      }
    }

    if (!found) {
      const hasProvider = lines.some((l) => l.startsWith('MODEL_PROVIDER='));
      if (!hasProvider) {
        lines.unshift(`MODEL_PROVIDER=${provider}`);
      }
      lines.push(`${envVarName}=${key}`);
    }

    await fsp.writeFile(
      userEnvPath,
      lines.filter((l, idx) => l.trim() !== '' || idx === lines.length - 1).join('\n') + '\n'
    );

    process.env[envVarName] = key;
    refreshConfig();
    initializeModelClient();

    logEvent('api_key_saved', { provider });
    return { success: true };
  } catch (err) {
    logError('save_api_key_error', err as Error);
    return { success: false, error: String((err as Error)?.message || 'Failed to save API key') };
  }
});
