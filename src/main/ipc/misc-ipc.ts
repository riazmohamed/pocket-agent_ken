import { ipcMain, shell, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { loadWorkflowCommands, loadWorkflowCommandsFromDir } from '../../config/commands-loader';
import { isMacOS, getPermissionsStatus, openPermissionSettings } from '../../permissions';
import type { PermissionType } from '../../permissions';
import type { IPCDependencies } from './types';

const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';

export function registerMiscIPC(deps: IPCDependencies): void {
  const {
    getMemory,
    openChatWindow,
    openSettingsWindow,
    openCronWindow,
    openCustomizeWindow,
    openFactsWindow,
    openDailyLogsWindow,
    openSoulWindow,
    closeSplashScreen,
  } = deps;

  // Splash screen completion — always open chat window
  // Onboarding is now embedded inside chat.html and handled client-side
  ipcMain.on('splash-complete', () => {
    console.log('[Main] Splash complete, showing main app');
    closeSplashScreen();
    openChatWindow();
  });

  // App window openers
  ipcMain.handle('app:openFacts', async () => {
    openFactsWindow();
  });

  ipcMain.handle('app:openDailyLogs', async () => {
    openDailyLogsWindow();
  });

  ipcMain.handle('app:openSoul', async () => {
    openSoulWindow();
  });

  ipcMain.handle('app:openCustomize', async () => {
    openCustomizeWindow();
  });

  ipcMain.handle('app:openRoutines', async () => {
    openCronWindow();
  });

  ipcMain.handle('app:openSettings', async (_, tab?: string) => {
    openSettingsWindow(tab);
  });

  ipcMain.handle('app:openChat', async () => {
    openChatWindow();
  });

  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:openExternal', async (_, url: string) => {
    // Only allow http, https, and mailto schemes to prevent arbitrary protocol handler abuse
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
      console.warn('[Main] Blocked openExternal with disallowed scheme:', url);
      return;
    }
    await shell.openExternal(url);
  });

  ipcMain.handle('app:openPath', async (_, filePath: string) => {
    // Security: only allow opening paths within the Pocket-agent documents directory
    const allowedDir = path.join(app.getPath('documents'), 'Pocket-agent');
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(allowedDir)) {
      console.warn('[Main] Blocked openPath outside allowed directory:', filePath);
      return;
    }
    await shell.openPath(resolvedPath);
  });

  // Open an image in the default viewer — handles both local paths and URLs
  ipcMain.handle('app:openImage', async (_, src: string) => {
    try {
      const mediaDir = path.join(app.getPath('documents'), 'Pocket-agent', 'media');
      if (src.startsWith('http://') || src.startsWith('https://')) {
        // Remote URL — download to media dir first
        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());

        const contentType = res.headers.get('content-type') || '';
        const ext =
          contentType.includes('jpeg') || contentType.includes('jpg')
            ? '.jpg'
            : contentType.includes('gif')
              ? '.gif'
              : contentType.includes('webp')
                ? '.webp'
                : '.png';

        const filePath = path.join(mediaDir, `img-${Date.now()}${ext}`);
        fs.writeFileSync(filePath, buf);
        await shell.openPath(filePath);
      } else {
        // Local file path — only allow files within the media directory
        const resolvedPath = path.resolve(src);
        if (!resolvedPath.startsWith(mediaDir)) {
          console.warn('[Main] Blocked openImage outside media directory:', src);
          return;
        }
        await shell.openPath(resolvedPath);
      }
    } catch (err) {
      console.error('[Main] Failed to open image:', err);
    }
  });

  // OAuth flow for Claude subscription
  ipcMain.handle('auth:startOAuth', async () => {
    const { ClaudeOAuth } = await import('../../auth/oauth');
    return ClaudeOAuth.startFlow();
  });

  ipcMain.handle('auth:completeOAuth', async (_, code: string) => {
    const { ClaudeOAuth } = await import('../../auth/oauth');
    return ClaudeOAuth.completeWithCode(code);
  });

  ipcMain.handle('auth:cancelOAuth', async () => {
    const { ClaudeOAuth } = await import('../../auth/oauth');
    ClaudeOAuth.cancelFlow();
    return { success: true };
  });

  ipcMain.handle('auth:isOAuthPending', async () => {
    const { ClaudeOAuth } = await import('../../auth/oauth');
    return ClaudeOAuth.isPending();
  });

  ipcMain.handle('auth:validateOAuth', async () => {
    try {
      const { ClaudeOAuth } = await import('../../auth/oauth');
      // Timeout after 5 seconds to avoid hanging the UI
      const result = await Promise.race([
        ClaudeOAuth.getAccessToken().then((token) => ({ valid: token !== null })),
        new Promise<{ valid: boolean }>((resolve) =>
          setTimeout(() => resolve({ valid: false }), 5000)
        ),
      ]);
      console.log('[OAuth] Validation result:', result.valid ? 'valid' : 'expired/failed');
      return result;
    } catch (error) {
      console.error('[OAuth] Validation error:', error);
      return { valid: false };
    }
  });

  // OpenAI OAuth flow
  ipcMain.handle('openai:startOAuth', async () => {
    const { OpenAIOAuth } = await import('../../auth/openai-oauth');
    return OpenAIOAuth.startFlow();
  });

  ipcMain.handle('openai:completeOAuth', async () => {
    // Code-based flow is not used — browser-based PKCE flow auto-handles callback
    return { success: false, error: 'Not supported — use Sign in button' };
  });

  ipcMain.handle('openai:validateOAuth', async () => {
    try {
      const { OpenAIOAuth } = await import('../../auth/openai-oauth');
      const result = await Promise.race([
        OpenAIOAuth.getAccessToken().then((token) => ({ valid: token !== null })),
        new Promise<{ valid: boolean }>((resolve) =>
          setTimeout(() => resolve({ valid: false }), 5000)
        ),
      ]);
      console.log('[OpenAI OAuth] Validation result:', result.valid ? 'valid' : 'expired/failed');
      return result;
    } catch (error) {
      console.error('[OpenAI OAuth] Validation error:', error);
      return { valid: false };
    }
  });

  ipcMain.handle('openai:logoutOAuth', async () => {
    const { OpenAIOAuth } = await import('../../auth/openai-oauth');
    OpenAIOAuth.logout();
    return { success: true };
  });

  // Browser control
  ipcMain.handle('browser:detectInstalled', async () => {
    const { detectInstalledBrowsers } = await import('../../browser/launcher');
    return detectInstalledBrowsers();
  });

  ipcMain.handle('browser:launch', async (_, browserId: string, port?: number) => {
    const { launchBrowser } = await import('../../browser/launcher');
    return launchBrowser(browserId, port || 9222);
  });

  ipcMain.handle('browser:testConnection', async (_, cdpUrl?: string) => {
    const { testCdpConnection } = await import('../../browser/launcher');
    return testCdpConnection(cdpUrl || 'http://localhost:9222');
  });

  // Shell commands — platform-aware shell selection
  const ALLOWED_COMMAND_PREFIXES = IS_WINDOWS
    ? [
        '(Get-Command pocket',
        'Invoke-RestMethod https://api.github.com/repos/KenKaiii/',
        '$installDir = Join-Path',
      ]
    : [
        'which pocket',
        'curl -fsSL https://api.github.com/repos/KenKaiii/pocket-agent-cli/',
        'curl -fsSL https://raw.githubusercontent.com/KenKaiii/pocket-agent-cli/main/scripts/install.sh -o /tmp/pocket-cli-install.sh && sed',
      ];

  // Validate the `strings` version-check command
  const STRINGS_CMD_SUFFIX = ` | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1`;
  function isAllowedStringsCmd(cmd: string): boolean {
    if (!cmd.startsWith('strings "') || !cmd.endsWith(STRINGS_CMD_SUFFIX)) return false;
    const pathPart = cmd.slice('strings "'.length, cmd.length - STRINGS_CMD_SUFFIX.length - 1);
    return /^[\w/.-]+$/.test(pathPart);
  }

  ipcMain.handle('shell:runCommand', async (event, command: string) => {
    // Security: only allow calls from local file origins (not remote/injected content)
    const senderUrl = event.sender.getURL();
    if (!senderUrl.startsWith('file://')) {
      console.warn('[Shell] Blocked runCommand from non-local origin:', senderUrl);
      throw new Error('Access denied: shell commands only allowed from local UI');
    }
    // Security: only allow known command patterns
    const isAllowed =
      ALLOWED_COMMAND_PREFIXES.some((prefix) => command.startsWith(prefix)) ||
      (!IS_WINDOWS && isAllowedStringsCmd(command));
    if (!isAllowed) {
      console.warn('[Shell] Blocked non-allowlisted command:', command.slice(0, 80));
      throw new Error('Access denied: command not in allowlist');
    }
    const execAsync = promisify(exec);
    const shellOpts: Record<string, unknown> = IS_WINDOWS
      ? { shell: 'powershell.exe', env: process.env }
      : {
          shell: '/bin/bash',
          env: {
            ...process.env,
            PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin:${HOME_DIR}/.local/bin`,
          },
        };
    try {
      const { stdout } = await execAsync(command, shellOpts);
      return stdout;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Shell] Command failed:', errorMsg);
      throw error;
    }
  });

  // Commands (Workflows)
  ipcMain.handle('commands:list', async (_, sessionId?: string) => {
    const memory = getMemory();
    if (sessionId && memory) {
      const sessionMode = memory.getSessionMode(sessionId);
      const sessionWorkDir = memory.getSessionWorkingDirectory(sessionId);
      if (sessionMode === 'coder' && sessionWorkDir) {
        const sessionCommandsDir = path.join(sessionWorkDir, '.claude', 'commands');
        if (fs.existsSync(sessionCommandsDir)) {
          return loadWorkflowCommandsFromDir(sessionCommandsDir);
        }
      }
    }
    return loadWorkflowCommands();
  });

  // File attachments
  ipcMain.handle('attachment:save', async (_, name: string, dataUrl: string) => {
    try {
      const attachmentsDir = path.join(app.getPath('userData'), 'attachments');
      if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
      }

      const timestamp = Date.now();
      const safeName = name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(attachmentsDir, `${timestamp}-${safeName}`);

      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        throw new Error('Invalid data URL format');
      }

      const buffer = Buffer.from(matches[2], 'base64');
      fs.writeFileSync(filePath, buffer);

      console.log(`[Attachment] Saved: ${filePath}`);
      return filePath;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Attachment] Save failed:', errorMsg);
      throw error;
    }
  });

  // Extract text from Office documents
  ipcMain.handle('attachment:extract-text', async (_, filePath: string) => {
    const attachmentsDir = path.join(app.getPath('userData'), 'attachments');
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(attachmentsDir)) {
      throw new Error('Access denied: path outside attachments directory');
    }
    const { parseOffice } = await import('officeparser');
    const ast = await parseOffice(resolvedPath);
    return ast.toText();
  });

  // Permissions (macOS)
  ipcMain.handle('permissions:isMacOS', () => {
    return isMacOS();
  });

  ipcMain.handle('permissions:checkStatus', (_, types: PermissionType[]) => {
    return getPermissionsStatus(types);
  });

  ipcMain.handle('permissions:openSettings', async (_, type: PermissionType) => {
    await openPermissionSettings(type);
  });
}
