import { app, BrowserWindow, Notification, globalShortcut, screen, powerMonitor } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { AgentManager } from '../agent';
import { MemoryManager } from '../memory';
import { createScheduler, CronScheduler } from '../scheduler';
import { createTelegramBot, TelegramBot } from '../channels/telegram';
import { createiOSChannel, iOSChannel } from '../channels/ios';
import { createAgentHomeChannel, AgentHomeChannel } from '../channels/agent-home';
import { SettingsManager } from '../settings';
import { DEFAULT_COMMANDS } from '../config/commands';
import { getBrowserManager } from '../browser';
import { initializeUpdater, setupUpdaterIPC, setSettingsWindow, setChatWindow } from './updater';
import { createWindow, getWindow } from './windows';
import { fixPathForPackagedApp } from './node-paths';
import { setupBirthdayCronJobs } from './birthday';
import { createTray, updateTrayMenu, initTray } from './tray';
import {
  registerAgentIPC,
  registerSessionsIPC,
  registerSettingsIPC,
  registerFactsIPC,
  registerCronIPC,
  registerIosIPC,
  registerMiscIPC,
  wireIosChannelHandlers,
  registerAgentHomeIPC,
  wireAgentHomeChannelHandlers,
} from './ipc';
import type { IPCDependencies } from './ipc';

