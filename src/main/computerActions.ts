import { mouse, keyboard, Key, Button, Point, straightTo } from '@nut-tree-fork/nut-js';
import { logEvent, logError } from './log';
import { showClickIndicator, showTrail } from './cursorIndicator';

// Configure nut.js defaults
keyboard.config.autoDelayMs = 10;
mouse.config.autoDelayMs = 10;
mouse.config.mouseSpeed = 2000; // Adjust speed for human-like movement


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const modifierMap: Record<string, Key> = {
  command: Key.LeftCmd,
  cmd: Key.LeftCmd,
  meta: Key.LeftCmd,
  super: Key.LeftCmd,
  control: Key.LeftControl,
  ctrl: Key.LeftControl,
  option: Key.LeftAlt,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
};

const keyMap: Record<string, Key> = {
  a: Key.A, b: Key.B, c: Key.C, d: Key.D, e: Key.E, f: Key.F, g: Key.G, h: Key.H,
  i: Key.I, j: Key.J, k: Key.K, l: Key.L, m: Key.M, n: Key.N, o: Key.O, p: Key.P,
  q: Key.Q, r: Key.R, s: Key.S, t: Key.T, u: Key.U, v: Key.V, w: Key.W, x: Key.X,
  y: Key.Y, z: Key.Z,
  '0': Key.Num0, '1': Key.Num1, '2': Key.Num2, '3': Key.Num3, '4': Key.Num4,
  '5': Key.Num5, '6': Key.Num6, '7': Key.Num7, '8': Key.Num8, '9': Key.Num9,
  enter: Key.Return, return: Key.Return, space: Key.Space, tab: Key.Tab,
  escape: Key.Escape, esc: Key.Escape, backspace: Key.Backspace, delete: Key.Delete,
  up: Key.Up, arrowup: Key.Up, down: Key.Down, arrowdown: Key.Down,
  left: Key.Left, arrowleft: Key.Left, right: Key.Right, arrowright: Key.Right,
};

const arrowKeys = new Set([Key.Up, Key.Down, Key.Left, Key.Right]);

const normalizeLookup = (token: string): string =>
  token.trim().toLowerCase().replace(/[\s-_]+/g, '');

const toModifier = (token: string): Key | null =>
  modifierMap[normalizeLookup(token)] ?? null;

const toKey = (token: string): Key | null => keyMap[normalizeLookup(token)] ?? null;

async function pressAndReleaseKey(target: string, modifiers: Key[] = []): Promise<void> {
  const mappedKey = toKey(target);
  if (mappedKey) {
    await keyboard.pressKey(...modifiers, mappedKey);
    if (arrowKeys.has(mappedKey) && modifiers.length === 0) {
      await sleep(100);
      await keyboard.releaseKey(...modifiers, mappedKey);
      await sleep(50);
    } else {
      await keyboard.releaseKey(...modifiers, mappedKey);
    }
    return;
  }

  if (modifiers.length > 0) {
    await keyboard.pressKey(...modifiers);
    await keyboard.type(target);
    await keyboard.releaseKey(...modifiers);
    return;
  }

  const upper = target.toUpperCase();
  if (upper === 'ENTER') {
    await keyboard.pressKey(Key.Return);
    await keyboard.releaseKey(Key.Return);
  } else if (upper === 'SPACE') {
    await keyboard.pressKey(Key.Space);
    await keyboard.releaseKey(Key.Space);
  } else if (upper === 'TAB') {
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
  } else if (upper === 'ESCAPE' || upper === 'ESC') {
    await keyboard.pressKey(Key.Escape);
    await keyboard.releaseKey(Key.Escape);
  } else if (upper === 'BACKSPACE') {
    await keyboard.pressKey(Key.Backspace);
    await keyboard.releaseKey(Key.Backspace);
  } else if (upper === 'DELETE') {
    await keyboard.pressKey(Key.Delete);
    await keyboard.releaseKey(Key.Delete);
  } else if (upper.startsWith('ARROW') || ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(upper)) {
    const dir = upper.replace(/ARROW_?/, '');
    const arrows: Record<string, Key> = {
      UP: Key.Up, DOWN: Key.Down, LEFT: Key.Left, RIGHT: Key.Right,
    };
    const arrowKey = arrows[dir];
    if (arrowKey) {
      await keyboard.pressKey(arrowKey);
      await sleep(500);
      await keyboard.releaseKey(arrowKey);
      await sleep(50);
      return;
    }
  } else {
    await keyboard.type(target);
  }
}

async function handleChordExpression(token: string): Promise<void> {
  const parts = token.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return;
  const main = parts.pop()!;
  const modifiers = parts
    .map((part) => toModifier(part))
    .filter((key): key is Key => Boolean(key));
  await pressAndReleaseKey(main, modifiers);
}

