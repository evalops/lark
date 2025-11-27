interface LarkAPI {
  askOpenAI: (prompt: string) => Promise<string>;
  stopComputerUse: () => Promise<void>;
  moveMouse: (coords: { x: number; y: number }) => Promise<void>;
  typeText: (text: string) => Promise<void>;
  captureScreen: () => Promise<void>;
  setWindowHeight: (height: number) => Promise<void>;
  getHistory: () => Promise<Array<{ role: string; content: string }>>;
  clearHistory: () => Promise<void>;
  onStatusUpdate: (callback: (status: string) => void) => void;
  constants: { PILL_BASE_HEIGHT: number };
  getConstants: () => Promise<{ PILL_BASE_HEIGHT: number }>;
  getConfigStatus: () => Promise<{ needsApiKey: boolean; hasApiKey: boolean; provider: string }>;
  saveApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  quitApp: () => Promise<void>;
  getConfig: () => Promise<any>;
  saveConfig: (updates: any) => Promise<{ success: boolean; error?: string }>;
}

interface Window {
  larkAPI: LarkAPI;
}

let PILL_BASE_HEIGHT = window.larkAPI?.constants?.PILL_BASE_HEIGHT ?? 60;

function must<T extends HTMLElement>(v: T | null, id: string): T {
  if (!v) throw new Error(`Missing #${id}`);
  return v;
}

const pill = must(document.getElementById('pill'), 'pill');
const input = must(document.getElementById('prompt') as HTMLInputElement, 'prompt');
const loader = must(document.getElementById('loader'), 'loader');
const sendButton = must(document.getElementById('send') as HTMLButtonElement, 'send');
const waveformContainer = document.getElementById('waveform');
const responseDiv = must(document.getElementById('response'), 'response');

const apiKeySetup = must(document.getElementById('api-key-setup'), 'api-key-setup');
const apiKeyInput = must(
  document.getElementById('api-key-input') as HTMLInputElement,
  'api-key-input'
);
const apiKeySaveBtn = must(
  document.getElementById('api-key-save') as HTMLButtonElement,
  'api-key-save'
);
const apiKeyError = must(document.getElementById('api-key-error'), 'api-key-error');
const providerName = must(document.getElementById('provider-name'), 'provider-name');
const mainInput = must(document.getElementById('main-input'), 'main-input');

// Settings Elements
const settingsToggle = must(document.getElementById('settings-toggle') as HTMLButtonElement, 'settings-toggle');
const settingsModal = must(document.getElementById('settings-modal'), 'settings-modal');
const settingsClose = must(document.getElementById('settings-close') as HTMLButtonElement, 'settings-close');
const settingsSave = must(document.getElementById('settings-save') as HTMLButtonElement, 'settings-save');

const settingModel = must(document.getElementById('setting-model') as HTMLSelectElement, 'setting-model');
const settingMaxSteps = must(document.getElementById('setting-max-steps') as HTMLInputElement, 'setting-max-steps');
const settingDelay = must(document.getElementById('setting-delay') as HTMLInputElement, 'setting-delay');
const settingApiKey = must(document.getElementById('setting-api-key') as HTMLInputElement, 'setting-api-key');

let isLoading = false;
let showingResponse = false;

function setLoading(loading: boolean): void {
  if (isLoading === loading) return;
  isLoading = loading;
  loader.classList.toggle('hidden', !loading);
  input.disabled = loading;
  if (!loading) {
    input.placeholder = 'Ask me to control your computer...';
  }
  updateSendButtonAppearance();
}

function setShowingResponse(show: boolean): void {
  showingResponse = show;
  responseDiv.classList.toggle('hidden', !show);
  pill.classList.toggle('showing-response', show);
}

