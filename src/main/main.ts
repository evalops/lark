import { app, BrowserWindow, screen, dialog, globalShortcut } from 'electron';
import path from 'path';
import macPermissions from 'node-mac-permissions';
import { logEvent, logError, initLogger } from './log';
import { config, validateConfig, getUserEnvPath } from './config';
import { setMainWindow } from './statusManager';
import { ClaudeModelClient } from './services/modelClient';
import { registerIpcHandlers, loadHistory } from './ipcHandlers';
import { destroyIndicator } from './cursorIndicator';

// Global abort controller for cancelling computer use
let currentAbortController: AbortController | null = null;

// Emergency stop function
function emergencyStop(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    logEvent('emergency_stop_triggered');
    if (win) {
      win.webContents.send('status-update', 'Emergency stop (Escape)');
    }
  }
}

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

  // Register IPC handlers
  registerIpcHandlers({
    getAbortController: () => currentAbortController,
    setAbortController: (controller) => { currentAbortController = controller; },
    getClaudeClient: () => claudeClient,
    initializeModelClient,
    getWindow: () => win,
  });

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

  // Register global Escape hotkey for emergency stop
  globalShortcut.register('Escape', emergencyStop);
  logEvent('global_hotkey_registered', { key: 'Escape' });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyIndicator();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
