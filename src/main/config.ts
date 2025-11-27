import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

const cliDefinedKeys = new Set(Object.keys(process.env));

bootstrapEnv();

function bootstrapEnv(): void {
  loadBundledDefaults();
  loadProjectEnv();
  loadUserEnv();
}

function loadBundledDefaults(): void {
  for (const candidate of bundledEnvCandidates()) {
    if (fs.existsSync(candidate)) {
      applyEnvFile(candidate, { overrideExisting: false });
      break;
    }
  }
}

function bundledEnvCandidates(): string[] {
  const candidates: string[] = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'default.env'));
  }
  candidates.push(path.resolve(__dirname, '../../packaging/runtime/default.env'));
  return candidates;
}

function loadProjectEnv(): void {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      applyEnvFile(candidate, { overrideExisting: true });
      break;
    }
  }
}

function loadUserEnv(): void {
  const userEnv = getUserEnvPath();
  if (fs.existsSync(userEnv)) {
    applyEnvFile(userEnv, { overrideExisting: true });
  }
}

function applyEnvFile(filePath: string, opts: { overrideExisting: boolean }): void {
  try {
    const parsed = dotenv.parse(fs.readFileSync(filePath, 'utf8'));
    applyEnv(parsed, opts);
  } catch (err) {
    console.warn(`Failed to load env file ${filePath}:`, err);
  }
}

function applyEnv(
  values: Record<string, string>,
  opts: { overrideExisting: boolean }
): void {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (cliDefinedKeys.has(key)) return;
    const alreadySet = process.env[key] !== undefined;
    if (alreadySet && !opts.overrideExisting) return;
    process.env[key] = value;
  });
}

function num(envVar: string | undefined, fallback: number): number {
  const n = Number(envVar);
  return Number.isFinite(n) ? n : fallback;
}

function str(envVar: string | undefined, fallback: string): string {
  return envVar && envVar.length > 0 ? envVar : fallback;
}

export interface Config {
  model: { provider: 'claude' | 'gemini' };
  claude: { apiKey: string; model: string };
  gemini: { apiKey: string; model: string };
  agent: { maxSteps: number; minStepDelayMs: number };
  ui: {
    pillBaseHeight: number;
    maxPromptLength: number;
    maxTypeLength: number;
    maxHistoryEntries: number;
    windowMaxHeight: number;
    windowWidth: number;
  };
  actions: {
    arrowKeyHoldDuration: number;
    dragHoldDuration: number;
    dragMinSteps: number;
    dragStepPixels: number;
  };
}

function buildConfig(): Config {
  return {
    model: {
      provider: (process.env.MODEL_PROVIDER as 'claude' | 'gemini') || 'claude',
    },
    claude: {
      apiKey: str(process.env.ANTHROPIC_API_KEY, ''),
      model: str(process.env.CLAUDE_MODEL, 'claude-opus-4-5-20251101'),
    },
    gemini: {
      apiKey: str(process.env.GEMINI_API_KEY, ''),
      model: str(process.env.GEMINI_MODEL, 'gemini-2.0-flash-exp'),
    },
    agent: {
      maxSteps: num(process.env.CUA_MAX_STEPS, 1000),
      minStepDelayMs: num(process.env.AGENT_MIN_STEP_DELAY_MS, 1000),
    },
    ui: {
      pillBaseHeight: num(process.env.PILL_BASE_HEIGHT, 60),
      maxPromptLength: num(process.env.MAX_PROMPT_LEN, 5000),
      maxTypeLength: num(process.env.MAX_TYPE_LEN, 500),
      maxHistoryEntries: num(process.env.MAX_HISTORY_ENTRIES, 200),
      windowMaxHeight: num(process.env.WINDOW_MAX_HEIGHT, 320),
      windowWidth: num(process.env.WINDOW_WIDTH, 400),
    },
    actions: {
      arrowKeyHoldDuration: num(process.env.ACTION_ARROW_HOLD_MS, 500),
      dragHoldDuration: num(process.env.ACTION_DRAG_HOLD_MS, 200),
      dragMinSteps: num(process.env.ACTION_DRAG_MIN_STEPS, 20),
      dragStepPixels: num(process.env.ACTION_DRAG_STEP_PIXELS, 20),
    },
  };
}

export let config = buildConfig();

export function refreshConfig(): void {
  config = buildConfig();
}

export function getUserEnvPath(): string {
  const base =
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'Lark', 'user.env');
}

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (config.model.provider === 'claude') {
    if (!config.claude.apiKey) errors.push('ANTHROPIC_API_KEY is not set');
    if (!config.claude.model) errors.push('CLAUDE_MODEL is not set');
  } else if (config.model.provider === 'gemini') {
    if (!config.gemini.apiKey) errors.push('GEMINI_API_KEY is not set');
    if (!config.gemini.model) errors.push('GEMINI_MODEL is not set');
  }
  return errors;
}

export function saveUserConfig(updates: Partial<Config>): void {
  const userEnvPath = getUserEnvPath();
  let envContent = '';

  if (fs.existsSync(userEnvPath)) {
    envContent = fs.readFileSync(userEnvPath, 'utf8');
  }

  const parsed = dotenv.parse(envContent);

  // Update values
  if (updates.model?.provider !== undefined) parsed.MODEL_PROVIDER = updates.model.provider;
  
  if (updates.claude?.apiKey !== undefined) parsed.ANTHROPIC_API_KEY = updates.claude.apiKey;
  if (updates.claude?.model !== undefined) parsed.CLAUDE_MODEL = updates.claude.model;
  
  if (updates.gemini?.apiKey !== undefined) parsed.GEMINI_API_KEY = updates.gemini.apiKey;
  if (updates.gemini?.model !== undefined) parsed.GEMINI_MODEL = updates.gemini.model;
  
  if (updates.agent?.maxSteps !== undefined) parsed.CUA_MAX_STEPS = String(updates.agent.maxSteps);
  if (updates.agent?.minStepDelayMs !== undefined) parsed.AGENT_MIN_STEP_DELAY_MS = String(updates.agent.minStepDelayMs);

  // Ensure directory exists
  const dir = path.dirname(userEnvPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write back
  const newContent = Object.entries(parsed)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  fs.writeFileSync(userEnvPath, newContent);
  
  // Update current process.env so refreshConfig picks it up
  Object.entries(parsed).forEach(([key, value]) => {
    process.env[key] = value;
  });

  refreshConfig();
}