const SEND_ARROW_SVG =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="icon"><path d="M8.99992 16V6.41407L5.70696 9.70704C5.31643 10.0976 4.68342 10.0976 4.29289 9.70704C3.90237 9.31652 3.90237 8.6835 4.29289 8.29298L9.29289 3.29298L9.36907 3.22462C9.76184 2.90427 10.3408 2.92686 10.707 3.29298L15.707 8.29298L15.7753 8.36915C16.0957 8.76192 16.0731 9.34092 15.707 9.70704C15.3408 10.0732 14.7618 10.0958 14.3691 9.7754L14.2929 9.70704L10.9999 6.41407V16C10.9999 16.5523 10.5522 17 9.99992 17C9.44764 17 8.99992 16.5523 8.99992 16Z"></path></svg>';
const CLEAR_X_SVG =
  '<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" class="icon"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 5L15 15"/><path d="M15 5L5 15"/></g></svg>';

pill.classList.add('collapsed');

pill.addEventListener('mouseenter', () => {
  if (pill.classList.contains('showing-settings')) return;
  pill.classList.remove('collapsed');
  pill.classList.add('expanded');
  setTimeout(() => {
    if (!pill.classList.contains('showing-settings')) input.focus();
  }, 300);
  requestAnimationFrame(() => fitWindowToPill());
  updateSendButtonAppearance();
});

pill.addEventListener('mouseleave', () => {
  const shouldCollapse = 
    (!input.value.trim() || showingResponse) && 
    !isLoading && 
    !pill.classList.contains('showing-settings') &&
    !pill.classList.contains('needs-api-key');

  if (shouldCollapse) {
    pill.classList.add('collapsed');
    pill.classList.remove('expanded');
    input.blur();
    setWindowBaseHeight();
  }
});

function setCaretToEnd(): void {
  const length = input.value.length;
  input.setSelectionRange(length, length);
}

async function sendPrompt(): Promise<void> {
  const prompt = input.value.trim();
  if (!prompt || isLoading) return;

  input.value = '';

  if (prompt === '/quit') {
    await window.larkAPI.quitApp();
    return;
  }

  setLoading(true);

  responseDiv.classList.remove('hidden');
  pill.classList.add('showing-response');
  pill.classList.remove('collapsed');
  pill.classList.add('expanded');

  appendMessage('user', prompt, { fromInput: true });
  requestAnimationFrame(() => {
    fitWindowToPill();
    scheduleFitWindowToPillDuringTransition();
  });

  try {
    if (!('larkAPI' in window) || typeof window.larkAPI.askOpenAI !== 'function') {
      appendMessage('assistant', 'UI error: Lark bridge unavailable. Please reload the app.');
      setLoading(false);
      return;
    }

    const response = await window.larkAPI.askOpenAI(prompt);
    console.log('Agent response:', response);

    appendMessage('assistant', response, { fadeIn: true });
    responseDiv.classList.remove('hidden');
    pill.classList.add('showing-response');
    setLoading(false);
    setShowingResponse(true);
    pill.classList.remove('collapsed');
    pill.classList.add('expanded');

    input.focus();
    requestAnimationFrame(() => {
      fitWindowToPill();
      scheduleFitWindowToPillDuringTransition();
    });
    updateSendButtonAppearance();
  } catch (error) {
    console.error('Error calling agent:', error);
    input.placeholder = 'Error! Try again...';
    setLoading(false);
    setWindowBaseHeight();
    setTimeout(() => {
      input.placeholder = 'Ask me to control your computer...';
    }, 2000);
    updateSendButtonAppearance();
  }
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    sendPrompt();
  }
});

sendButton.addEventListener('click', async () => {
  if (isLoading) {
    try {
      await window.larkAPI.stopComputerUse();
    } catch (err) {
      console.error('Error stopping:', err);
    }
    isLoading = false;
    loader.classList.add('hidden');
    input.disabled = false;
    input.placeholder = 'Stopped';
    updateSendButtonAppearance();
    setTimeout(() => {
      input.placeholder = 'Ask me to control your computer...';
    }, 1500);
    return;
  }

  const hasText = !!input.value.trim();
  if (hasText) {
    sendPrompt();
    return;
  }

  const count = getMessageCount();
  if (count > 0) {
    try {
      await window.larkAPI.clearHistory();
    } catch {
      // ignore
    }
    responseDiv.innerHTML = '';
    setShowingResponse(false);
    setWindowBaseHeight();
    updateSendButtonAppearance();
  }
});