// Handle EPIPE errors gracefully (happens when stdout pipe is closed)
process.stdout?.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'EPIPE') return;
});
process.stderr?.on('error', (err: Error & { code?: string }) => {
  if (err.code === 'EPIPE') return;
});
process.on('uncaughtException', (err) => {
  if (err.message?.includes('EPIPE')) return;
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// IS_WINDOWS and HOME_DIR moved to src/main/ipc/misc-ipc.ts

// Fix PATH for packaged apps — platform-aware (must run early, at module load)
fixPathForPackagedApp();

let memory: MemoryManager | null = null;
let scheduler: CronScheduler | null = null;
let telegramBot: TelegramBot | null = null;
let iosChannel: iOSChannel | null = null;
let agentHomeChannel: AgentHomeChannel | null = null;
let splashWindow: BrowserWindow | null = null;
// tray menu updates are event-driven via IPC handlers
let modelChangedHandler: ((model: string) => void) | null = null;

// Window IDs for the registry
const WIN = {
  CHAT: 'chat',
  CRON: 'cron',
  SETTINGS: 'settings',
  CUSTOMIZE: 'customize',
  FACTS: 'facts',
  DAILY_LOGS: 'dailyLogs',
  SOUL: 'soul',
} as const;

/**
 * Get the agent's isolated workspace directory.
 * This is separate from the app's project root to prevent conflicts.
 * Located in ~/Documents/Pocket-agent/  (falls back to userData if Documents is unavailable,
 * e.g. iCloud Drive syncing or broken symlink on macOS).
 */
function getAgentWorkspace(): string {
  const documentsPath = app.getPath('documents');
  const workspace = path.join(documentsPath, 'Pocket-agent');

  // Verify the Documents path is actually reachable on disk.
  // On macOS with iCloud Drive, ~/Documents can be a symlink to
  // ~/Library/Mobile Documents/com~apple~CloudDocs/Documents/ which may
  // not exist if iCloud hasn't fully set up or the symlink is broken.
  try {
    fs.mkdirSync(workspace, { recursive: true });
    return workspace;
  } catch {
    // Documents path is unreachable — fall back to Electron's userData directory
    // (~/Library/Application Support/pocket-agent/ on macOS)
    const fallback = path.join(app.getPath('userData'), 'workspace');
    console.warn(
      `[Main] Documents path unreachable (${documentsPath}), using fallback: ${fallback}`
    );
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

/**
 * Migrate identity.md content into personalize.* SQLite settings.
 * One-time migration: parses agent name from heading, extracts personality sections,
 * migrates profile.custom to personalize.world, renames identity.md to .migrated.
 */
function migratePersonalizeFromIdentity(): void {
  if (SettingsManager.get('personalize._migrated')) return;

  const workspace = getAgentWorkspace();
  const identityPath = path.join(workspace, 'identity.md');

  try {
    if (fs.existsSync(identityPath)) {
      const content = fs.readFileSync(identityPath, 'utf-8');

      // Parse agent name from "# Name" heading
      const nameMatch = content.match(/^#\s+(.+?)(?:\s+the\s+\w+)?$/m);
      if (nameMatch) {
        const rawName = nameMatch[1].trim();
        // Only set if it differs from default
        if (rawName && rawName !== 'Franky the Cat') {
          SettingsManager.set('personalize.agentName', rawName);
          console.log(`[Migration] Set agent name: ${rawName}`);
        }
      }

      // Extract personality: everything from ## Vibe through ## Don't section
      const vibeMatch = content.match(/## Vibe[\s\S]*?(?=\n##[^#]|$)/);
      const dontMatch = content.match(/## Don't[\s\S]*?(?=\n##[^#]|$)/);
      if (vibeMatch || dontMatch) {
        const parts: string[] = [];
        if (vibeMatch) parts.push(vibeMatch[0].trim());
        if (dontMatch) parts.push(dontMatch[0].trim());
        const personality = parts.join('\n\n');
        SettingsManager.set('personalize.personality', personality);
        console.log(`[Migration] Set personality: ${personality.length} chars`);
      }

      // Rename identity.md
      fs.renameSync(identityPath, identityPath + '.migrated');
      console.log('[Migration] Renamed identity.md → identity.md.migrated');
    }

    // Migrate profile.custom → personalize.funFacts
    const profileCustom = SettingsManager.get('profile.custom');
    if (profileCustom) {
      SettingsManager.set('personalize.funFacts', profileCustom);
      SettingsManager.delete('profile.custom');
      console.log(
        `[Migration] Moved profile.custom → personalize.funFacts: ${profileCustom.length} chars`
      );
    }

    // Migrate old personalize.world (from earlier migration) → personalize.funFacts
    const oldWorld = SettingsManager.get('personalize.world');
    if (oldWorld) {
      const existing = SettingsManager.get('personalize.funFacts');
      SettingsManager.set(
        'personalize.funFacts',
        existing ? `${existing}\n\n${oldWorld}` : oldWorld
      );
      SettingsManager.delete('personalize.world');
      console.log(
        `[Migration] Moved personalize.world → personalize.funFacts: ${oldWorld.length} chars`
      );
    }
  } catch (err) {
    console.error('[Migration] Personalize migration failed:', err);
  }

  // Set flag regardless of success to prevent re-running
  SettingsManager.set('personalize._migrated', 'true');
  console.log('[Migration] Personalize migration complete');
}

/**
 * Ensure the agent workspace directory exists.
 * Creates it if missing (on first run, after onboarding, or if deleted).
 * Sets up .claude/commands for workflow commands.
 */
function ensureAgentWorkspace(): string {
  const workspace = getAgentWorkspace();
  const currentVersion = app.getVersion();
  const versionFile = path.join(workspace, '.pocket-version');

  if (!fs.existsSync(workspace)) {
    console.log('[Main] Creating agent workspace:', workspace);
    fs.mkdirSync(workspace, { recursive: true });
  }

  // Check if app version changed (update occurred)
  let isVersionUpdate = false;

  if (fs.existsSync(versionFile)) {
    const previousVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    if (previousVersion !== currentVersion) {
      isVersionUpdate = true;
      console.log(`[Main] App updated from v${previousVersion} to v${currentVersion}`);
    }
  } else {
    // First install or version file missing - treat as update to populate files
    isVersionUpdate = true;
    console.log(`[Main] First install or version file missing, will populate config files`);
  }

  // Repopulate config files on version update
  if (isVersionUpdate) {
    const backupDir = path.join(workspace, '.backups');

    // Create backup directory
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // identity.md and CLAUDE.md are no longer managed here.
    // Personalize settings are in SQLite. Coder mode generates its own CLAUDE.md per session.

    // Populate default workflow commands
    // If .claude is a symlink (or broken symlink) from a previous install, replace it with a real directory.
    // Use lstatSync instead of existsSync because existsSync follows symlinks and returns
    // false for broken symlinks, which would skip cleanup and cause ENOENT on mkdir.
    const workspaceClaudeDirForCmds = path.join(workspace, '.claude');
    let claudeDirExists = false;
    let claudeDirIsSymlink = false;
    try {
      const stat = fs.lstatSync(workspaceClaudeDirForCmds);
      claudeDirExists = true;
      claudeDirIsSymlink = stat.isSymbolicLink();
    } catch {
      // Doesn't exist at all — that's fine
    }

    if (claudeDirExists && claudeDirIsSymlink) {
      // Preserve any user-created commands from the symlink target before replacing
      const symlinkCommandsDir = path.join(workspaceClaudeDirForCmds, 'commands');
      const preservedCommands: Array<{ name: string; content: string }> = [];
      if (fs.existsSync(symlinkCommandsDir)) {
        const defaultFilenames = new Set(DEFAULT_COMMANDS.map((c) => c.filename));
        for (const file of fs.readdirSync(symlinkCommandsDir).filter((f) => f.endsWith('.md'))) {
          if (!defaultFilenames.has(file)) {
            preservedCommands.push({
              name: file,
              content: fs.readFileSync(path.join(symlinkCommandsDir, file), 'utf-8'),
            });
          }
        }
      }
      fs.unlinkSync(workspaceClaudeDirForCmds);
      fs.mkdirSync(workspaceClaudeDirForCmds, { recursive: true });
      console.log('[Main] Replaced .claude symlink with real directory for commands');
      // Restore preserved user commands
      if (preservedCommands.length > 0) {
        const restoredDir = path.join(workspaceClaudeDirForCmds, 'commands');
        fs.mkdirSync(restoredDir, { recursive: true });
        for (const cmd of preservedCommands) {
          fs.writeFileSync(path.join(restoredDir, cmd.name), cmd.content);
        }
        console.log(`[Main] Preserved ${preservedCommands.length} user workflow command(s)`);
      }
    }
    const commandsDir = path.join(workspaceClaudeDirForCmds, 'commands');
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
    }
    // Only write defaults — never delete existing user commands
    for (const cmd of DEFAULT_COMMANDS) {
      fs.writeFileSync(path.join(commandsDir, cmd.filename), cmd.content);
    }
    console.log(`[Main] Populated ${DEFAULT_COMMANDS.length} default workflow command(s)`);

    // Mark onboarding as completed for existing users who already have keys
    // (prevents re-triggering onboarding after updating to the embedded version)
    if (
      SettingsManager.hasRequiredKeys() &&
      SettingsManager.get('onboarding.completed') !== 'true'
    ) {
      SettingsManager.set('onboarding.completed', 'true');
      console.log('[Main] Marked onboarding as completed for existing user');
    }

    // Clear saved window bounds so updated default dimensions take effect.
    // Users' custom sizes will be re-saved on next window move/resize.
    SettingsManager.delete('window.chatBounds');
    SettingsManager.delete('window.cronBounds');
    SettingsManager.delete('window.settingsBounds');
    SettingsManager.delete('window.customizeBounds');
    SettingsManager.delete('window.factsBounds');
    SettingsManager.delete('window.dailyLogsBounds');
    SettingsManager.delete('window.soulBounds');
    console.log('[Main] Cleared saved window bounds for fresh layout');

    // Update version file
    fs.writeFileSync(versionFile, currentVersion);
    console.log(`[Main] Updated version file to v${currentVersion}`);
  }

  // Clean up legacy .claude/skills folder (no longer used)
  const workspaceClaudeDir = path.join(workspace, '.claude');
  if (fs.existsSync(workspaceClaudeDir)) {
    const workspaceSkillsDir = path.join(workspaceClaudeDir, 'skills');
    try {
      if (fs.existsSync(workspaceSkillsDir)) {
        const stats = fs.lstatSync(workspaceSkillsDir);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(workspaceSkillsDir);
        } else {
          fs.rmSync(workspaceSkillsDir, { recursive: true, force: true });
        }
        console.log('[Main] Removed legacy .claude/skills folder');
      }
    } catch (err) {
      console.warn('[Main] Failed to remove legacy .claude/skills:', err);
    }
  }

  return workspace;
}

// ============ Splash Screen ============

function showSplashScreen(): void {
  console.log('[Main] Showing splash screen...');

  // Get primary display for proper centering
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const splashWidth = 650;
  const splashHeight = 200;

  splashWindow = new BrowserWindow({
    width: splashWidth,
    height: splashHeight,
    x: Math.round((screenWidth - splashWidth) / 2),
    y: Math.round((screenHeight - splashHeight) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'splash-preload.js'),
    },
  });

  splashWindow.loadFile(path.join(__dirname, '../../ui/splash.html'));

  splashWindow.on('closed', () => {
    splashWindow = null;
  });

  // Safety timeout - force close splash after 5 seconds if IPC fails
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      console.log('[Main] Safety timeout: force-closing splash screen');
      closeSplashScreen();
    }
  }, 5000);
}

function closeSplashScreen(): void {
  console.log('[Main] closeSplashScreen called, splashWindow exists:', !!splashWindow);
  if (splashWindow && !splashWindow.isDestroyed()) {
    console.log('[Main] Closing splash window...');
    splashWindow.close();
    splashWindow = null;
    console.log('[Main] Splash window closed');
  }
}

// ============ Windows ============

function openChatWindow(): void {
  const win = createWindow({
    id: WIN.CHAT,
    title: `Pocket Agent v${app.getVersion()}`,
    htmlFile: 'chat.html',
    width: 1020,
    height: 720,
    boundsKey: 'window.chatBounds',
    onClosed: () => setChatWindow(null),
  });
  setChatWindow(win);
}

function openCronWindow(): void {
  createWindow({
    id: WIN.CRON,
    title: 'My Routines - Pocket Agent',
    htmlFile: 'cron.html',
    width: 700,
    height: 500,
    boundsKey: 'window.cronBounds',
  });
}

function openSettingsWindow(tab?: string): void {
  // Open settings panel inside the chat window instead of a separate modal
  const chatWin = getWindow(WIN.CHAT);
  if (chatWin) {
    chatWin.show();
    chatWin.focus();
    chatWin.webContents.send('open-settings', tab);
    // Connect updater to chat window for status updates
    setSettingsWindow(chatWin);
  }
}

function openCustomizeWindow(): void {
  createWindow({
    id: WIN.CUSTOMIZE,
    title: 'Make It Yours - Pocket Agent',
    htmlFile: 'customize.html',
    width: 800,
    height: 650,
    boundsKey: 'window.customizeBounds',
  });
}

function openFactsWindow(): void {
  createWindow({
    id: WIN.FACTS,
    title: 'My Brain - Pocket Agent',
    htmlFile: 'facts.html',
    width: 700,
    height: 550,
    boundsKey: 'window.factsBounds',
  });
}

function openDailyLogsWindow(): void {
  createWindow({
    id: WIN.DAILY_LOGS,
    title: 'Daily Logs - Pocket Agent',
    htmlFile: 'daily-logs.html',
    width: 700,
    height: 550,
    boundsKey: 'window.dailyLogsBounds',
  });
}

function openSoulWindow(): void {
  createWindow({
    id: WIN.SOUL,
    title: 'My Approach - Pocket Agent',
    htmlFile: 'soul.html',
    width: 700,
    height: 550,
    boundsKey: 'window.soulBounds',
  });
}

function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// ============ IPC Handlers ============

/**
 * Build the shared dependency container for IPC modules.
 * Uses getter functions so modules always read the latest mutable global values.
 */
function buildIPCDeps(): IPCDependencies {
  return {
    getMemory: () => memory,
    getScheduler: () => scheduler,
    getTelegramBot: () => telegramBot,
    getIosChannel: () => iosChannel,
    setIosChannel: (ch) => {
      iosChannel = ch;
    },
    setTelegramBot: (bot) => {
      telegramBot = bot;
    },
    getAgentHomeChannel: () => agentHomeChannel,
    setAgentHomeChannel: (ch) => {
      agentHomeChannel = ch;
    },
    updateTrayMenu,
    initializeAgent,
    restartAgent,
    openChatWindow,
    openSettingsWindow,
    openCronWindow,
    openCustomizeWindow,
    openFactsWindow,
    openDailyLogsWindow,
    openSoulWindow,
    closeSplashScreen,
    WIN,
  };
}

function setupIPC(): void {
  const deps = buildIPCDeps();
  registerAgentIPC(deps);
  registerSessionsIPC(deps);
  registerSettingsIPC(deps);
  registerFactsIPC(deps);
  registerCronIPC(deps);
  registerIosIPC(deps);
  registerAgentHomeIPC(deps);
  registerMiscIPC(deps);
}

// ============ Agent Lifecycle ============

async function initializeAgent(): Promise<void> {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'pocket-agent.db');

  // Check if we have required API keys
  if (!SettingsManager.hasRequiredKeys()) {
    console.log('[Main] No API keys configured, skipping agent initialization');
    return;
  }

  // Project root (where CLAUDE.md and CLI tools live)
  const projectRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '../..');

  // Agent workspace (isolated working directory for file operations)
  const workspace = ensureAgentWorkspace();

  // Initialize memory (if not already done)
  if (!memory) {
    memory = new MemoryManager(dbPath);
  }

  // Initialize embeddings if OpenAI key is available
  const openaiKey = SettingsManager.get('openai.apiKey');
  if (openaiKey) {
    memory.initializeEmbeddings(openaiKey);
    console.log('[Main] Embeddings enabled with OpenAI');
  } else {
    console.log('[Main] Embeddings disabled (no OpenAI API key)');
  }

  // Build tools config from settings
  const toolsConfig = {
    mcpServers: {},
    computerUse: {
      enabled: false,
      dockerized: true,
      displaySize: { width: 1920, height: 1080 },
    },
    browser: {
      enabled: SettingsManager.getBoolean('browser.enabled'),
      cdpUrl: SettingsManager.get('browser.cdpUrl') || 'http://localhost:9222',
    },
  };

  // Resolve model — ensure the selected model has a matching API key.
  // If not (e.g. default is claude-* but only a Kimi/GLM key exists), fall back.
  let model = SettingsManager.get('agent.model') || 'claude-opus-4-6';
  const hasAnthropicKey = !!SettingsManager.get('anthropic.apiKey');
  const hasOAuth =
    SettingsManager.get('auth.method') === 'oauth' && !!SettingsManager.get('auth.oauthToken');
  const hasMoonshotKey = !!SettingsManager.get('moonshot.apiKey');
  const hasGlmKey = !!SettingsManager.get('glm.apiKey');

  const isAnthropicModel = model.startsWith('claude-');
  const isMoonshotModel = model.startsWith('kimi-');
  const isGlmModel = model.startsWith('glm-');

  const needsFallback =
    (isAnthropicModel && !hasAnthropicKey && !hasOAuth) ||
    (isMoonshotModel && !hasMoonshotKey) ||
    (isGlmModel && !hasGlmKey);

  if (needsFallback) {
    const oldModel = model;
    if (hasAnthropicKey || hasOAuth) {
      model = 'claude-opus-4-6';
    } else if (hasMoonshotKey) {
      model = 'kimi-k2.5';
    } else if (hasGlmKey) {
      model = 'glm-4.7';
    }
    console.log(`[Main] Model/key mismatch: ${oldModel} has no key, falling back to ${model}`);
    SettingsManager.set('agent.model', model);
  }

  // Initialize agent with tools config
  AgentManager.initialize({
    memory,
    projectRoot,
    workspace, // Isolated working directory for agent file operations
    dataDir: app.getPath('userData'),
    model,
    tools: toolsConfig,
  });

  // Listen for model changes and broadcast to UI
  // Remove previous listener to prevent stacking on re-init
  if (modelChangedHandler) {
    AgentManager.off('model:changed', modelChangedHandler);
  }
  modelChangedHandler = (model: string) => {
    if (getWindow(WIN.CHAT)) {
      getWindow(WIN.CHAT)?.webContents.send('model:changed', model);
    }
    if (getWindow(WIN.SETTINGS)) {
      getWindow(WIN.SETTINGS)?.webContents.send('model:changed', model);
    }
  };
  AgentManager.on('model:changed', modelChangedHandler);

  // Forward session mode changes (from switch_agent tool) to chat window
  AgentManager.on(
    'sessionModeChanged',
    (sessionId: string, newMode: string, _icon: string, _name: string) => {
      if (getWindow(WIN.CHAT)) {
        getWindow(WIN.CHAT)?.webContents.send('agent:sessionModeChanged', sessionId, newMode);
      }
    }
  );

  // Initialize iOS channel (WebSocket server for mobile companion app)
  // Must be initialized BEFORE scheduler so push notifications work for jobs that fire during init
  const iosEnabled = SettingsManager.getBoolean('ios.enabled');
  console.log('[Main] iOS channel enabled:', iosEnabled);
  if (iosEnabled) {
    try {
      iosChannel = createiOSChannel();

      if (iosChannel) {
        // Wire up all iOS channel handlers using the shared helper
        wireIosChannelHandlers(buildIPCDeps());

        await iosChannel.start();
        const mode = iosChannel.getMode();
        if (mode === 'relay') {
          console.log(
            `[Main] iOS channel started (relay, instance: ${iosChannel.getInstanceId()})`
          );
        } else {
          console.log(`[Main] iOS channel started (local, port: ${iosChannel.getPort()})`);
        }
      }
    } catch (error) {
      console.error('[Main] iOS channel failed:', error);
    }
  }

  // Initialize Agent Home channel
  const agentHomeEnabled = SettingsManager.getBoolean('agentHome.enabled');
  console.log('[Main] Agent Home channel enabled:', agentHomeEnabled);
  if (agentHomeEnabled) {
    try {
      agentHomeChannel = createAgentHomeChannel();
      if (agentHomeChannel) {
        wireAgentHomeChannelHandlers(buildIPCDeps());
        await agentHomeChannel.start();
        console.log('[Main] Agent Home channel started');
      }
    } catch (error) {
      console.error('[Main] Agent Home channel failed:', error);
    }
  }

  // Initialize scheduler
  if (SettingsManager.getBoolean('scheduler.enabled')) {
    scheduler = createScheduler();

    // Set all handlers BEFORE initialize() — jobs can fire during init
    scheduler.setNotificationHandler((title: string, body: string) => {
      showNotification(title, body);
    });

    scheduler.setChatHandler(
      (jobName: string, prompt: string, response: string, sessionId: string) => {
        console.log(`[Scheduler] Sending chat message for job: ${jobName} (session: ${sessionId})`);
        if (getWindow(WIN.CHAT)) {
          getWindow(WIN.CHAT)?.webContents.send('scheduler:message', {
            jobName,
            prompt,
            response,
            sessionId,
          });
        } else {
          // Window not open — open it. loadHistory() on init will pick up
          // the message from the database, so no need to send via IPC.
          openChatWindow();
        }
      }
    );

    scheduler.setIOSSyncHandler(
      (jobName: string, prompt: string, response: string, sessionId: string) => {
        if (iosChannel) {
          // WebSocket broadcast (reaches connected/foregrounded devices)
          iosChannel.broadcast({
            type: 'scheduler',
            jobName,
            prompt,
            response,
            sessionId,
            timestamp: new Date().toISOString(),
          });
          // Push notification (reaches backgrounded/closed devices)
          iosChannel
            .sendPushNotifications(jobName, response, { sessionId, jobName, type: 'scheduler' })
            .catch((err) => console.error('[Scheduler→iOS] Push failed:', err));
        }
      }
    );

    await scheduler.initialize(memory, dbPath);

    // Set up birthday reminders if birthday is configured
    const birthday = SettingsManager.get('profile.birthday');
    if (birthday) {
      await setupBirthdayCronJobs(birthday, scheduler);
    }
  }

  // Initialize Telegram
  const telegramEnabled = SettingsManager.getBoolean('telegram.enabled');
  const telegramToken = SettingsManager.get('telegram.botToken');

  if (telegramEnabled && telegramToken) {
    try {
      telegramBot = createTelegramBot();

      if (!telegramBot) {
        console.error('[Main] Telegram bot creation failed');
      } else {
        // Set up cross-channel sync: Telegram -> Desktop
        // Only send to chat window if it's already open - don't force open or notify
        telegramBot.setOnMessageCallback((data) => {
          // Only sync to desktop UI if chat window is already open
          if (getWindow(WIN.CHAT)) {
            getWindow(WIN.CHAT)?.webContents.send('telegram:message', {
              userMessage: data.userMessage,
              response: data.response,
              chatId: data.chatId,
              sessionId: data.sessionId,
              hasAttachment: data.hasAttachment,
              attachmentType: data.attachmentType,
              wasCompacted: data.wasCompacted,
              media: data.media,
            });
          }
          // Messages are already saved to SQLite, so they'll appear when user opens chat
        });

        // Notify UI when Telegram session links change
        telegramBot.setOnSessionLinkCallback(() => {
          if (getWindow(WIN.CHAT)) {
            getWindow(WIN.CHAT)?.webContents.send('sessions:changed');
          }
        });

        await telegramBot.start();

        if (scheduler) {
          scheduler.setTelegramBot(telegramBot);
        }

        console.log('[Main] Telegram started');
      }
    } catch (error) {
      console.error('[Main] Telegram failed:', error);
    }
  }

  console.log('[Main] Pocket Agent initialized');
  updateTrayMenu();
}

