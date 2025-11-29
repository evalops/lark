import { BrowserWindow } from 'electron';
import { ToolActivity } from '../common/types';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
  // Hide window from screen captures (screenshots/screen recording)
  // This keeps it visible to the user but invisible to the agent
  if (mainWindow) {
    mainWindow.setContentProtection(true);
  }
}

export function sendStatusUpdate(status: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status-update', status);
  }
}

export function sendToolActivity(activity: ToolActivity): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tool-activity', activity);
  }
}

export function sendConfirmationRequest(request: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('confirmation-request', request);
  }
}
