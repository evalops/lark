import { BrowserWindow, screen } from 'electron';

let indicatorWindow: BrowserWindow | null = null;

const INDICATOR_SIZE = 60;
const INDICATOR_DURATION = 500;

function createIndicatorWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.setIgnoreMouseEvents(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver');

  // Load inline HTML for the indicator
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          padding: 0;
          background: transparent;
          overflow: hidden;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
        }
        .indicator {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(0, 122, 255, 0.8);
          box-shadow: 0 0 10px rgba(0, 122, 255, 0.5);
          position: absolute;
          animation: scaleIn 0.2s ease-out forwards;
        }
        .ripple {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid rgba(0, 122, 255, 0.6);
          position: absolute;
          box-sizing: border-box;
          animation: ripple 0.5s ease-out forwards;
        }
        @keyframes scaleIn {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes ripple {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(3); opacity: 0; }
        }
      </style>
    </head>
    <body>
      <div class="indicator"></div>
      <div class="ripple"></div>
    </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  return win;
}

export function showClickIndicator(x: number, y: number): void {
  // Get the display containing the click point
  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find((d) => {
    const b = d.bounds;
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
  }) || screen.getPrimaryDisplay();

  // Create window if needed
  if (!indicatorWindow || indicatorWindow.isDestroyed()) {
    indicatorWindow = createIndicatorWindow();
  }

  // Position centered on click point
  const posX = Math.round(x - INDICATOR_SIZE / 2);
  const posY = Math.round(y - INDICATOR_SIZE / 2);

  indicatorWindow.setBounds({
    x: posX,
    y: posY,
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
  });

  // Reload to restart animation
  indicatorWindow.reload();
  indicatorWindow.show();

  // Hide after animation completes
  setTimeout(() => {
    if (indicatorWindow && !indicatorWindow.isDestroyed()) {
      indicatorWindow.hide();
    }
  }, INDICATOR_DURATION);
}

export function destroyIndicator(): void {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) {
    indicatorWindow.destroy();
    indicatorWindow = null;
  }
}
