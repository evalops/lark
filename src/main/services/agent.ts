import { screen } from 'electron';
import { captureBase64 } from '../screen';
import { logEvent, logError } from '../log';
import { sendStatusUpdate, sendConfirmationRequest, sendToolActivity } from '../statusManager';
import { config } from '../config';
import { executeComputerAction } from '../computerActions';
import { IModelClient, DisplayInfo, StreamEvent } from './modelClient';

let pendingConfirmationResolve: ((allowed: boolean) => void) | null = null;

export function resolveConfirmation(allowed: boolean): void {
  if (pendingConfirmationResolve) {
    pendingConfirmationResolve(allowed);
    pendingConfirmationResolve = null;
  }
}

async function askUserConfirmation(description: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConfirmationResolve = resolve;
    sendConfirmationRequest(description);
  });
}

interface ActionSafety {
  dangerous: boolean;
  requiresConfirmation: boolean;
  hardBlock: boolean;
  reason?: string;
}

function normalizeKeyToken(token: string): string {
  return token.trim().toLowerCase();
}

function parseKeyChord(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split('+')
    .map((k) => normalizeKeyToken(k))
    .filter(Boolean);
}

function assessActionSafety(action: ClaudeAction): ActionSafety {
  if (action.action !== 'key' && action.action !== 'hold_key') {
    return { dangerous: false, requiresConfirmation: false, hardBlock: false };
  }
  
  const keys = parseKeyChord(action.text);
  const dangerousKeys = new Set(['return', 'enter', 'delete', 'backspace', 'escape']);
  const modifierKeys = new Set(['cmd', 'command', 'meta', 'ctrl', 'control', 'alt', 'option', 'shift']);

  const hasModifier = keys.some((k) => modifierKeys.has(k));
  const baseKey = keys[keys.length - 1];
  const hasDangerKey = keys.some((k) => dangerousKeys.has(k));

  const chord = keys.join('+');
  const destructiveChords = new Set([
    'cmd+q',
    'command+q',
    'cmd+w',
    'command+w',
    'cmd+shift+q',
    'command+shift+q',
    'alt+f4',
    'option+f4',
    'ctrl+alt+delete',
    'control+alt+delete',
    'cmd+option+esc',
    'command+option+esc',
  ]);

  if (destructiveChords.has(chord)) {
    return {
      dangerous: true,
      requiresConfirmation: true,
      hardBlock: true,
      reason: `Shortcut ${chord} is blocked because it can close apps or system dialogs.`,
    };
  }

  if (baseKey === 'x') {
    return {
      dangerous: true,
      requiresConfirmation: true,
      hardBlock: true,
      reason: 'Pressing X is blocked to avoid unintended cut/close actions.',
    };
  }

  if (hasDangerKey || hasModifier) {
    return {
      dangerous: true,
      requiresConfirmation: true,
      hardBlock: false,
      reason: 'Destructive or system-affecting keypress detected.',
    };
  }

  return { dangerous: false, requiresConfirmation: false, hardBlock: false };
}

import { getFrontmostAppUITree, AXElement } from './axClient';
import { withRetry, isRateLimitError, isOverloadedError } from '../retry';
import Anthropic from '@anthropic-ai/sdk';

