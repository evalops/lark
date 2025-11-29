export interface Config {
  model: { provider: 'claude' | 'gemini' };
  claude: { apiKey: string; model: string };
  gemini: { apiKey: string; model: string };
  agent: { 
    maxSteps: number; 
    minStepDelayMs: number;
    confirmDangerousActions: boolean;
  };
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

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface ToolActivity {
  type: 'step' | 'tool_use' | 'tool_result' | 'finish';
  step?: number;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  text?: string;
}
