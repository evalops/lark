import { ipcMain, app, screen, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { mouse, keyboard, Point } from '@nut-tree-fork/nut-js';
import { captureToFile } from './screen';
import { logEvent, logError } from './log';
import { processComputerUse, resolveConfirmation } from './services/agent';
import { config, getUserEnvPath, refreshConfig, saveUserConfig, Config, DeepPartial } from './config';
import { IModelClient } from './services/modelClient';
import Anthropic from '@anthropic-ai/sdk';

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
}

interface IpcContext {
  getAbortController: () => AbortController | null;
  setAbortController: (controller: AbortController | null) => void;
  getModelClient: () => IModelClient | null;
  initializeModelClient: () => void;
  getWindow: () => BrowserWindow | null;
}

let history: HistoryMessage[] = [];
let lastSessionMessages: Anthropic.MessageParam[] | null = null;

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

export { loadHistory };

export function registerIpcHandlers(ctx: IpcContext): void {
  // Computer use handler
  ipcMain.handle('ask-openai', async (_event, prompt: unknown) => {
    try {
      const p = typeof prompt === 'string' ? prompt.trim() : '';
      if (!p) {
        logError('model_invalid_prompt', new Error('Empty prompt'));
        return 'Please enter a prompt.';
      }

      const safePrompt = p.slice(0, config.ui.maxPromptLength);
      logEvent('model_request', { prompt_length: safePrompt.length });

      const abortController = new AbortController();
      ctx.setAbortController(abortController);

      try {
        const client = ctx.getModelClient();
        if (!client) {
          throw new Error('No model client initialized');
        }

        let result;
        
        // Check if we are resuming a session (responding to ask_user)
        if (lastSessionMessages) {
          const lastMsg = lastSessionMessages[lastSessionMessages.length - 1];
          if (lastMsg.role === 'assistant' && Array.isArray(lastMsg.content)) {
            const toolUse = lastMsg.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === 'ask_user');
            
            if (toolUse) {
              // Append the user's response as a tool_result
              lastSessionMessages.push({
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: toolUse.id, 
                  content: safePrompt
                }]
              });
              
              result = await processComputerUse(
                client,
                safePrompt, // This is logged/used for context but messages are main source
                abortController.signal,
                lastSessionMessages
              );
            }
          }
        }
        
        // If not resuming or resume failed, start fresh
        if (!result) {
          lastSessionMessages = null; // Clear any stale session
          result = await processComputerUse(
            client,
            safePrompt,
            abortController.signal
          );
        }

        const content = result.content;

        // Manage session persistence
        if (result.shouldResume && result.messages) {
          lastSessionMessages = result.messages;
        } else {
          lastSessionMessages = null;
        }

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
          ctx.getAbortController()?.signal.aborted
        ) {
          logEvent('computer_use_aborted');
          return 'Task stopped by user';
        }
        throw error;
      } finally {
        ctx.setAbortController(null);
      }
    } catch (err) {
      logError('model_error', err as Error);
      return 'Error processing your request.';
    }
  });

  // Stop computer use
  ipcMain.handle('stop-computer-use', async () => {
    const controller = ctx.getAbortController();
    if (controller) {
      controller.abort();
      ctx.setAbortController(null);
      logEvent('computer_use_cancelled');
    }
    // Clear any pending session
    lastSessionMessages = null;
  });

  // Mouse control
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

  // Keyboard control
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

  // Screen capture
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

  // Window resize
  ipcMain.handle('resize-window', (_event, requestedHeight: unknown) => {
    const win = ctx.getWindow();
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

  // History handlers
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
      lastSessionMessages = null;
    } catch (err) {
      logError('clear_history_error', err as Error);
    }
  });

  // Constants
  ipcMain.handle('get-constants', async () => ({
    PILL_BASE_HEIGHT: config.ui.pillBaseHeight,
    APP_VERSION: app.getVersion(),
  }));

  // Config status
  ipcMain.handle('get-config-status', async () => {
    const provider = config.model.provider;
    const needsApiKey = true;
    const hasApiKey = provider === 'claude' 
      ? !!config.claude.apiKey 
      : !!config.gemini.apiKey;
      
    return { provider, needsApiKey, hasApiKey };
  });

  // Get full config
  ipcMain.handle('get-config', async () => {
    return config;
  });

  // Save config
    ipcMain.handle('save-config', async (_, updates: unknown) => {
    try {
      const newConfig = updates as DeepPartial<Config>;
      saveUserConfig(newConfig);
      ctx.initializeModelClient();
      return { success: true };
    } catch (err) {
      logError('save_config_error', err as Error);
      return { success: false, error: String((err as Error).message) };
    }
  });

  // Save API key (Legacy/Specific wrapper - maps to current provider)
  ipcMain.handle('save-api-key', async (_event, apiKey: unknown) => {
    try {
      const key = typeof apiKey === 'string' ? apiKey.trim() : '';
      if (!key) {
        return { success: false, error: 'API key cannot be empty' };
      }

      if (config.model.provider === 'claude') {
        if (!key.startsWith('sk-ant-')) {
          return { success: false, error: 'Invalid key format. Anthropic keys start with sk-ant-' };
        }
        saveUserConfig({ claude: { apiKey: key, model: config.claude.model } });
      } else {
        // Simple check for Gemini key if we want, or loose validation
        saveUserConfig({ gemini: { apiKey: key, model: config.gemini.model } });
      }
      
      ctx.initializeModelClient();
      logEvent('api_key_saved', { provider: config.model.provider });
      return { success: true };
    } catch (err) {
      logError('save_api_key_error', err as Error);
      return { success: false, error: String((err as Error)?.message || 'Failed to save API key') };
    }
  });

  ipcMain.handle('quit-app', () => {
    app.quit();
  });

  ipcMain.handle('respond-to-confirmation', (_event, allowed: unknown) => {
    resolveConfirmation(!!allowed);
  });
}
