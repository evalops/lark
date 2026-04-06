import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test'),
    getVersion: vi.fn().mockReturnValue('0.3.0'),
    quit: vi.fn(),
  },
  screen: {
    getPrimaryDisplay: vi.fn().mockReturnValue({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock('@nut-tree-fork/nut-js', () => ({
  mouse: {
    setPosition: vi.fn(),
  },
  keyboard: {
    type: vi.fn(),
  },
  Point: vi.fn().mockImplementation((x, y) => ({ x, y })),
}));

vi.mock('./screen', () => ({
  captureToFile: vi.fn().mockResolvedValue('/tmp/capture.png'),
}));

vi.mock('./log', () => ({
  logEvent: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('./services/agent', () => ({
  processComputerUse: vi.fn(),
  resolveConfirmation: vi.fn(),
}));

vi.mock('./config', () => ({
  config: {
    ui: {
      maxPromptLength: 5000,
      maxTypeLength: 500,
      maxHistoryEntries: 200,
      pillBaseHeight: 60,
      windowMaxHeight: 320,
    },
    model: { provider: 'claude' },
    claude: { apiKey: 'test-key', model: 'claude-opus-4-5' },
    gemini: { apiKey: '', model: '' },
  },
  getUserEnvPath: vi.fn().mockReturnValue('/tmp/user.env'),
  refreshConfig: vi.fn(),
  saveUserConfig: vi.fn(),
}));

describe('ipcHandlers', () => {
  let handlers: Map<string, Function>;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = new Map();
    
    const { ipcMain } = await import('electron');
    (ipcMain.handle as any).mockImplementation((channel: string, handler: Function) => {
      handlers.set(channel, handler);
    });
  });

  describe('registration', () => {
    it('should register all expected handlers', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn().mockReturnValue(null),
        setAbortController: vi.fn(),
        getModelClient: vi.fn().mockReturnValue(null),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn().mockReturnValue(null),
      };

      registerIpcHandlers(ctx);

      expect(handlers.has('ask-openai')).toBe(true);
      expect(handlers.has('stop-computer-use')).toBe(true);
      expect(handlers.has('control-mouse')).toBe(true);
      expect(handlers.has('control-keyboard')).toBe(true);
      expect(handlers.has('capture-screen')).toBe(true);
      expect(handlers.has('resize-window')).toBe(true);
      expect(handlers.has('get-history')).toBe(true);
      expect(handlers.has('clear-history')).toBe(true);
      expect(handlers.has('get-constants')).toBe(true);
      expect(handlers.has('get-config-status')).toBe(true);
      expect(handlers.has('get-config')).toBe(true);
      expect(handlers.has('save-config')).toBe(true);
      expect(handlers.has('save-api-key')).toBe(true);
      expect(handlers.has('quit-app')).toBe(true);
      expect(handlers.has('respond-to-confirmation')).toBe(true);
    });
  });

  describe('trust validation', () => {
    it('should reject calls from untrusted origins', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn().mockReturnValue(null),
        setAbortController: vi.fn(),
        getModelClient: vi.fn().mockReturnValue(null),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn().mockReturnValue(null),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('get-constants');
      const untrustedEvent = {
        senderFrame: { url: 'http://malicious.com' },
      };

      await expect(handler!(untrustedEvent)).rejects.toThrow('Untrusted renderer origin');
    });

    it('should accept calls from file:// origins', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn().mockReturnValue(null),
        setAbortController: vi.fn(),
        getModelClient: vi.fn().mockReturnValue(null),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn().mockReturnValue(null),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('get-constants');
      const trustedEvent = {
        senderFrame: { url: 'file:///app/index.html' },
      };

      const result = await handler!(trustedEvent);
      
      expect(result).toHaveProperty('PILL_BASE_HEIGHT');
      expect(result).toHaveProperty('APP_VERSION');
    });
  });

  describe('get-constants', () => {
    it('should return PILL_BASE_HEIGHT and APP_VERSION', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn(),
        setAbortController: vi.fn(),
        getModelClient: vi.fn(),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn(),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('get-constants');
      const event = { senderFrame: { url: 'file:///app/index.html' } };

      const result = await handler!(event);

      expect(result.PILL_BASE_HEIGHT).toBe(60);
      expect(result.APP_VERSION).toBe('0.3.0');
    });
  });

  describe('get-config-status', () => {
    it('should return provider and API key status', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn(),
        setAbortController: vi.fn(),
        getModelClient: vi.fn(),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn(),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('get-config-status');
      const event = { senderFrame: { url: 'file:///app/index.html' } };

      const result = await handler!(event);

      expect(result.provider).toBe('claude');
      expect(result.needsApiKey).toBe(true);
      expect(result.hasApiKey).toBe(true);
    });
  });

  describe('stop-computer-use', () => {
    it('should abort current controller', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const mockAbort = vi.fn();
      const mockController = { abort: mockAbort };
      
      const ctx = {
        getAbortController: vi.fn().mockReturnValue(mockController),
        setAbortController: vi.fn(),
        getModelClient: vi.fn(),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn(),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('stop-computer-use');
      const event = { senderFrame: { url: 'file:///app/index.html' } };

      await handler!(event);

      expect(mockAbort).toHaveBeenCalled();
      expect(ctx.setAbortController).toHaveBeenCalledWith(null);
    });

    it('should handle no active controller gracefully', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn().mockReturnValue(null),
        setAbortController: vi.fn(),
        getModelClient: vi.fn(),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn(),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('stop-computer-use');
      const event = { senderFrame: { url: 'file:///app/index.html' } };

      await expect(handler!(event)).resolves.not.toThrow();
    });
  });

  describe('save-api-key', () => {
    it('should reject empty API keys', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn(),
        setAbortController: vi.fn(),
        getModelClient: vi.fn(),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn(),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('save-api-key');
      const event = { senderFrame: { url: 'file:///app/index.html' } };

      const result = await handler!(event, '');

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should validate Anthropic key format', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn(),
        setAbortController: vi.fn(),
        getModelClient: vi.fn(),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn(),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('save-api-key');
      const event = { senderFrame: { url: 'file:///app/index.html' } };

      const result = await handler!(event, 'invalid-key');

      expect(result.success).toBe(false);
      expect(result.error).toContain('sk-ant-');
    });
  });

  describe('respond-to-confirmation', () => {
    it('should call resolveConfirmation with boolean', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      const { resolveConfirmation } = await import('./services/agent');
      
      const ctx = {
        getAbortController: vi.fn(),
        setAbortController: vi.fn(),
        getModelClient: vi.fn(),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn(),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('respond-to-confirmation');
      const event = { senderFrame: { url: 'file:///app/index.html' } };

      handler!(event, true);

      expect(resolveConfirmation).toHaveBeenCalledWith(true);
    });

    it('should reject non-boolean values', async () => {
      const { registerIpcHandlers } = await import('./ipcHandlers');
      
      const ctx = {
        getAbortController: vi.fn(),
        setAbortController: vi.fn(),
        getModelClient: vi.fn(),
        initializeModelClient: vi.fn(),
        getWindow: vi.fn(),
      };

      registerIpcHandlers(ctx);

      const handler = handlers.get('respond-to-confirmation');
      const event = { senderFrame: { url: 'file:///app/index.html' } };

      expect(() => handler!(event, 'yes')).toThrow('must be boolean');
    });
  });
});
