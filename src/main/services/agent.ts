import { screen } from 'electron';
import { captureBase64 } from '../screen';
import { logEvent, logError } from '../log';
import { sendStatusUpdate } from '../statusManager';
import { config } from '../config';
import { executeComputerAction } from '../computerActions';
import { IModelClient, DisplayInfo, StreamEvent } from './modelClient';
import { getFrontmostAppUITree, AXElement } from './axClient';
import Anthropic from '@anthropic-ai/sdk';

const SCREENSHOT_WIDTH = 1280;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getDisplayInfo(): DisplayInfo {
  const primary = screen.getPrimaryDisplay();
  const bounds = primary.bounds;
  const screenshotScale = bounds.width / SCREENSHOT_WIDTH;
  const screenshotHeight = Math.round(bounds.height / screenshotScale);

  return {
    width: SCREENSHOT_WIDTH,
    height: screenshotHeight,
    actualWidth: bounds.width,
    actualHeight: bounds.height,
    screenshotScale,
  };
}

function claudeSystemPrompt(): string {
  return `You are Claude, a computer-use agent controlling a macOS desktop.

<tool_usage>
Use the computer tool to interact with the screen. Always observe the current state via screenshot before acting.
Issue one action per turn for reliable state tracking between actions.
</tool_usage>

<interaction_guidance>
Prefer keyboard shortcuts for OS actions—they are more reliable than clicking:
- Command+Space: Spotlight search
- Command+L: Browser URL bar
- Command+Tab: Switch apps
- Command+W: Close window/tab

When clicking UI elements, aim for the visual center—edge detection is less reliable and causes misclicks.
If an action fails: (1) adjust coordinates slightly, (2) try keyboard shortcuts instead.
</interaction_guidance>

<persistence>
Do not terminate prematurely. Keep acting or waiting until success or failure is unambiguous.
If the UI is loading or animating, use the wait action rather than ending early.
Track your progress: what you have done, what remains, and whether you are making forward progress.
</persistence>

When the task is complete, respond with a brief summary of what you accomplished.`;
}

function scaleCoord(coord: [number, number], scale: number): { x: number; y: number } {
  return {
    x: Math.round(coord[0] * scale),
    y: Math.round(coord[1] * scale),
  };
}

interface ClaudeAction {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  scroll_direction?: 'up' | 'down' | 'left' | 'right';
  scroll_amount?: number;
  duration?: number;
}

async function executeClaudeAction(
  action: ClaudeAction,
  display: DisplayInfo
): Promise<string> {
  const scale = display.screenshotScale;

  switch (action.action) {
    case 'screenshot':
      return 'screenshot_taken';

    case 'left_click': {
      if (!action.coordinate) throw new Error('coordinate required');
      const { x, y } = scaleCoord(action.coordinate, scale);
      await executeComputerAction({ type: 'click', x, y, button: 'left' });
      return 'ok';
    }

    case 'right_click': {
      if (!action.coordinate) throw new Error('coordinate required');
      const { x, y } = scaleCoord(action.coordinate, scale);
      await executeComputerAction({ type: 'click', x, y, button: 'right' });
      return 'ok';
    }

    case 'middle_click': {
      if (!action.coordinate) throw new Error('coordinate required');
      const { x, y } = scaleCoord(action.coordinate, scale);
      await executeComputerAction({ type: 'click', x, y, button: 'middle' });
      return 'ok';
    }

    case 'double_click': {
      if (!action.coordinate) throw new Error('coordinate required');
      const { x, y } = scaleCoord(action.coordinate, scale);
      await executeComputerAction({ type: 'double_click', x, y });
      return 'ok';
    }

    case 'triple_click': {
      if (!action.coordinate) throw new Error('coordinate required');
      const { x, y } = scaleCoord(action.coordinate, scale);
      for (let i = 0; i < 3; i++) {
        await executeComputerAction({ type: 'click', x, y, button: 'left' });
        await sleep(50);
      }
      return 'ok';
    }

    case 'mouse_move': {
      if (!action.coordinate) throw new Error('coordinate required');
      const { x, y } = scaleCoord(action.coordinate, scale);
      await executeComputerAction({ type: 'move', x, y });
      return 'ok';
    }

    case 'left_click_drag': {
      if (!action.start_coordinate || !action.coordinate) throw new Error('start_coordinate and coordinate required');
      const start = scaleCoord(action.start_coordinate, scale);
      const end = scaleCoord(action.coordinate, scale);
      await executeComputerAction({
        type: 'drag',
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
      });
      return 'ok';
    }

    case 'type': {
      if (!action.text) throw new Error('text required');
      await executeComputerAction({ type: 'type', text: action.text });
      return 'ok';
    }

    case 'key': {
      if (!action.text) throw new Error('text required');
      const keys = action.text.split('+').map((k) => k.trim());
      await executeComputerAction({ type: 'keypress', keys });
      return 'ok';
    }

    case 'scroll': {
      if (!action.coordinate) throw new Error('coordinate required');
      const { x, y } = scaleCoord(action.coordinate, scale);
      const scrollAmount = (action.scroll_amount ?? 3) * 100;
      let scrollX = 0;
      let scrollY = 0;
      switch (action.scroll_direction) {
        case 'up':
          scrollY = -scrollAmount;
          break;
        case 'down':
          scrollY = scrollAmount;
          break;
        case 'left':
          scrollX = -scrollAmount;
          break;
        case 'right':
          scrollX = scrollAmount;
          break;
      }
      await executeComputerAction({ type: 'scroll', x, y, scrollX, scrollY });
      return 'ok';
    }

    case 'wait': {
      const duration = Math.max(0, Math.min((action.duration ?? 1) * 1000, 10000));
      await sleep(duration);
      return 'ok';
    }

    case 'hold_key': {
      if (!action.text) throw new Error('text required');
      const keys = action.text.split('+').map((k) => k.trim());
      await executeComputerAction({ type: 'keypress', keys });
      return 'ok';
    }

    default:
      logError('claude_unknown_action', new Error(`Unknown Claude action: ${action.action}`));
      return 'error: unknown action';
  }
}

