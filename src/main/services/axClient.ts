import { spawn } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { logError } from '../log';

const isDev = !app.isPackaged;

function getHelperPath(): string {
  if (isDev) {
    return path.join(process.cwd(), 'native', 'axdumper');
  }
  return path.join(process.resourcesPath, 'axdumper');
}

export interface AXElement {
  role?: string;
  subrole?: string;
  title?: string;
  value?: string;
  description?: string;
  identifier?: string;
  truncated?: boolean;
  frame?: { x: number; y: number; width: number; height: number };
  children?: AXElement[];
}

export async function getFrontmostAppUITree(): Promise<AXElement | null> {
  const helperPath = getHelperPath();
  
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath);
    
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        logError('ax_helper_failed', new Error(`AX helper exited with code ${code}`), { stderr });
        resolve(null);
        return;
      }

      try {
        const tree = JSON.parse(stdout);
        if (tree.error) {
          logError('ax_helper_error', new Error(tree.error));
          resolve(null);
        } else {
          resolve(tree);
        }
      } catch (err) {
        logError('ax_helper_parse_error', err as Error, { stdout });
        resolve(null);
      }
    });

    child.on('error', (err) => {
      logError('ax_helper_spawn_error', err);
      resolve(null);
    });
  });
}
