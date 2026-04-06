import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processComputerUse } from './agent';
import { IModelClient, ComputerUseResponse } from './modelClient';
import { config } from '../config';

const hoisted = vi.hoisted(() => ({
  mockCaptureBase64: vi.fn().mockResolvedValue('imgdata'),
  mockExecuteAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
  screen: { getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }) },
  app: { isPackaged: true },
}));
vi.mock('../screen', () => ({ captureBase64: hoisted.mockCaptureBase64 }));
vi.mock('./axClient', () => ({ getFrontmostAppUITree: vi.fn().mockResolvedValue(null) }));
vi.mock('../computerActions', () => ({ executeComputerAction: hoisted.mockExecuteAction }));
vi.mock('../log', () => ({
  logEvent: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('../statusManager', () => ({
  sendStatusUpdate: vi.fn(),
  sendConfirmationRequest: vi.fn(),
  sendToolActivity: vi.fn(),
}));

const { mockCaptureBase64, mockExecuteAction } = hoisted;

class FakeClient implements IModelClient {
  calls = 0;

  async computerUseStream(): Promise<ComputerUseResponse> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'computer',
            input: { action: 'wait', duration: 0.01 },
          },
        ],
        stopReason: 'tool_use',
      } as ComputerUseResponse;
    }

    return {
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'end_turn',
    } as ComputerUseResponse;
  }
}

describe('processComputerUse integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.agent.maxSteps = 5;
    config.agent.minStepDelayMs = 0;
    config.agent.maxRuntimeMs = 60_000;
    config.agent.idleTimeoutMs = 60_000;
    config.agent.maxConsecutiveErrors = 3;
  });

  it('drives tool_use and tool_result loop to completion', async () => {
    const client = new FakeClient();
    const result = await processComputerUse(client, 'test task');

    expect(result.content).toBe('done');
    expect(client.calls).toBe(2);
    expect(mockCaptureBase64).toHaveBeenCalled();
    expect(mockCaptureBase64.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