function describeClaudeAction(action: ClaudeAction): string {
  switch (action.action) {
    case 'screenshot':
      return 'Taking screenshot';
    case 'left_click':
      if (!action.coordinate) return 'Click at (unknown)';
      return `Click at (${action.coordinate[0]}, ${action.coordinate[1]})`;
    case 'right_click':
      if (!action.coordinate) return 'Right-click at (unknown)';
      return `Right-click at (${action.coordinate[0]}, ${action.coordinate[1]})`;
    case 'double_click':
      if (!action.coordinate) return 'Double-click at (unknown)';
      return `Double-click at (${action.coordinate[0]}, ${action.coordinate[1]})`;
    case 'triple_click':
      if (!action.coordinate) return 'Triple-click at (unknown)';
      return `Triple-click at (${action.coordinate[0]}, ${action.coordinate[1]})`;
    case 'middle_click':
      if (!action.coordinate) return 'Middle-click at (unknown)';
      return `Middle-click at (${action.coordinate[0]}, ${action.coordinate[1]})`;
    case 'mouse_move':
      if (!action.coordinate) return 'Move mouse to (unknown)';
      return `Move mouse to (${action.coordinate[0]}, ${action.coordinate[1]})`;
    case 'left_click_drag':
      if (!action.start_coordinate || !action.coordinate) return 'Drag (unknown)';
      return `Drag from (${action.start_coordinate[0]}, ${action.start_coordinate[1]}) to (${action.coordinate[0]}, ${action.coordinate[1]})`;
    case 'type': {
      if (!action.text) return 'Type (empty)';
      const text = action.text.length > 30 ? action.text.slice(0, 30) + '...' : action.text;
      return `Type "${text}"`;
    }
    case 'key':
      return `Press ${action.text ?? 'unknown key'}`;
    case 'scroll':
      return `Scroll ${action.scroll_direction ?? 'unknown'} by ${action.scroll_amount ?? 0}`;
    case 'wait':
      return 'Waiting';
    case 'hold_key':
      return `Hold ${action.text ?? 'unknown key'}`;
    default:
      return 'Execute action';
  }
}

