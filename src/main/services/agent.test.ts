import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

vi.mock('electron', () => ({
  screen: { getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }) },
  app: { isPackaged: true },
}));
vi.mock('./axClient', () => ({ getFrontmostAppUITree: vi.fn().mockResolvedValue(null) }));
vi.mock('../computerActions', () => ({ executeComputerAction: vi.fn() }));
vi.mock('../log', () => ({ logEvent: vi.fn(), logError: vi.fn() }));
vi.mock('../statusManager', () => ({
  sendStatusUpdate: vi.fn(),
  sendConfirmationRequest: vi.fn(),
  sendToolActivity: vi.fn(),
}));
vi.mock('../screen', () => ({ captureBase64: vi.fn().mockResolvedValue('img') }));

import { validateAndRepairMessages } from './agent';

describe('validateAndRepairMessages', () => {
  it('removes orphaned tool_use messages without tool_result follow-up', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'computer', input: {} }],
      },
    ];

    validateAndRepairMessages(messages);
    expect(messages).toHaveLength(0);
  });

  it('removes mismatched tool_use/tool_result pairs', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'computer', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'other', content: 'oops' }],
      },
    ];

    validateAndRepairMessages(messages);
    expect(messages).toHaveLength(0);
  });

  it('keeps correctly paired tool_use and tool_result messages', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'computer', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }],
      },
    ];

    validateAndRepairMessages(messages);
    expect(messages).toHaveLength(2);
  });
});
