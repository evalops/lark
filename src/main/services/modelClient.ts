import Anthropic from '@anthropic-ai/sdk';

type BetaComputerToolParam = {
  type: 'computer_20241022' | 'computer_20250124' | 'computer_20251124';
  name: 'computer';
  display_width_px: number;
  display_height_px: number;
  cache_control?: { type: 'ephemeral' };
};

interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: string;
    id?: string;
    name?: string;
  };
}

interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: {
    type: string;
    text?: string;
    partial_json?: string;
  };
}

interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: string | null;
  };
  usage?: {
    output_tokens: number;
  };
}

interface MessageStopEvent {
  type: 'message_stop';
}

type BetaStreamEvent =
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | { type: string };

interface BetaUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface DisplayInfo {
  width: number;
  height: number;
  actualWidth: number;
  actualHeight: number;
  screenshotScale: number;
}

export interface ComputerUseRequest {
  messages: Anthropic.MessageParam[];
  systemPrompt?: string;
  display: DisplayInfo;
  signal?: AbortSignal;
}

export interface ComputerUseResponse {
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
}

export interface StreamEvent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  partial_json?: string;
  index?: number;
  stop_reason?: string | null;
}

export interface IModelClient {
  computerUseStream(
    request: ComputerUseRequest,
    onEvent?: (event: StreamEvent) => void
  ): Promise<ComputerUseResponse>;
}

export class AnthropicClient implements IModelClient {
  private client: Anthropic;
  private model: string;

  constructor(cfg: { apiKey: string; model: string }) {
    this.client = new Anthropic({ apiKey: cfg.apiKey });
    this.model = cfg.model;
  }

  async computerUseStream(
    request: ComputerUseRequest,
    onEvent?: (event: StreamEvent) => void
  ): Promise<ComputerUseResponse> {
    let currentBlockIndex = -1;

    // Determine tool version and beta flag based on model
    let toolType: BetaComputerToolParam['type'] = 'computer_20241022';
    let betaFlag = 'computer-use-2024-10-22';

    if (this.model.includes('opus-4-5')) {
      toolType = 'computer_20251124';
      betaFlag = 'computer-use-2025-11-24';
    } else if (this.model.includes('claude-4') || this.model.includes('sonnet-3-7')) {
      toolType = 'computer_20250124';
      betaFlag = 'computer-use-2025-01-24';
    }

    const computerTool: BetaComputerToolParam = {
      type: toolType,
      name: 'computer',
      display_width_px: request.display.width,
      display_height_px: request.display.height,
      cache_control: { type: 'ephemeral' },
    };

    const stream = this.client.beta.messages.stream({
      model: this.model,
      max_tokens: 1024,
      system: request.systemPrompt
        ? [{ type: 'text', text: request.systemPrompt, cache_control: { type: 'ephemeral' } }]
        : undefined,
      tools: [
        computerTool,
        {
          name: 'ask_user',
          description: 'Ask the user for clarity or additional information if you are stuck or need more details to complete the task.',
          input_schema: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question to ask the user',
              },
            },
            required: ['question'],
          },
        },
      ] as unknown as Anthropic.Tool[],
      messages: request.messages,
      betas: [betaFlag, 'prompt-caching-2024-07-31'],
    } as unknown as Anthropic.Messages.MessageStreamParams, { signal: request.signal });

    for await (const event of stream) {
      const betaEvent = event as BetaStreamEvent;
      
      switch (betaEvent.type) {
        case 'content_block_start': {
          const e = betaEvent as ContentBlockStartEvent;
          currentBlockIndex = e.index;
          if (e.content_block.type === 'tool_use') {
            onEvent?.({ 
              type: 'tool_use_start', 
              id: e.content_block.id, 
              name: e.content_block.name 
            });
          }
          break;
        }
        case 'content_block_delta': {
          const e = betaEvent as ContentBlockDeltaEvent;
          if (e.delta.type === 'text_delta' && e.delta.text) {
            onEvent?.({ type: 'text_delta', text: e.delta.text });
          } else if (e.delta.type === 'input_json_delta' && e.delta.partial_json) {
            onEvent?.({
              type: 'tool_use_delta',
              partial_json: e.delta.partial_json,
            });
          }
          break;
        }
        case 'content_block_stop':
          onEvent?.({ type: 'content_block_stop', index: currentBlockIndex });
          break;
        case 'message_delta': {
          const e = betaEvent as MessageDeltaEvent;
          onEvent?.({
            type: 'message_delta',
            stop_reason: e.delta.stop_reason,
          });
          break;
        }
        case 'message_stop':
          onEvent?.({ type: 'message_stop' });
          break;
      }
    }

    const finalMessage = await stream.finalMessage();
    const betaUsage = finalMessage.usage as BetaUsage | undefined;

    const usage = betaUsage
      ? {
          inputTokens: betaUsage.input_tokens,
          outputTokens: betaUsage.output_tokens,
          cacheCreationTokens: betaUsage.cache_creation_input_tokens,
          cacheReadTokens: betaUsage.cache_read_input_tokens,
        }
      : undefined;

    // Cast content to match the expected interface type, filtering out beta-specific tool blocks if necessary
    return {
      content: finalMessage.content as Anthropic.ContentBlock[],
      stopReason: finalMessage.stop_reason,
      usage,
    };
  }
}

// Re-export specific client as default or named for backward compat if needed, 
// but preferred to use interface in consumers.
export const ClaudeModelClient = AnthropicClient;