function simplifyAXTree(element: AXElement, depth = 0): any {
  if (element.truncated) return '...';
  if (depth > 6) return '...'; // Prune deep trees

  const simplified: any = {
    role: element.role,
  };

  if (element.subrole) {
    simplified.subrole = element.subrole;
  }

  if (element.title) {
    simplified.title = element.title;
  }

  if (element.value) {
    simplified.value = element.value;
  }
  
  if (element.description) {
    simplified.description = element.description;
  }

  if (element.identifier) {
    simplified.identifier = element.identifier;
  }

  if (element.frame) {
    simplified.frame = element.frame;
  }

  // Filter children to remove non-interactive layout containers unless they have relevant content
  if (element.children && element.children.length > 0) {
    const children = element.children
      .map((child) => simplifyAXTree(child, depth + 1))
      .filter(child => child !== '...');
      
    if (children.length > 0) {
      simplified.children = children;
    }
  }

  return simplified;
}

function validateAndRepairMessages(messages: Anthropic.MessageParam[]): void {
  // Ensure tool_use blocks are always followed by tool_result blocks
  // This prevents 400 errors from the API
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some((block: any) => block.type === 'tool_use');
      
      if (hasToolUse) {
        // Check if the next message is a user message with tool_result
        const nextMsg = messages[i + 1];
        
        if (!nextMsg || nextMsg.role !== 'user') {
          // Missing tool_result - remove this assistant message
          messages.splice(i, 1);
          logEvent('claude_removed_orphan_tool_use', { index: i });
          continue;
        }
        
        // Check if the user message has matching tool_results
        if (Array.isArray(nextMsg.content)) {
          const toolUseIds = msg.content
            .filter((block: any) => block.type === 'tool_use')
            .map((block: any) => block.id);
          
          const toolResultIds = nextMsg.content
            .filter((block: any) => block.type === 'tool_result')
            .map((block: any) => block.tool_use_id);
          
          const missingResults = toolUseIds.filter((id: string) => !toolResultIds.includes(id));
          
          if (missingResults.length > 0) {
            // Some tool_use blocks don't have matching tool_results
            // Remove both messages to reset to a clean state
            messages.splice(i, 2);
            logEvent('claude_removed_mismatched_tool_pair', { index: i, missingResults });
          }
        }
      }
    }
  }
}

export interface ProcessResult {
  content: string;
  shouldResume?: boolean;
  messages?: Anthropic.MessageParam[];
}

