import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

describe('statusManager', () => {
  let statusManager: typeof import('./statusManager');
  let mockSend: ReturnType<typeof vi.fn>;
  let mockIsDestroyed: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockSend = vi.fn();
    mockIsDestroyed = vi.fn().mockReturnValue(false);
    statusManager = await import('./statusManager');
  });

  describe('setMainWindow', () => {
    it('should store the window reference', () => {
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: vi.fn(),
      } as any;

      statusManager.setMainWindow(mockWindow);

      statusManager.sendStatusUpdate('test');
      expect(mockSend).toHaveBeenCalledWith('status-update', 'test');
    });

    it('should enable content protection on the window', () => {
      const mockSetContentProtection = vi.fn();
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: mockSetContentProtection,
      } as any;

      statusManager.setMainWindow(mockWindow);

      expect(mockSetContentProtection).toHaveBeenCalledWith(true);
    });
  });

  describe('sendStatusUpdate', () => {
    it('should send status-update message to window', () => {
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: vi.fn(),
      } as any;

      statusManager.setMainWindow(mockWindow);
      statusManager.sendStatusUpdate('Processing...');

      expect(mockSend).toHaveBeenCalledWith('status-update', 'Processing...');
    });

    it('should not send if window is destroyed', () => {
      mockIsDestroyed.mockReturnValue(true);
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: vi.fn(),
      } as any;

      statusManager.setMainWindow(mockWindow);
      statusManager.sendStatusUpdate('test');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should not throw if no window is set', () => {
      expect(() => statusManager.sendStatusUpdate('test')).not.toThrow();
    });
  });

  describe('sendToolActivity', () => {
    it('should send tool-activity message with step info', () => {
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: vi.fn(),
      } as any;

      statusManager.setMainWindow(mockWindow);
      statusManager.sendToolActivity({ type: 'step', step: 1 });

      expect(mockSend).toHaveBeenCalledWith('tool-activity', { type: 'step', step: 1 });
    });

    it('should send tool_use activity with details', () => {
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: vi.fn(),
      } as any;

      statusManager.setMainWindow(mockWindow);
      statusManager.sendToolActivity({
        type: 'tool_use',
        step: 2,
        toolName: 'computer',
        toolInput: { action: 'click', coordinate: [100, 200] },
      });

      expect(mockSend).toHaveBeenCalledWith('tool-activity', {
        type: 'tool_use',
        step: 2,
        toolName: 'computer',
        toolInput: { action: 'click', coordinate: [100, 200] },
      });
    });

    it('should send finish activity', () => {
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: vi.fn(),
      } as any;

      statusManager.setMainWindow(mockWindow);
      statusManager.sendToolActivity({ type: 'finish' });

      expect(mockSend).toHaveBeenCalledWith('tool-activity', { type: 'finish' });
    });
  });

  describe('sendConfirmationRequest', () => {
    it('should send confirmation-request message', () => {
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: vi.fn(),
      } as any;

      statusManager.setMainWindow(mockWindow);
      statusManager.sendConfirmationRequest('Allow pressing Enter?');

      expect(mockSend).toHaveBeenCalledWith('confirmation-request', 'Allow pressing Enter?');
    });

    it('should not send if window is null', () => {
      expect(() => statusManager.sendConfirmationRequest('test')).not.toThrow();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should not send if window is destroyed', () => {
      mockIsDestroyed.mockReturnValue(true);
      const mockWindow = {
        webContents: { send: mockSend },
        isDestroyed: mockIsDestroyed,
        setContentProtection: vi.fn(),
      } as any;

      statusManager.setMainWindow(mockWindow);
      statusManager.sendConfirmationRequest('test');

      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
