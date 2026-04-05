import type { MemoryManager } from '../../memory';
import type { CronScheduler } from '../../scheduler';
import type { TelegramBot } from '../../channels/telegram';
import type { iOSChannel } from '../../channels/ios';
import type { AgentHomeChannel } from '../../channels/agent-home';

/**
 * Dependency container passed to each IPC module.
 *
 * Uses getter functions because the underlying globals are mutable
 * and may be null initially (e.g. before agent initialization).
 */
export interface IPCDependencies {
  getMemory: () => MemoryManager | null;
  getScheduler: () => CronScheduler | null;
  getTelegramBot: () => TelegramBot | null;
  getIosChannel: () => iOSChannel | null;
  setIosChannel: (ch: iOSChannel | null) => void;
  setTelegramBot: (bot: TelegramBot | null) => void;
  getAgentHomeChannel: () => AgentHomeChannel | null;
  setAgentHomeChannel: (ch: AgentHomeChannel | null) => void;

  // Helper functions
  updateTrayMenu: () => void;
  initializeAgent: () => Promise<void>;
  restartAgent: () => Promise<void>;
  openChatWindow: () => void;
  openSettingsWindow: (tab?: string) => void;
  openCronWindow: () => void;
  openCustomizeWindow: () => void;
  openFactsWindow: () => void;
  openDailyLogsWindow: () => void;
  openSoulWindow: () => void;
  closeSplashScreen: () => void;

  /** Window ID constants */
  WIN: {
    readonly CHAT: string;
    readonly CRON: string;
    readonly SETTINGS: string;
    readonly CUSTOMIZE: string;
    readonly FACTS: string;
    readonly DAILY_LOGS: string;
    readonly SOUL: string;
  };
}
