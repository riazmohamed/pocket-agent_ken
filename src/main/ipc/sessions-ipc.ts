import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { AgentManager } from '../../agent';
import { sanitizeSessionName } from '../../utils/session-name';
import type { IPCDependencies } from './types';

// ============ Session Directory Helpers ============

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/**
 * Get the agent's isolated workspace directory.
 */
function getAgentWorkspace(): string {
  const documentsPath = app.getPath('documents');
  return path.join(documentsPath, 'Pocket-agent');
}

/**
 * Create a per-session working directory for Coder mode.
 */
function createSessionDirectory(sessionName: string): string {
  const workspace = getAgentWorkspace();
  const sessionDir = path.join(workspace, sessionName);

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
    console.log(`[Main] Created session directory: ${sessionDir}`);
  }

  // Always sync coder commands from bundled assets
  const coderCommandsSource = path.join(__dirname, '../../assets/coder-commands');
  const sessionCommandsDir = path.join(sessionDir, '.claude', 'commands');
  if (fs.existsSync(coderCommandsSource)) {
    fs.mkdirSync(sessionCommandsDir, { recursive: true });
    const bundledFiles = new Set(
      fs.readdirSync(coderCommandsSource).filter((f) => f.endsWith('.md'))
    );
    if (fs.existsSync(sessionCommandsDir)) {
      for (const file of fs.readdirSync(sessionCommandsDir).filter((f) => f.endsWith('.md'))) {
        if (!bundledFiles.has(file)) {
          fs.unlinkSync(path.join(sessionCommandsDir, file));
        }
      }
    }
    for (const file of bundledFiles) {
      fs.copyFileSync(path.join(coderCommandsSource, file), path.join(sessionCommandsDir, file));
    }
    console.log(`[Main] Synced ${bundledFiles.size} coder commands to session directory`);
  }

  return sessionDir;
}

/**
 * Rename a session directory on disk.
 */
function renameSessionDirectory(oldPath: string, newName: string): string | null {
  const parentDir = path.dirname(oldPath);
  const newPath = path.join(parentDir, newName);

  if (fs.existsSync(newPath)) {
    console.warn(`[Main] Cannot rename session directory: target exists: ${newPath}`);
    return null;
  }

  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`[Main] Renamed session directory: ${oldPath} -> ${newPath}`);
  } else {
    return createSessionDirectory(newName);
  }

  return newPath;
}

// ============ IPC Registration ============

export function registerSessionsIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  ipcMain.handle('sessions:list', async () => {
    return getMemory()?.getSessions() || [];
  });

  ipcMain.handle('sessions:create', async (_, name: string) => {
    try {
      const safeName = sanitizeSessionName(name);
      const memory = getMemory();
      const mode = AgentManager.getMode();
      console.log(
        `[Sessions] Creating session "${safeName}" mode=${mode} workingDirectory=null (deferred)`
      );
      const session = memory?.createSession(safeName, mode, null);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('sessions:rename', async (_, id: string, name: string) => {
    try {
      const safeName = sanitizeSessionName(name);
      const memory = getMemory();
      const session = memory?.getSession(id);
      let newWorkingDirectory: string | undefined;
      console.log(
        `[Sessions] Renaming session ${id} to "${safeName}" | current working_directory=${session?.working_directory || 'null'}`
      );

      if (session?.working_directory) {
        const newPath = renameSessionDirectory(session.working_directory, safeName);
        if (!newPath) {
          console.log(`[Sessions] Rename blocked: directory "${safeName}" already exists`);
          return {
            success: false,
            error: `Cannot rename: directory "${safeName}" already exists`,
          };
        }
        newWorkingDirectory = newPath;
        console.log(`[Sessions] Directory renamed: ${session.working_directory} -> ${newPath}`);
      }

      const success = memory?.renameSession(id, safeName, newWorkingDirectory) ?? false;
      return { success };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('sessions:delete', async (_, id: string) => {
    AgentManager.clearQueue(id);
    AgentManager.cleanupSession(id);
    const memory = getMemory();
    const success = memory?.deleteSession(id) ?? false;
    return { success };
  });
}