input.addEventListener('focus', () => {
  if (showingResponse) {
    setCaretToEnd();
  }
});

input.addEventListener('input', () => {
  updateSendButtonAppearance();
});

// Settings Logic
async function openSettings(): Promise<void> {
  try {
    const config = await window.larkAPI.getConfig();
    
    // Populate fields
    settingModel.value = config.claude?.model || 'claude-opus-4-5-20251101';
    settingMaxSteps.value = String(config.agent?.maxSteps || 1000);
    settingDelay.value = String(config.agent?.minStepDelayMs || 1000);
    settingApiKey.value = config.claude?.apiKey || '';
    
    // Show modal
    pill.classList.add('showing-settings');
    pill.classList.remove('collapsed');
    pill.classList.add('expanded');
    settingsModal.classList.remove('hidden');
    requestAnimationFrame(() => fitWindowToPill());
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function closeSettings(): void {
  pill.classList.remove('showing-settings');
  settingsModal.classList.add('hidden');
  input.focus();
  setWindowBaseHeight();
}

async function saveSettings(): Promise<void> {
  const updates = {
    claude: {
      model: settingModel.value,
      apiKey: settingApiKey.value,
    },
    agent: {
      maxSteps: Number(settingMaxSteps.value),
      minStepDelayMs: Number(settingDelay.value),
    },
  };

  settingsSave.disabled = true;
  settingsSave.textContent = 'Saving...';

  try {
    const res = await window.larkAPI.saveConfig(updates);
    if (res.success) {
      closeSettings();
    } else {
      alert('Failed to save settings: ' + res.error);
    }
  } catch (err) {
    console.error('Error saving settings:', err);
    alert('Error saving settings');
  } finally {
    settingsSave.disabled = false;
    settingsSave.textContent = 'Save Changes';
  }
}

settingsToggle.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsSave.addEventListener('click', saveSettings);

// Waveform animation
if (waveformContainer) {
  const canvas = document.createElement('canvas');
  waveformContainer.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const cssWidth = (): number => {
    const w = waveformContainer.clientWidth || 100;
    const cs = window.getComputedStyle(waveformContainer);
    const padL = parseFloat(cs.paddingLeft || '0') || 0;
    const padR = parseFloat(cs.paddingRight || '0') || 0;
    return Math.max(10, w - padL - padR);
  };

  const cssHeight = (): number => waveformContainer.clientHeight || 16;

  function resizeCanvas(): void {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const w = cssWidth();
    const h = cssHeight();
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  pill.addEventListener('mouseenter', resizeCanvas);
  pill.addEventListener('mouseleave', resizeCanvas);

  let t = 0;

  function draw(): void {
    if (!ctx) return;
    const w = cssWidth();
    const h = cssHeight();
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    const midY = h / 2;
    const baseAmp = Math.max(2, h * 0.28);
    const speed = 0.05;
    const freq = 2.5;
    const ampMod = (Math.sin(t * 0.8) + 1) * 0.5;
    const amplitude = baseAmp * (0.6 + 0.4 * ampMod);

    const waves = [
      { color: 'rgba(10,132,255,0.9)', phase: 0, width: 2.0 },
      { color: 'rgba(255,55,95,0.75)', phase: Math.PI / 2, width: 1.8 },
      { color: 'rgba(48,220,155,0.8)', phase: Math.PI, width: 1.8 },
    ];

    for (const wave of waves) {
      ctx.beginPath();
      const pad = 0.5;
      const xStart = pad;
      const xEnd = Math.max(pad, w - pad);
      let started = false;

      for (let x = xStart; x <= xEnd; x++) {
        const normX = (x - xStart) / Math.max(1, xEnd - xStart);
        const taper = Math.pow(Math.sin(normX * Math.PI), 1.1);
        const y =
          midY + Math.sin(normX * Math.PI * 2 * freq + t + wave.phase) * amplitude * taper;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.strokeStyle = wave.color;
      ctx.lineWidth = wave.width;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    t += speed;

    requestAnimationFrame(() => {
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const wNow = cssWidth();
      const hNow = cssHeight();
      const needResize =
        canvas.width !== Math.round(wNow * dpr) || canvas.height !== Math.round(hNow * dpr);
      if (needResize) resizeCanvas();
      draw();
    });
  }

  requestAnimationFrame(draw);
}

let setHeightTimer: number | null = null;

function setWindowHeightDebounced(height: number, delay = 60): void {
  if (setHeightTimer !== null) {
    clearTimeout(setHeightTimer);
  }
  setHeightTimer = window.setTimeout(() => {
    try {
      window.larkAPI.setWindowHeight(height);
    } catch (err) {
      console.error('Failed to set window height:', err);
    }
  }, delay);
}

function setWindowBaseHeight(): void {
  setWindowHeightDebounced(PILL_BASE_HEIGHT);
}

function fitWindowToPill(): void {
  try {
    const rect = pill.getBoundingClientRect();
    const extra = 16;
    const target = Math.ceil(rect.height + extra);
    setWindowHeightDebounced(target);
  } catch (err) {
    console.error('Failed to fit window to pill:', err);
  }
}

function scheduleFitWindowToPillDuringTransition(): void {
  const times = [100, 260];
  times.forEach((t) => setTimeout(() => fitWindowToPill(), t));
}

pill.addEventListener('transitionend', (e) => {
  if (e.propertyName === 'max-height' || e.propertyName === 'height') {
    fitWindowToPill();
  }
});

function pruneHistory(limit = 100): void {
  const messages = Array.from(responseDiv.querySelectorAll('.message'));
  if (messages.length > limit) {
    const toRemove = messages.length - limit;
    for (let i = 0; i < toRemove; i++) {
      messages[i].remove();
    }
  }
}

function appendMessage(
  role: string,
  content: string,
  opts: { fromInput?: boolean; fadeIn?: boolean } = {}
): void {
  const el = document.createElement('div');
  el.className = `message ${role} enter`;
  el.textContent = content;
  responseDiv.appendChild(el);
  
  // Prune history to keep DOM light
  pruneHistory();

  const doFromInput = !!opts.fromInput;
  if (doFromInput) {
    const inputRect = input.getBoundingClientRect();
    const msgRect = el.getBoundingClientRect();
    const dy = inputRect.top - msgRect.top - 6;
    el.style.transform = `translateY(${dy}px)`;
    el.style.opacity = '0';
    el.style.transition =
      'opacity 180ms ease, transform 220ms cubic-bezier(0.2,0.8,0.2,1)';
  }

  requestAnimationFrame(() => {
    if (doFromInput) {
      el.style.transform = 'translateY(0)';
      el.style.opacity = '1';
    }
    el.classList.remove('enter');
    responseDiv.scrollTop = responseDiv.scrollHeight;
  });
}

async function loadAndRenderHistory(): Promise<void> {
  try {
    const hist = await window.larkAPI.getHistory();
    responseDiv.innerHTML = '';
    for (const m of hist) {
      appendMessage(m.role, m.content);
    }
    if (hist.length) {
      showingResponse = true;
      responseDiv.classList.remove('hidden');
      pill.classList.add('showing-response');
      requestAnimationFrame(() => fitWindowToPill());
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}

loadAndRenderHistory();

if (window.larkAPI?.onStatusUpdate) {
  window.larkAPI.onStatusUpdate((status) => {
    console.log('Status update:', status);
    if (isLoading) {
      const cleanStatus = status.replace(/^Step \d+:\s*/, '');
      input.placeholder = cleanStatus;
    }
  });
}

if (window.larkAPI?.getConstants) {
  window.larkAPI
    .getConstants()
    .then((c) => {
      if (c && typeof c.PILL_BASE_HEIGHT === 'number') {
        PILL_BASE_HEIGHT = c.PILL_BASE_HEIGHT;
        setWindowBaseHeight();
      }
    })
    .catch((err) => {
      console.error('Failed to get constants:', err);
    });
}

function getMessageCount(): number {
  return responseDiv.querySelectorAll('.message').length;
}

function updateSendButtonAppearance(): void {
  if (isLoading) {
    sendButton.disabled = false;
    sendButton.classList.add('clear');
    sendButton.innerHTML = CLEAR_X_SVG;
    sendButton.title = 'Stop';
    return;
  }

  sendButton.disabled = false;
  const hasText = !!input.value.trim();
  const count = getMessageCount();

  if (hasText || count === 0) {
    sendButton.classList.remove('clear');
    sendButton.innerHTML = SEND_ARROW_SVG;
    sendButton.title = 'Send';
  } else {
    sendButton.classList.add('clear');
    sendButton.innerHTML = CLEAR_X_SVG;
    sendButton.title = 'Clear chat';
  }
}

function showApiKeySetup(provider: string): void {
  pill.classList.add('needs-api-key');
  pill.classList.remove('collapsed');
  apiKeySetup.classList.remove('hidden');
  mainInput.classList.add('hidden');

  const displayName = provider === 'claude' ? 'Anthropic' : 'OpenRouter';
  providerName.textContent = displayName;
  apiKeyInput.placeholder = provider === 'claude' ? 'sk-ant-...' : 'sk-or-...';

  setTimeout(() => apiKeyInput.focus(), 100);
  requestAnimationFrame(() => fitWindowToPill());
}

function hideApiKeySetup(): void {
  pill.classList.remove('needs-api-key');
  apiKeySetup.classList.add('hidden');
  mainInput.classList.remove('hidden');
  apiKeyError.classList.add('hidden');
  apiKeyError.textContent = '';
  pill.classList.add('collapsed');
  setWindowBaseHeight();
}

async function saveApiKey(): Promise<void> {
  const key = apiKeyInput.value.trim();
  if (!key) {
    apiKeyError.textContent = 'Please enter an API key';
    apiKeyError.classList.remove('hidden');
    return;
  }

  apiKeySaveBtn.disabled = true;
  apiKeySaveBtn.textContent = 'Saving...';
  apiKeyError.classList.add('hidden');

  try {
    const result = await window.larkAPI.saveApiKey(key);
    if (result.success) {
      hideApiKeySetup();
      apiKeyInput.value = '';
      input.placeholder = 'API key saved! Ask me to control your computer...';
      setTimeout(() => {
        input.placeholder = 'Ask me to control your computer...';
      }, 2000);
    } else {
      apiKeyError.textContent = result.error || 'Failed to save API key';
      apiKeyError.classList.remove('hidden');
    }
  } catch {
    apiKeyError.textContent = 'Error saving API key';
    apiKeyError.classList.remove('hidden');
  } finally {
    apiKeySaveBtn.disabled = false;
    apiKeySaveBtn.textContent = 'Save';
  }
}

apiKeySaveBtn.addEventListener('click', saveApiKey);
apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    saveApiKey();
  }
});

async function checkConfigStatus(): Promise<void> {
  try {
    if (!window.larkAPI?.getConfigStatus) return;
    const status = await window.larkAPI.getConfigStatus();
    if (status.needsApiKey && !status.hasApiKey) {
      showApiKeySetup(status.provider);
    }
  } catch (err) {
    console.error('Failed to check config status:', err);
  }
}

checkConfigStatus();
