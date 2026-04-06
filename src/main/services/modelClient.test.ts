import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComputerUseRequest, ComputerUseResponse, DisplayInfo, StreamEvent } from './modelClient';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    beta: {
      messages: {
        stream: vi.fn().mockImplementation(() => {
          const events = [
            { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
            { type: 'content_block_stop' },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
            { type: 'message_stop' },
          ];
          let idx = 0;
          return {
            [Symbol.asyncIterator]: () => ({
              async next() {
                if (idx < events.length) {
                  return { value: events[idx++], done: false };
                }
                return { value: undefined, done: true };
              },
            }),
            finalMessage: vi.fn().mockResolvedValue({
              content: [{ type: 'text', text: 'Hello world' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
          };
        }),
      },
    },
  })),
}));

describe('modelClient', () => {
  const mockDisplay: DisplayInfo = {
    width: 960,
    height: 540,
    actualWidth: 1920,
    actualHeight: 1080,
    screenshotScale: 2,
  };

  describe('ComputerUseRequest', () => {
    it('should have required fields', () => {
      const request: ComputerUseRequest = {
        messages: [{ role: 'user', content: 'test' }],
        display: mockDisplay,
      };
      
      expect(request.messages).toHaveLength(1);
      expect(request.display).toBe(mockDisplay);
      expect(request.systemPrompt).toBeUndefined();
    });

    it('should accept optional systemPrompt', () => {
      const request: ComputerUseRequest = {
        messages: [{ role: 'user', content: 'test' }],
        systemPrompt: 'You are a helpful assistant',
        display: mockDisplay,
      };
      
      expect(request.systemPrompt).toBe('You are a helpful assistant');
    });

    it('should accept optional signal for abort', () => {
      const controller = new AbortController();
      const request: ComputerUseRequest = {
        messages: [{ role: 'user', content: 'test' }],
        display: mockDisplay,
        signal: controller.signal,
      };
      
      expect(request.signal).toBe(controller.signal);
    });
  });

  describe('ComputerUseResponse', () => {
    it('should have content and stopReason', () => {
      const response: ComputerUseResponse = {
        content: [{ type: 'text', text: 'done' }] as any,
        stopReason: 'end_turn',
      };
      
      expect(response.content).toHaveLength(1);
      expect(response.stopReason).toBe('end_turn');
    });

    it('should include optional usage data', () => {
      const response: ComputerUseResponse = {
        content: [{ type: 'text', text: 'done' }] as any,
        stopReason: 'end_turn',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 10,
          cacheReadTokens: 5,
        },
      };
      
      expect(response.usage?.inputTokens).toBe(100);
      expect(response.usage?.outputTokens).toBe(50);
    });
  });

  describe('StreamEvent', () => {
    it('should represent text delta events', () => {
      const event: StreamEvent = {
        type: 'text_delta',
        text: 'Hello',
      };
      
      expect(event.type).toBe('text_delta');
      expect(event.text).toBe('Hello');
    });

    it('should represent tool use start events', () => {
      const event: StreamEvent = {
        type: 'tool_use_start',
        id: 'tool-1',
        name: 'computer',
      };
      
      expect(event.type).toBe('tool_use_start');
      expect(event.id).toBe('tool-1');
      expect(event.name).toBe('computer');
    });

    it('should represent tool use delta events', () => {
      const event: StreamEvent = {
        type: 'tool_use_delta',
        partial_json: '{"action":',
      };
      
      expect(event.type).toBe('tool_use_delta');
      expect(event.partial_json).toBe('{"action":');
    });

    it('should represent message stop events', () => {
      const event: StreamEvent = {
        type: 'message_stop',
      };
      
      expect(event.type).toBe('message_stop');
    });
  });

  describe('DisplayInfo', () => {
    it('should contain all required display information', () => {
      const display: DisplayInfo = {
        width: 960,
        height: 540,
        actualWidth: 1920,
        actualHeight: 1080,
        screenshotScale: 2,
      };
      
      expect(display.width).toBe(960);
      expect(display.height).toBe(540);
      expect(display.actualWidth).toBe(1920);
      expect(display.actualHeight).toBe(1080);
      expect(display.screenshotScale).toBe(2);
    });

    it('should correctly calculate screenshot scale', () => {
      const display: DisplayInfo = {
        width: 1280,
        height: 720,
        actualWidth: 2560,
        actualHeight: 1440,
        screenshotScale: 2560 / 1280,
      };
      
      expect(display.screenshotScale).toBe(2);
    });
  });
});