export interface ComputerAction {
  type: string;
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  scrollX?: number;
  scrollY?: number;
  text?: string;
  keys?: string[];
  ms?: number;
}

export async function executeComputerAction(action: ComputerAction): Promise<void> {
  const actionType = action.type;
  try {
    // For visual feedback
    const currentPos = await mouse.getPosition();

    switch (actionType) {
      case 'click': {
        const { x, y, button = 'left' } = action;
        logEvent('action_click', { x, y, button });
        showTrail(currentPos.x, currentPos.y, x!, y!);
        await mouse.move(straightTo(new Point(x!, y!)));
        showClickIndicator(x!, y!);
        await sleep(60);
        await mouse.click(
          button === 'left' ? Button.LEFT : button === 'right' ? Button.RIGHT : Button.MIDDLE
        );
        break;
      }
      case 'double_click': {
        const { x, y } = action;
        logEvent('action_double_click', { x, y });
        showTrail(currentPos.x, currentPos.y, x!, y!);
        await mouse.move(straightTo(new Point(x!, y!)));
        showClickIndicator(x!, y!);
        await sleep(60);
        await mouse.doubleClick(Button.LEFT);
        break;
      }
      case 'right_click': {
        const { x, y } = action;
        logEvent('action_right_click', { x, y });
        showTrail(currentPos.x, currentPos.y, x!, y!);
        await mouse.move(straightTo(new Point(x!, y!)));
        showClickIndicator(x!, y!);
        await sleep(60);
        await mouse.click(Button.RIGHT);
        break;
      }
      case 'move': {
        const { x, y } = action;
        logEvent('action_move', { x, y });
        showTrail(currentPos.x, currentPos.y, x!, y!);
        await mouse.move(straightTo(new Point(x!, y!)));
        break;
      }
      case 'scroll': {
        const { x, y, scrollX = 0, scrollY = 0 } = action;
        logEvent('action_scroll', { x, y, scrollX, scrollY });
        showTrail(currentPos.x, currentPos.y, x!, y!);
        await mouse.setPosition(new Point(x!, y!));
        if (scrollY > 0) await mouse.scrollDown(scrollY);
        else if (scrollY < 0) await mouse.scrollUp(Math.abs(scrollY));
        if (scrollX > 0) await mouse.scrollRight(scrollX);
        else if (scrollX < 0) await mouse.scrollLeft(Math.abs(scrollX));
        break;
      }
      case 'type': {
        const { text } = action;
        logEvent('action_type', { length: (text ?? '').length });
        if (text) await keyboard.type(text);
        break;
      }
      case 'keypress': {
        const { keys } = action;
        logEvent('action_keypress', { keys });
        const sequence = (keys ?? []).map((key) => String(key)).filter((key) => key.length > 0);
        for (let i = 0; i < sequence.length; i++) {
          const token = sequence[i];
          if (token.includes('+')) {
            await handleChordExpression(token);
            continue;
          }
          const collectedModifiers: Key[] = [];
          const lookahead = toModifier(token);
          let consumed = false;
          if (lookahead) {
            collectedModifiers.push(lookahead);
            consumed = true;
            while (i + 1 < sequence.length) {
              const nextMod = toModifier(sequence[i + 1]);
              if (!nextMod) break;
              collectedModifiers.push(nextMod);
              i++;
            }
          }
          if (collectedModifiers.length > 0) {
            const nextKey = consumed ? sequence[++i] : sequence[i];
            if (nextKey !== undefined) {
              await pressAndReleaseKey(nextKey, collectedModifiers);
              continue;
            }
            for (const modKey of collectedModifiers) {
              await keyboard.pressKey(modKey);
              await keyboard.releaseKey(modKey);
            }
            continue;
          }
          await pressAndReleaseKey(token);
        }
        break;
      }
      case 'drag': {
        const { startX, startY, endX, endY } = action;
        logEvent('action_drag', { startX, startY, endX, endY });
        
        // Move to start position
        showTrail(currentPos.x, currentPos.y, startX!, startY!);
        await mouse.move(straightTo(new Point(startX!, startY!)));
        await sleep(200);

        // Perform drag
        showTrail(startX!, startY!, endX!, endY!);
        await mouse.drag(straightTo(new Point(endX!, endY!)));
        
        // Wait for release to register
        await sleep(120);
        break;
      }
      case 'wait': {
        const ms = Number(action.ms ?? 500);
        logEvent('action_wait', { ms });
        await sleep(Math.max(0, Math.min(ms, 5000)));
        break;
      }
      default:
        logError('unrecognized_action', new Error(`Unknown action type: ${actionType}`), {
          action,
        });
        break;
    }
  } catch (err) {
    logError('action_execution_failed', err as Error, { actionType, action });
  }
}
