import { ipcMain } from 'electron';
import { AgentManager } from '../../agent';
import { SettingsManager, SETTINGS_SCHEMA } from '../../settings';
import { THEMES } from '../../settings/themes';
import { createTelegramBot } from '../../channels/telegram';
import { getWindow, getAllWindows } from '../windows';
import { setupBirthdayCronJobs } from '../birthday';
import type { IPCDependencies } from './types';

/**
 * Get available models based on configured API keys.
 * Exported so other IPC modules (e.g. ios-ipc) can reuse it.
 */
export function getAvailableModels(): Array<{ id: string; name: string; provider: string }> {
  const models: Array<{ id: string; name: string; provider: string }> = [];
  const authMethod = SettingsManager.get('auth.method');
  const hasOAuth = authMethod === 'oauth' && SettingsManager.get('auth.oauthToken');
  const hasAnthropicKey = SettingsManager.get('anthropic.apiKey');
  if (hasOAuth || hasAnthropicKey) {
    models.push(
      { id: 'claude-opus-4-6', name: 'Opus 4.6', provider: 'anthropic' },
      { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', provider: 'anthropic' },
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', provider: 'anthropic' }
    );
  }
  const hasMoonshotKey = SettingsManager.get('moonshot.apiKey');
  if (hasMoonshotKey) {
    models.push({ id: 'kimi-k2.5', name: 'Kimi K2.5', provider: 'moonshot' });
  }
  const hasGlmKey = SettingsManager.get('glm.apiKey');
  if (hasGlmKey) {
    models.push(
      { id: 'glm-5.1', name: 'GLM 5.1', provider: 'glm' },
      { id: 'glm-5-turbo', name: 'GLM 5 Turbo', provider: 'glm' },
      { id: 'glm-4.7', name: 'GLM 4.7', provider: 'glm' }
    );
  }

  return models;
}

export function registerSettingsIPC(deps: IPCDependencies): void {
  const { getScheduler, getIosChannel, setTelegramBot, getTelegramBot, WIN } = deps;

  // Keys that are encrypted but must be accessible from the renderer
  const RENDERER_ALLOWED_ENCRYPTED_KEYS = new Set(['chat.adminKey']);

  ipcMain.handle('settings:getAll', async () => {
    return SettingsManager.getAllSafe();
  });

  ipcMain.handle('settings:getThemes', async () => {
    return THEMES;
  });

  ipcMain.handle('settings:getSkin', async () => {
    return SettingsManager.get('ui.skin') || 'default';
  });

  ipcMain.handle('settings:get', async (_, key: string) => {
    // Block encrypted settings from being sent to renderer (except explicitly allowed ones)
    const def = SETTINGS_SCHEMA.find((s) => s.key === key);
    if (def?.encrypted && !RENDERER_ALLOWED_ENCRYPTED_KEYS.has(key)) {
      const value = SettingsManager.get(key);
      return value ? '••••••••' : '';
    }
    return SettingsManager.get(key);
  });

  ipcMain.handle('settings:set', async (_, key: string, value: string) => {
    try {
      SettingsManager.set(key, value);

      // Auto-setup birthday cron jobs when birthday is set
      if (key === 'profile.birthday') {
        await setupBirthdayCronJobs(value, getScheduler());
      }

      // Notify iOS when model changes
      const iosChannel = getIosChannel();
      if (key === 'agent.model' && iosChannel) {
        iosChannel.broadcast({
          type: 'models',
          models: getAvailableModels(),
          activeModelId: value,
        });
      }

      // Notify iOS when mode changes (desktop toggle)
      if (key === 'agent.mode' && iosChannel) {
        iosChannel.broadcast({ type: 'mode', mode: value, locked: false });
      }

      // Broadcast skin change to all open windows + iOS
      if (key === 'ui.skin') {
        for (const win of getAllWindows()) {
          win.webContents.send('skin:changed', value);
        }
        if (iosChannel) {
          iosChannel.broadcast({ type: 'skin:changed', skinId: value });
        }
      }

      // Broadcast chat username change to chat window — no restart required
      if (key === 'chat.username' && getWindow(WIN.CHAT)) {
        getWindow(WIN.CHAT)?.webContents.send('chat:usernameChanged', value);
      }

      // Instant Telegram toggle — no restart required
      if (key === 'telegram.enabled') {
        const enabled = value === 'true' || value === '1';
        if (enabled) {
          const token = SettingsManager.get('telegram.botToken');
          if (!getTelegramBot() && token) {
            const bot = createTelegramBot();
            if (bot) {
              bot.setOnMessageCallback((data) => {
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
              });
              bot.setOnSessionLinkCallback(() => {
                if (getWindow(WIN.CHAT)) {
                  getWindow(WIN.CHAT)?.webContents.send('sessions:changed');
                }
              });
              await bot.start();
              setTelegramBot(bot);
              const scheduler = getScheduler();
              if (scheduler) scheduler.setTelegramBot(bot);
              console.log('[Main] Telegram started (live toggle)');
            }
          }
        } else {
          const telegramBot = getTelegramBot();
          if (telegramBot) {
            await telegramBot.stop();
            setTelegramBot(null);
            const scheduler = getScheduler();
            if (scheduler) scheduler.setTelegramBot(null);
            console.log('[Main] Telegram stopped (live toggle)');
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('settings:delete', async (_, key: string) => {
    const success = SettingsManager.delete(key);
    return { success };
  });

  ipcMain.handle('settings:schema', async (_, category?: string) => {
    return SettingsManager.getSchema(category);
  });

  ipcMain.handle('settings:isFirstRun', async () => {
    return SettingsManager.isFirstRun();
  });

  ipcMain.handle('settings:resetOnboarding', async () => {
    SettingsManager.resetOnboarding();
    return { success: true };
  });

  ipcMain.handle('settings:initializeKeychain', async () => {
    return SettingsManager.initializeKeychain();
  });

  // Validation handlers
  ipcMain.handle('settings:validateAnthropic', async (_, key: string) => {
    return SettingsManager.validateAnthropicKey(key);
  });

  ipcMain.handle('settings:validateOpenAI', async (_, key: string) => {
    return SettingsManager.validateOpenAIKey(key);
  });

  ipcMain.handle('settings:validateTelegram', async (_, token: string) => {
    return SettingsManager.validateTelegramToken(token);
  });

  ipcMain.handle('settings:validateMoonshot', async (_, key: string) => {
    return SettingsManager.validateMoonshotKey(key);
  });

  ipcMain.handle('settings:validateGlm', async (_, key: string) => {
    return SettingsManager.validateGlmKey(key);
  });

  ipcMain.handle('settings:getAvailableModels', async () => {
    return getAvailableModels();
  });

  // Customize - System prompt (read-only, developer-controlled content only)
  ipcMain.handle('customize:getSystemPrompt', async () => {
    return AgentManager.getDeveloperPrompt() || '';
  });

  // Customize - Agent modes (read-only, for system prompt tab)
  ipcMain.handle('customize:getAgentModes', async () => {
    const { getAllModes } = await import('../../agent/agent-modes.js');
    return getAllModes().map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      systemPrompt: m.systemPrompt,
      description: m.description,
    }));
  });

  // Location and timezone lookup
  ipcMain.handle('location:lookup', async (_, query: string) => {
    if (!query || query.length < 2) return [];
    const cityTimezones = await import('city-timezones');
    const results = cityTimezones.lookupViaCity(query);
    return results
      .slice(0, 10)
      .map((r: { city: string; country: string; timezone: string; province?: string }) => ({
        city: r.city,
        country: r.country,
        province: r.province || '',
        timezone: r.timezone,
        display: r.province ? `${r.city}, ${r.province}, ${r.country}` : `${r.city}, ${r.country}`,
      }));
  });

  ipcMain.handle('timezone:list', async () => {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');
      return timezones;
    } catch {
      return [
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Toronto',
        'America/Vancouver',
        'America/Mexico_City',
        'America/Sao_Paulo',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Europe/Rome',
        'Europe/Madrid',
        'Europe/Amsterdam',
        'Europe/Stockholm',
        'Europe/Moscow',
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Asia/Hong_Kong',
        'Asia/Singapore',
        'Asia/Seoul',
        'Asia/Bangkok',
        'Asia/Jakarta',
        'Asia/Kolkata',
        'Asia/Dubai',
        'Asia/Jerusalem',
        'Australia/Sydney',
        'Australia/Melbourne',
        'Australia/Perth',
        'Pacific/Auckland',
        'Pacific/Honolulu',
        'Pacific/Fiji',
        'Africa/Cairo',
        'Africa/Johannesburg',
        'Africa/Lagos',
      ];
    }
  });
}