async function stopAgent(): Promise<void> {
  if (iosChannel) {
    await iosChannel.stop();
    iosChannel = null;
  }
  if (telegramBot) {
    await telegramBot.stop();
    telegramBot = null;
  }
  if (scheduler) {
    scheduler.stopAll();
    scheduler = null;
  }
  // Cleanup browser resources
  AgentManager.cleanup();
  console.log('[Main] Agent stopped');
  updateTrayMenu();
}

async function restartAgent(): Promise<void> {
  await stopAgent();
  await initializeAgent();
}

// ============ App Lifecycle ============

app.whenReady().then(async () => {
  console.log('[Main] App ready, starting initialization...');

  try {
    // Show splash screen immediately
    showSplashScreen();

    // === Power Management ===
    // Let macOS manage power naturally — App Nap may coalesce timers by a few
    // seconds when the app is in the background, which is fine for minute-level
    // cron jobs.  node-cron and setInterval still fire reliably without
    // powerSaveBlocker.  Removing the blocker allows the system to downclock
    // and avoids unnecessary fan spin-up on idle.

    // Handle system suspend/resume (actual sleep)
    powerMonitor.on('suspend', () => {
      console.log('[Power] System suspending (sleep)');
    });

    powerMonitor.on('resume', () => {
      console.log('[Power] System resumed from sleep');
      // Force CDP reconnection — WebSocket is dead after sleep
      getBrowserManager()
        .forceReconnectCdp()
        .catch((err) => {
          console.warn('[Power] CDP reconnect after resume failed:', err);
        });
      // Force iOS relay reconnection — WebSocket is dead after sleep
      if (iosChannel) {
        iosChannel.forceReconnect().catch((err) => {
          console.warn('[Power] iOS relay reconnect after resume failed:', err);
        });
      }
    });

    // Handle lock screen (display off but CPU running)
    powerMonitor.on('lock-screen', () => {
      console.log('[Power] Screen locked');
    });

    powerMonitor.on('unlock-screen', () => {
      console.log('[Power] Screen unlocked');
      // Force CDP reconnection — connection may have gone stale during lock
      getBrowserManager()
        .forceReconnectCdp()
        .catch((err) => {
          console.warn('[Power] CDP reconnect after unlock failed:', err);
        });
      // Force iOS relay reconnection — connection may have gone stale during lock
      if (iosChannel) {
        iosChannel.forceReconnect().catch((err) => {
          console.warn('[Power] iOS relay reconnect after unlock failed:', err);
        });
      }
    });

    // Set Dock icon on macOS
    if (process.platform === 'darwin') {
      const dockIconPath = path.join(__dirname, '../../assets/icon.png');
      if (fs.existsSync(dockIconPath)) {
        app.dock?.setIcon(dockIconPath);
      }
    }

    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'pocket-agent.db');
    console.log('[Main] DB path:', dbPath);

    // Initialize settings first (uses same DB)
    console.log('[Main] Initializing settings...');
    SettingsManager.initialize(dbPath);

    // Migrate from old config.json if it exists
    const oldConfigPath = path.join(userDataPath, 'config.json');
    await SettingsManager.migrateFromConfig(oldConfigPath);
    console.log('[Main] Settings initialized');

    // Migrate identity.md → personalize settings (one-time)
    migratePersonalizeFromIdentity();

    // Initialize memory (shared with settings)
    console.log('[Main] Initializing memory...');
    memory = new MemoryManager(dbPath);
    console.log('[Main] Memory initialized');

    setupIPC();
    setupUpdaterIPC();
    console.log('[Main] Creating tray...');
    initTray({
      openChatWindow,
      openSettingsWindow,
      restartAgent,
      showNotification,
    });
    await createTray();
    console.log('[Main] Tray created');

    // Initialize auto-updater (only in packaged app)
    if (app.isPackaged) {
      initializeUpdater();
      console.log('[Main] Auto-updater initialized');
    }

    // Register global shortcut (Alt+Z on all platforms — maps to Option+Z on macOS)
    const shortcut = 'Alt+Z';
    const registered = globalShortcut.register(shortcut, () => {
      openChatWindow();
    });
    if (registered) {
      console.log(`[Main] Global shortcut ${shortcut} registered`);
    } else {
      console.warn(`[Main] Failed to register global shortcut ${shortcut}`);
    }

    // Run workspace setup and version migration unconditionally — this handles
    // window bounds reset, onboarding fix, and config file updates regardless
    // of whether the agent will be initialized (isFirstRun may skip initializeAgent).
    ensureAgentWorkspace();

    // Initialize agent if not first run (window will be shown after splash completes)
    if (!SettingsManager.isFirstRun()) {
      console.log('[Main] Initializing agent...');
      await initializeAgent();
    }

    // Tray menu is updated event-driven (after messages, cron changes, etc.)
    // No polling needed — updateTrayMenu() is called directly by IPC handlers
  } catch (error) {
    console.error('[Main] FATAL ERROR during initialization:', error);
  }
});

app.on('window-all-closed', () => {
  // Keep running (tray app)
});

app.on('activate', () => {
  // macOS: clicking Dock icon opens chat window
  openChatWindow();
});

app.on('before-quit', async () => {
  if (app.isReady()) {
    globalShortcut.unregisterAll(); // Clean up global shortcuts
  }
  if (modelChangedHandler) {
    AgentManager.off('model:changed', modelChangedHandler);
    modelChangedHandler = null;
  }
  await stopAgent();
  if (memory) {
    memory.close();
  }
  SettingsManager.close();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openChatWindow();
  });
}