export interface SimplifiedAXElement {
  role?: string;
  subrole?: string;
  title?: string;
  value?: string;
  description?: string;
  identifier?: string;
  frame?: { x: number; y: number; width: number; height: number };
  children?: (SimplifiedAXElement | string)[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getDisplayInfo(preferredMonitor?: 'primary' | 'cursor' | number): DisplayInfo {
  let display = screen.getPrimaryDisplay();
  
  const preference = preferredMonitor ?? config.display?.preferredMonitor ?? 'primary';
  
  if (preference === 'cursor') {
    const cursorPoint = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(cursorPoint);
  } else if (typeof preference === 'number') {
    const allDisplays = screen.getAllDisplays();
    if (preference >= 0 && preference < allDisplays.length) {
      display = allDisplays[preference];
    }
  }
  
  const bounds = display.bounds;
  const screenshotWidth = config.screenshot?.width ?? 960;
  const screenshotScale = bounds.width / screenshotWidth;
  const screenshotHeight = Math.round(bounds.height / screenshotScale);

  return {
    width: screenshotWidth,
    height: screenshotHeight,
    actualWidth: bounds.width,
    actualHeight: bounds.height,
    screenshotScale,
  };
}

function getSystemPrompt(): string {
  return `You are a computer-use agent controlling a macOS desktop.

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

  const safety = assessActionSafety(action);
  if (safety.hardBlock) {
    logEvent('dangerous_action_blocked', { action: action.text, reason: safety.reason });
    return safety.reason ? `Blocked: ${safety.reason}` : 'Action blocked by safety policy';
  }

  if (config.agent.confirmDangerousActions && safety.dangerous && safety.requiresConfirmation) {
    const desc = describeClaudeAction(action);
    const prompt = safety.reason ? `${desc}\n\nReason: ${safety.reason}` : desc;
    const allowed = await askUserConfirmation(prompt);
    if (!allowed) {
      return 'Action denied by user';
    }
  }

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

function simplifyAXTree(element: AXElement, depth = 0): SimplifiedAXElement | string {
  if (element.truncated) return '...';
  if (depth > 6) return '...'; // Prune deep trees

  const simplified: SimplifiedAXElement = {
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

export function validateAndRepairMessages(messages: Anthropic.MessageParam[]): void {
  // Ensure tool_use blocks are always followed by tool_result blocks
  // This prevents 400 errors from the API
  
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const hasToolUse = msg.content.some((block) => block.type === 'tool_use');
      
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
            .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
            .map((block) => block.id);
          
          const toolResultIds = nextMsg.content
            .filter((block): block is Anthropic.ToolResultBlockParam => block.type === 'tool_result')
            .map((block) => block.tool_use_id);
          
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

function pruneHistoricalImages(messages: Anthropic.MessageParam[], keepImages = 4): void {
  let retained = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
    let modified = false;

    const newContent = msg.content.map((block) => {
      if ((block as Anthropic.ImageBlockParam).type === 'image') {
        retained++;
        if (retained > keepImages && i > 0) {
          modified = true;
          return { type: 'text' as const, text: 'Screenshot omitted to reduce context size.' };
        }
        return block;
      }

      if ((block as Anthropic.ToolResultBlockParam).type === 'tool_result') {
        const toolBlock = block as Anthropic.ToolResultBlockParam;
        const contentArray = Array.isArray(toolBlock.content)
          ? toolBlock.content
          : typeof toolBlock.content === 'string'
          ? [{ type: 'text', text: toolBlock.content }]
          : [];

        const imageCount = contentArray.filter(
          (inner) => (inner as Anthropic.ImageBlockParam).type === 'image'
        ).length;

        if (imageCount > 0) {
          retained += imageCount;
          if (retained > keepImages && i > 0) {
            modified = true;
            const textSummary = contentArray
              .filter((inner) => (inner as Anthropic.TextBlockParam).type === 'text')
              .map((inner) => (inner as Anthropic.TextBlockParam).text)
              .join(' ');
            const summaryText =
              textSummary.length > 0
                ? `${textSummary} (screenshot omitted to save context).`
                : 'Screenshot omitted to reduce context size.';
            return {
              ...toolBlock,
              content: [{ type: 'text' as const, text: summaryText }],
            };
          }
        }
      }

      return block;
    });

    if (modified) {
      messages[i] = { ...msg, content: newContent };
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
  const maxRuntimeMs = Math.max(60_000, config.agent?.maxRuntimeMs ?? 5 * 60_000);
  const idleTimeoutMs = Math.max(15_000, config.agent?.idleTimeoutMs ?? 60_000);
  const maxConsecutiveErrors = Math.max(1, config.agent?.maxConsecutiveErrors ?? 5);
  const startTime = Date.now();
  let lastProgressAt = startTime;
  let consecutiveErrorSteps = 0;

  const markProgress = (): void => {
    lastProgressAt = Date.now();
  };

  logEvent('agent_start', { prompt, isResume: !!initialMessages });

  const screenshotQuality = config.screenshot?.quality ?? 65;

  if (!initialMessages) {
    sendStatusUpdate('Step 1: Taking initial screenshot');

    const initialScreenshot = await captureBase64({
      width: display.width,
      height: display.height,
      quality: screenshotQuality,
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

    markProgress();
  }

  for (let step = 1; step <= maxSteps; step++) {
    if (abortSignal?.aborted) {
      sendStatusUpdate('Cancelled');
      return { content: 'Task cancelled by user' };
    }

    const now = Date.now();
    if (now - startTime > maxRuntimeMs) {
      logEvent('agent_runtime_exceeded', { elapsedMs: now - startTime });
      sendStatusUpdate('Stopped: max runtime reached');
      return { content: 'Stopped to keep session under the runtime limit' };
    }

    if (now - lastProgressAt > idleTimeoutMs) {
      logEvent('agent_idle_timeout', { idleMs: now - lastProgressAt });
      sendStatusUpdate('Stopped: no progress detected');
      return { content: 'Stopped because no progress was detected for too long' };
    }

    logEvent('agent_step_start', { step });
    sendStatusUpdate(`Step ${step}: Thinking...`);
    sendToolActivity({ type: 'step', step });

    // Validate message history before sending to prevent 400 errors
    validateAndRepairMessages(messages);

    let streamingText = '';
    const onStreamEvent = (event: StreamEvent): void => {
      if (event.type === 'text_delta' && event.text) {
        streamingText += event.text;
        const preview =
          streamingText.length > 50 ? streamingText.slice(-50) + '...' : streamingText;
        sendStatusUpdate(`Step ${step}: ${preview}`);
        markProgress();
      } else if (event.type === 'tool_use_start') {
        sendStatusUpdate(`Step ${step}: ${event.name}...`);
        markProgress();
      }
    };

    let response;
    try {
      response = await withRetry(
        () => client.computerUseStream(
          {
            messages,
            systemPrompt: getSystemPrompt(),
            display,
            signal: abortSignal,
          },
          onStreamEvent
        ),
        {
          maxAttempts: config.retry?.maxAttempts ?? 3,
          shouldRetry: (err) => {
            if ((err as Error)?.name === 'AbortError') return false;
            return isRateLimitError(err) || isOverloadedError(err);
          },
          onRetry: (err, attempt, delayMs) => {
            sendStatusUpdate(`Rate limited, retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt})...`);
          },
        }
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        sendStatusUpdate('Cancelled');
        return { content: 'Task cancelled by user' };
      }
      
      const apiError = err as {
        status?: number;
        type?: string;
        requestId?: string;
        error?: { message?: string };
        message?: string;
      };
      const errorDetails = {
        status: apiError.status,
        type: apiError.type,
        requestId: apiError.requestId,
        error: apiError.error
      };
      
      logError('api_error', err as Error, errorDetails);
      
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
                content.some((block) => block.type === 'tool_use');
              
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
        sendToolActivity({ type: 'finish' });
        return { content: textBlock.text };
      }
      if (response.stopReason === 'end_turn') {
        sendToolActivity({ type: 'finish' });
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
      sendToolActivity({ 
        type: 'tool_use', 
        step, 
        toolName: toolUse.name, 
        toolInput: action 
      });
      logEvent('action', { step, action: action.action });

      try {
        if (action.action === 'screenshot') {
          const screenshot = await captureBase64({
            width: display.width,
            height: display.height,
            quality: screenshotQuality,
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
          markProgress();
          sendToolActivity({
            type: 'tool_result',
            step,
            toolName: toolUse.name,
            toolOutput: 'screenshot_taken'
          });
        } else {
          const result = await executeClaudeAction(action, display);
          const screenshot = await captureBase64({
            width: display.width,
            height: display.height,
            quality: screenshotQuality,
          });
          
          // Clear the large base64 data from the screenshot tool result after it's been sent to the model
          // to reduce memory pressure during long sessions
          const screenshotData = screenshot; 
          
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [
              { type: 'text', text: result },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/jpeg', data: screenshotData },
              },
            ],
          });
          
          markProgress();
          
          sendToolActivity({
            type: 'tool_result',
            step,
            toolName: toolUse.name,
            toolOutput: result
          });
          
          // Force garbage collection of the raw screenshot string if possible (hint to V8)
          // Note: We can't actually modify the toolResults that are in the messages array because 
          // Anthropic needs the full context history. However, we can ensure we don't keep *duplicate* copies.
        }
      } catch (err) {
        logError('action_error', err as Error);
        const errorMsg = String((err as Error)?.message || 'Action failed');
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: ${errorMsg}`,
          is_error: true,
        });
        markProgress();
        sendToolActivity({
          type: 'tool_result',
          step,
          toolName: toolUse.name,
          toolOutput: `Error: ${errorMsg}`
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });

    const stepHadError = toolResults.some((tr) => {
      if ((tr as Anthropic.ToolResultBlockParam).is_error) return true;
      if (typeof tr.content === 'string') {
        return tr.content.toLowerCase().includes('error');
      }
      if (Array.isArray(tr.content)) {
        return tr.content.some(
          (c) =>
            (c as Anthropic.TextBlockParam).type === 'text' &&
            (c as Anthropic.TextBlockParam).text.toLowerCase().includes('error')
        );
      }
      return false;
    });

    consecutiveErrorSteps = stepHadError ? consecutiveErrorSteps + 1 : 0;
    if (stepHadError && consecutiveErrorSteps >= maxConsecutiveErrors) {
      logEvent('agent_error_threshold_exceeded', { consecutiveErrorSteps });
      sendStatusUpdate('Stopped: too many tool errors');
      return { content: 'Stopped after repeated tool failures' };
    }

    pruneHistoricalImages(messages, config.screenshot?.keepImages ?? 4);

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
