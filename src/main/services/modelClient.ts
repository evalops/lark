import Anthropic from '@anthropic-ai/sdk';

type BetaComputerToolParam = {
  type: 'computer_20241022' | 'computer_20250124' | 'computer_20251124';
  name: 'computer';
  display_width_px: number;
  display_height_px: number;
  cache_control?: { type: 'ephemeral' };
};

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

export class ClaudeModelClient {
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

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 1024,
      system: request.systemPrompt
        ? [{ type: 'text', text: request.systemPrompt, cache_control: { type: 'ephemeral' } }]
        : undefined,
      tools: [computerTool] as unknown as Anthropic.Tool[],
      messages: request.messages,
      betas: [betaFlag],
    } as unknown as Anthropic.MessageStreamParams, { signal: request.signal });

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start':
          currentBlockIndex = (event as { index: number }).index;
          if ((event as { content_block: { type: string; id?: string; name?: string } }).content_block.type === 'tool_use') {
            const contentBlock = (event as { content_block: { id: string; name: string } }).content_block;
            onEvent?.({ type: 'tool_use_start', id: contentBlock.id, name: contentBlock.name });
          }
          break;
        case 'content_block_delta':
          if ((event as { delta: { type: string } }).delta.type === 'text_delta') {
            onEvent?.({ type: 'text_delta', text: (event as { delta: { text: string } }).delta.text });
          } else if ((event as { delta: { type: string } }).delta.type === 'input_json_delta') {
            onEvent?.({
              type: 'tool_use_delta',
              partial_json: (event as { delta: { partial_json: string } }).delta.partial_json,
            });
          }
          break;
        case 'content_block_stop':
          onEvent?.({ type: 'content_block_stop', index: currentBlockIndex });
          break;
        case 'message_delta':
          onEvent?.({
            type: 'message_delta',
            stop_reason: (event as { delta: { stop_reason: string | null } }).delta.stop_reason,
          });
          break;
        case 'message_stop':
          onEvent?.({ type: 'message_stop' });
          break;
      }
    }

    const finalMessage = await stream.finalMessage();

    const usage = finalMessage.usage
      ? {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          cacheCreationTokens: (finalMessage.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens,
          cacheReadTokens: (finalMessage.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens,
        }
      : undefined;

    return {
      content: finalMessage.content,
      stopReason: finalMessage.stop_reason,
      usage,
    };
  }
}