export async function processComputerUse(
  client: IModelClient,
  prompt: string,
  abortSignal?: AbortSignal,
  initialMessages?: Anthropic.MessageParam[]
): Promise<ProcessResult> {
  const display = getDisplayInfo();
  const messages: Anthropic.MessageParam[] = initialMessages ? [...initialMessages] : [];
  const maxSteps = config.agent?.maxSteps ?? 20;
  const minStepDelay = Math.max(0, config.agent?.minStepDelayMs ?? 0);

  logEvent('agent_start', { prompt, isResume: !!initialMessages });

  if (!initialMessages) {
    sendStatusUpdate('Step 1: Taking initial screenshot');

    const initialScreenshot = await captureBase64({
      width: display.width,
      height: display.height,
    });

    const uiTree = await getFrontmostAppUITree();
    const uiContext = uiTree
      ? `\n\nActive Window UI Structure:\n${JSON.stringify(simplifyAXTree(uiTree), null, 2)}`
      : '';

    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Task: ${prompt}${uiContext}\n\nHere is the current screen. Use the computer tool to complete this task.`,
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: initialScreenshot },
        },
      ],
    });
  }

  for (let step = 1; step <= maxSteps; step++) {
    if (abortSignal?.aborted) {
      sendStatusUpdate('Cancelled');
      return { content: 'Task cancelled by user' };
    }

    logEvent('agent_step_start', { step });
    sendStatusUpdate(`Step ${step}: Thinking...`);

    // Validate message history before sending to prevent 400 errors
    validateAndRepairMessages(messages);

    let streamingText = '';
    const onStreamEvent = (event: StreamEvent): void => {
      if (event.type === 'text_delta' && event.text) {
        streamingText += event.text;
        const preview =
          streamingText.length > 50 ? streamingText.slice(-50) + '...' : streamingText;
        sendStatusUpdate(`Step ${step}: ${preview}`);
      } else if (event.type === 'tool_use_start') {
        sendStatusUpdate(`Step ${step}: ${event.name}...`);
      }
    };

    let response;
    try {
      response = await client.computerUseStream(
        {
          messages,
          systemPrompt: claudeSystemPrompt(), // TODO: Make this provider-agnostic if needed
          display,
          signal: abortSignal,
        },
        onStreamEvent
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        sendStatusUpdate('Cancelled');
        return { content: 'Task cancelled by user' };
      }
      
      const apiError = err as any;
      const errorDetails = {
        status: apiError.status,
        type: apiError.type,
        requestId: apiError.requestId,
        error: apiError.error
      };
      
      logError('api_error', err as Error, errorDetails);
      console.error('Full API Error:', JSON.stringify(apiError, null, 2));
      
      // Handle 400 errors - often caused by tool_use/tool_result mismatch
      if (apiError.status === 400) {
        const errorMessage = apiError.error?.message || apiError.message || '';
        
        // Check if the error is related to tool_use/tool_result pairing
        if (errorMessage.includes('tool_use') || errorMessage.includes('tool_result')) {
          logError('tool_pairing_error', new Error('Tool use/result pairing issue detected'));
          
          // Prune corrupted messages: remove the last assistant message if it has unpaired tool_use
          if (messages.length >= 2) {
            const lastMessage = messages[messages.length - 1];
            const secondLastMessage = messages[messages.length - 2];
            
            // If last message is assistant with tool_use, remove it (no matching tool_result followed)
            if (secondLastMessage?.role === 'assistant') {
              const content = secondLastMessage.content;
              const hasToolUse = Array.isArray(content) && 
                content.some((block: any) => block.type === 'tool_use');
              
              if (hasToolUse && lastMessage?.role !== 'user') {
                messages.pop();
                logEvent('pruned_unpaired_tool_use', { messagesRemaining: messages.length });
              }
            }
          }
        }
      }
      
      sendStatusUpdate(`API Error: ${String((err as Error)?.message || 'Unknown error')}`);
      await sleep(2000);
      continue;
    }

    logEvent('response_received', {
      step,
      stopReason: response.stopReason,
      tokens: response.usage
        ? {
            input: response.usage.inputTokens,
            output: response.usage.outputTokens,
            cacheCreation: response.usage.cacheCreationTokens,
            cacheRead: response.usage.cacheReadTokens,
            
          }
        : undefined,
    });

    const sanitizedContent = response.content.map((block) => {
      if (block.type === 'text') {
        return { type: 'text' as const, text: block.text };
      }
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      }
      return block;
    });

    messages.push({ role: 'assistant', content: sanitizedContent });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      if (textBlock?.text) {
        logEvent('task_complete', { step });
        sendStatusUpdate('Task complete');
        return { content: textBlock.text };
      }
      if (response.stopReason === 'end_turn') {
        return { content: 'Task completed' };
      }
      continue;
    }

    // Check for ask_user tool
    const askUserTool = toolUseBlocks.find(t => t.name === 'ask_user');
    if (askUserTool) {
      const input = askUserTool.input as { question: string };
      const question = input.question || 'I need your input to continue.';
      sendStatusUpdate(`Asking user: ${question}`);
      return {
        content: question,
        shouldResume: true,
        messages: messages
      };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const action = toolUse.input as ClaudeAction;
      const actionDesc = describeClaudeAction(action);
      sendStatusUpdate(`Step ${step}: ${actionDesc}`);
      logEvent('action', { step, action: action.action });

      try {
        if (action.action === 'screenshot') {
          const screenshot = await captureBase64({
            width: display.width,
            height: display.height,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: screenshot },
              },
            ],
          });
        } else {
          const result = await executeClaudeAction(action, display);
          const screenshot = await captureBase64({
            width: display.width,
            height: display.height,
          });
          
          // Clear the large base64 data from the screenshot tool result after it's been sent to the model
          // to reduce memory pressure during long sessions
          const screenshotData = screenshot; 
          
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              { type: 'text', text: result + uiContext },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: screenshotData },
              },
            ],
          });
          
          // Force garbage collection of the raw screenshot string if possible (hint to V8)
          // Note: We can't actually modify the toolResults that are in the messages array because 
          // Anthropic needs the full context history. However, we can ensure we don't keep *duplicate* copies.
        }
      } catch (err) {
        logError('action_error', err as Error);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: ${String((err as Error)?.message || 'Action failed')}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });

    if (minStepDelay > 0) {
      await sleep(minStepDelay);
    }
  }

  logEvent('max_steps_reached', { maxSteps });
  sendStatusUpdate('Max steps reached');
  return { content: 'Max steps reached without completing the task' };
}

// Re-export old name for compatibility if needed, but we should update callers
export const processComputerUseClaude = processComputerUse;
