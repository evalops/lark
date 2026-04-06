import { app, BrowserWindow, screen, dialog, globalShortcut } from 'electron';
import path from 'path';
import macPermissions from 'node-mac-permissions';
import { logEvent, logError, initLogger } from './log';
import { config, validateConfig, getUserEnvPath } from './config';
import { setMainWindow } from './statusManager';
import { IModelClient, ClaudeModelClient } from './services/modelClient';
import { GeminiModelClient } from './services/geminiClient';
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
      win.webContents.send('status-update', 'Emergency stop');
    }
  }
}

// Toggle window visibility
function toggleWindow(): void {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
    logEvent('window_hidden');
  } else {
    win.show();
    win.focus();
    logEvent('window_shown');
  }
}

// Focus input for new task
function focusNewTask(): void {
  if (!win) return;
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
  win.webContents.send('focus-input');
  logEvent('new_task_focused');
}

// Get display for window placement based on config preference
function getPreferredDisplay(): Electron.Display {
  const preference = config.display?.preferredMonitor ?? 'primary';
  
  if (preference === 'cursor') {
    const cursorPoint = screen.getCursorScreenPoint();
    return screen.getDisplayNearestPoint(cursorPoint);
  }
  
  if (typeof preference === 'number') {
    const allDisplays = screen.getAllDisplays();
    if (preference >= 0 && preference < allDisplays.length) {
      return allDisplays[preference];
    }
  }
  
  return screen.getPrimaryDisplay();
}

// Model client
let modelClient: IModelClient | null = null;

function initializeModelClient(): void {
  if (config.model.provider === 'claude') {
    modelClient = new ClaudeModelClient({
      apiKey: config.claude.apiKey,
      model: config.claude.model,
    });
    logEvent('model_client_init', { provider: 'claude', model: config.claude.model });
  } else if (config.model.provider === 'gemini') {
    modelClient = new GeminiModelClient({
      apiKey: config.gemini.apiKey,
      model: config.gemini.model,
    });
    logEvent('model_client_init', { provider: 'gemini', model: config.gemini.model });
  } else {
    logError('model_client_init_error', new Error(`Unknown provider: ${config.model.provider}`));
  }
}

let win: BrowserWindow | null = null;

function createWindow(): void {
  const display = getPreferredDisplay();
  const { width, height } = display.workAreaSize;
  const { x: displayX, y: displayY } = display.workArea;
  const windowWidth = config.ui.windowWidth;
  const windowHeight = config.ui.pillBaseHeight;

  win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: displayX + Math.round((width - windowWidth) / 2),
    y: displayY + height - windowHeight,
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
  // Filter out missing API key errors if we are just checking struct
  // But actually we need keys. However, for first run we might want to allow start to set keys.
  // The logic in validateConfig checks for keys based on provider.
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
    getModelClient: () => modelClient,
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

  // Register global shortcuts
  const shortcuts = config.shortcuts ?? {
    emergencyStop: 'Escape',
    toggleWindow: 'CommandOrControl+Shift+L',
    newTask: 'CommandOrControl+Shift+N',
  };

  if (shortcuts.emergencyStop) {
    globalShortcut.register(shortcuts.emergencyStop, emergencyStop);
    logEvent('global_hotkey_registered', { key: shortcuts.emergencyStop, action: 'emergencyStop' });
  }

  if (shortcuts.toggleWindow) {
    globalShortcut.register(shortcuts.toggleWindow, toggleWindow);
    logEvent('global_hotkey_registered', { key: shortcuts.toggleWindow, action: 'toggleWindow' });
  }

  if (shortcuts.newTask) {
    globalShortcut.register(shortcuts.newTask, focusNewTask);
    logEvent('global_hotkey_registered', { key: shortcuts.newTask, action: 'newTask' });
  }

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
