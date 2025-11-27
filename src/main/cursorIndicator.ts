import { BrowserWindow, screen, ipcMain } from 'electron';

let overlayWindow: BrowserWindow | null = null;

// We'll use a single overlay window for all visual effects
function createOverlayWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    enableLargerThanScreen: true, // Essential for Mac
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: undefined, // No preload needed for simple visualizer
    },
  });

  win.setIgnoreMouseEvents(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver');

  // HTML with Canvas for trails and clicks
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
        canvas { display: block; width: 100vw; height: 100vh; }
      </style>
    </head>
    <body>
      <canvas id="canvas"></canvas>
      <script>
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        
        function resize() {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resize);
        resize();

        const particles = [];
        const ripples = [];

        class Particle {
          constructor(x, y) {
            this.x = x;
            this.y = y;
            this.vx = (Math.random() - 0.5) * 2;
            this.vy = (Math.random() - 0.5) * 2;
            this.life = 1.0;
            this.decay = 0.03 + Math.random() * 0.03;
            this.size = 2 + Math.random() * 3;
            this.color = \`hsla(\${200 + Math.random() * 40}, 100%, 70%, \`; 
          }
          update() {
            this.x += this.vx;
            this.y += this.vy;
            this.life -= this.decay;
          }
          draw(ctx) {
            ctx.fillStyle = this.color + this.life + ')';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * this.life, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        class Ripple {
          constructor(x, y) {
            this.x = x;
            this.y = y;
            this.radius = 5;
            this.maxRadius = 50;
            this.life = 1.0;
            this.decay = 0.04;
          }
          update() {
            this.radius += (this.maxRadius - this.radius) * 0.1 + 1;
            this.life -= this.decay;
          }
          draw(ctx) {
            ctx.strokeStyle = \`rgba(0, 122, 255, \${this.life})\`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // Listen for IPC messages from main process
        const { ipcRenderer } = require('electron');
        
        // Wait, we can't require electron in standard webPreferences unless nodeIntegration is true.
        // But we want to keep it secure. 
        // We should use a preload script or executeJavaScript.
        // Let's use executeJavaScript from main to trigger effects.
        
        window.addParticle = (x, y) => {
          for(let i=0; i<3; i++) {
            particles.push(new Particle(x, y));
          }
        };

        window.addTrail = (fromX, fromY, toX, toY) => {
          // Interpolate particles along the path
          const dist = Math.hypot(toX - fromX, toY - fromY);
          const steps = Math.max(5, Math.floor(dist / 10)); // Every 10px
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const px = fromX + (toX - fromX) * t;
            const py = fromY + (toY - fromY) * t;
            particles.push(new Particle(px, py));
          }
        };

        window.addRipple = (x, y) => {
          ripples.push(new Ripple(x, y));
        };

        function loop() {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.update();
            p.draw(ctx);
            if (p.life <= 0) particles.splice(i, 1);
          }

          for (let i = ripples.length - 1; i >= 0; i--) {
            const r = ripples[i];
            r.update();
            r.draw(ctx);
            if (r.life <= 0) ripples.splice(i, 1);
          }

          requestAnimationFrame(loop);
        }
        loop();
      </script>
    </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  
  // Wait for load to ensure JS context exists
  win.webContents.once('did-finish-load', () => {
    // Ready
  });

  return win;
}

function ensureOverlay(): BrowserWindow {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = createOverlayWindow();
    overlayWindow.showInactive();
  }
  return overlayWindow;
}

export function showClickIndicator(x: number, y: number): void {
  const win = ensureOverlay();
  // Convert screen coords to window local coords if needed
  // Assuming window covers primary display 0,0
  // Multi-monitor support might need adjustment if window is only on primary.
  // For now, let's assume primary display coordinates match.
  win.webContents.executeJavaScript(`window.addRipple(${x}, ${y})`).catch(() => {});
}

export function showTrail(fromX: number, fromY: number, toX: number, toY: number): void {
  const win = ensureOverlay();
  win.webContents.executeJavaScript(`window.addTrail(${fromX}, ${fromY}, ${toX}, ${toY})`).catch(() => {});
}

export function destroyIndicator(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
}

// Utility to hide overlay temporarily (e.g. for screenshots)
export async function hideOverlay(): Promise<void> {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
    overlayWindow.hide();
    // Small delay to ensure OS composite handles hide
    return new Promise(r => setTimeout(r, 50));
  }
}

export function showOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.showInactive();
  }
}
