import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerCommand, handleSlashCommand, resetRegistry } from './slashCommands';

describe('Slash Commands', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('should register and execute a command', async () => {
    const handler = vi.fn();
    registerCommand('/test', handler, 'Test command');

    const result = await handleSlashCommand('/test arg1 arg2', () => {});
    
    expect(result).toBe(true);
    expect(handler).toHaveBeenCalledWith('arg1 arg2');
  });

  it('should return false for unknown commands', async () => {
    const result = await handleSlashCommand('/unknown', () => {});
    expect(result).toBe(false);
  });

  it('should handle errors in command execution', async () => {
    const error = new Error('Command failed');
    const handler = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    registerCommand('/fail', handler, 'Failing command');

    await handleSlashCommand('/fail', onError);

    expect(onError).toHaveBeenCalledWith(error);
  });

  it('should parse arguments correctly', async () => {
    const handler = vi.fn();
    registerCommand('/args', handler, 'Args command');

    await handleSlashCommand('/args foo bar baz', () => {});
    expect(handler).toHaveBeenCalledWith('foo bar baz');
    
    // Test trimming behavior
    await handleSlashCommand('/args   spaces   ', () => {});
    expect(handler).toHaveBeenCalledWith('spaces');
  });
});

