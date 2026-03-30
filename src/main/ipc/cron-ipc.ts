import { ipcMain } from 'electron';
import type { IPCDependencies } from './types';
import { AgentManager } from '../../agent';
import { getWindow } from '../windows';

export function registerCronIPC(deps: IPCDependencies): void {
  const { getScheduler, getIosChannel, updateTrayMenu, WIN } = deps;

  ipcMain.handle('cron:list', async () => {
    return getScheduler()?.getAllJobs() || [];
  });

  ipcMain.handle(
    'cron:create',
    async (
      _,
      name: string,
      schedule: string,
      prompt: string,
      channel: string,
      sessionId: string
    ) => {
      const scheduler = getScheduler();
      const success = await scheduler?.createJob(
        name,
        schedule,
        prompt,
        channel,
        sessionId || 'default'
      );
      updateTrayMenu();
      // Notify iOS of updated routines
      const iosChannel = getIosChannel();
      if (iosChannel) {
        iosChannel.broadcast({ type: 'routines', jobs: scheduler?.getAllJobs() || [] });
      }
      return { success };
    }
  );

  ipcMain.handle('cron:delete', async (_, name: string) => {
    const scheduler = getScheduler();
    const success = scheduler?.deleteJob(name);
    updateTrayMenu();
    // Notify iOS of updated routines
    const iosChannel = getIosChannel();
    if (success && iosChannel) {
      iosChannel.broadcast({ type: 'routines', jobs: scheduler?.getAllJobs() || [] });
    }
    return { success };
  });

  ipcMain.handle('cron:toggle', async (_, name: string, enabled: boolean) => {
    const scheduler = getScheduler();
    const success = scheduler?.setJobEnabled(name, enabled);
    updateTrayMenu();
    // Notify iOS of updated routines
    const iosChannel = getIosChannel();
    if (success && iosChannel) {
      iosChannel.broadcast({ type: 'routines', jobs: scheduler?.getAllJobs() || [] });
    }
    return { success };
  });

  ipcMain.handle('cron:run', async (_, name: string) => {
    const scheduler = getScheduler();
    if (!scheduler) return null;

    // Look up the job to get its sessionId
    const allJobs = scheduler.getAllJobs();
    const job = allJobs.find((j) => j.name === name);
    const sessionId = job?.session_id || 'default';

    // Resolve the internal sessionId used by the scheduler's executeJob
    // (ScheduledJob.sessionId may differ from the DB's session_id)
    const scheduledJob = scheduler.getJobs().find((j) => j.name === name);
    const internalSessionId = scheduledJob?.sessionId || 'default';

    // Notify chat window that a routine test is starting
    const chatWindow = getWindow(WIN.CHAT);
    if (chatWindow && !chatWindow.webContents.isDestroyed()) {
      chatWindow.webContents.send('cron:testing', { name, sessionId });
    }

    // Forward agent status events to chat window during execution
    const statusHandler = (status: {
      type: string;
      sessionId?: string;
      [key: string]: unknown;
    }) => {
      // Only forward events from this cron job's internal session (avoid duplicating
      // events from concurrent user messages on a different session)
      if (status.sessionId && status.sessionId !== internalSessionId) return;

      // Override sessionId so the chat UI accepts this event for the current session
      const forwarded = { ...status, sessionId };
      if (chatWindow && !chatWindow.webContents.isDestroyed()) {
        chatWindow.webContents.send('agent:status', forwarded);
      }
    };

    AgentManager.on('status', statusHandler);

    try {
      const result = await scheduler.runJobNow(name);

      // If the job failed, notify the UI so the thinking indicator is cleaned up
      if (result && !result.success && chatWindow && !chatWindow.webContents.isDestroyed()) {
        chatWindow.webContents.send('agent:status', { type: 'done', sessionId });
      }

      return result;
    } finally {
      AgentManager.off('status', statusHandler);
    }
  });

  ipcMain.handle('cron:history', async (_, limit: number = 20) => {
    return getScheduler()?.getHistory(limit) || [];
  });
}
