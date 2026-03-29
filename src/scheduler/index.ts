import cron, { ScheduledTask } from 'node-cron';
import Database from 'better-sqlite3';
import { AgentManager } from '../agent';
import { MemoryManager, CronJob } from '../memory';
import type { TelegramBot } from '../channels/telegram';
import { matchesCronField } from '../utils/cron';
import { HEARTBEAT_SUFFIX, isHeartbeatOk } from '../utils/heartbeat';
import { formatForSqlite, checkCalendarEvents, checkTaskReminders } from './calendar';
import {
  stripMarkdown,
  sendToAllChannels,
  type NotificationChannels,
  type NotificationHandler,
  type ChatHandler,
  type IOSSyncHandler,
} from './notifications';

// Re-export for backward compatibility
export { HEARTBEAT_OK } from '../utils/heartbeat';

export interface ScheduledJob {
  id: number;
  name: string;
  scheduleType?: 'cron' | 'at' | 'every';
  schedule: string | null;
  runAt?: string | null;
  intervalMs?: number | null;
  prompt: string;
  channel: string;
  recipient?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  contextMessages?: number;
  nextRunAt?: string | null;
  sessionId?: string | null;
}

export interface JobResult {
  jobName: string;
  response: string;
  channel: string;
  success: boolean;
  error?: string;
  timestamp: Date;
}

/**
 * CronScheduler - Manages scheduled jobs from SQLite
 *
 * Loads jobs from cron_jobs table, runs them on schedule,
 * calls AgentManager.processMessage() and routes responses.
 */
export class CronScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private jobs: Map<string, ScheduledJob> = new Map();
  private memory: MemoryManager | null = null;
  private telegramBot: TelegramBot | null = null;
  private jobHistory: JobResult[] = [];
  private maxHistorySize: number = 100;
  private reloadInterval: ReturnType<typeof setInterval> | null = null;
  private reminderInterval: ReturnType<typeof setInterval> | null = null;
  private lastJobHash: string = '';
  private dbPath: string | null = null;
  private db: Database.Database | null = null; // Persistent DB connection for reminders
  private isCheckingReminders: boolean = false; // Mutex to prevent overlapping checks

  private onNotification?: NotificationHandler;
  private onChatMessage?: ChatHandler;
  private onIOSSync?: IOSSyncHandler;

  constructor() {}

  /**
   * Build the NotificationChannels object from current state.
   */
  private getChannels(): NotificationChannels {
    return {
      onNotification: this.onNotification,
      onChatMessage: this.onChatMessage,
      onIOSSync: this.onIOSSync,
      telegramBot: this.telegramBot,
      memory: this.memory,
    };
  }

  /**
   * Initialize scheduler with memory manager and load jobs
   */
  async initialize(memory: MemoryManager, dbPath?: string): Promise<void> {
    this.memory = memory;
    this.dbPath = dbPath || null;

    // Open persistent DB connection for reminder checks (avoids creating new connection every 30s)
    // WAL mode allows this connection to see rows inserted by the tool handler's separate connection
    if (this.dbPath) {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
    }

    await this.loadJobsFromDatabase();
    // Hash all jobs to detect any changes (not just count changes)
    this.lastJobHash = this.hashJobs(this.memory.getCronJobs(false));
    console.log(`[Scheduler] Initialized with ${this.jobs.size} jobs`);

    // Start periodic check for new jobs (every 60 seconds)
    this.reloadInterval = setInterval(() => {
      this.checkForNewJobs();
    }, 60000);

    // Start periodic check for calendar/task reminders (every 30 seconds)
    this.reminderInterval = setInterval(() => {
      this.checkReminders().catch((err) => {
        console.error('[Scheduler] Error checking reminders:', err);
      });
    }, 30000);

    // Run initial reminder check
    this.checkReminders().catch((err) => {
      console.error('[Scheduler] Error in initial reminder check:', err);
    });
  }

  /**
   * Create a hash of all jobs to detect any changes (additions, deletions, or modifications)
   */
  private hashJobs(jobs: CronJob[]): string {
    return jobs
      .map((j) => `${j.id}:${j.name}:${j.enabled}:${j.schedule}:${j.schedule_type}:${j.prompt}`)
      .join('|');
  }

  /**
   * Check if jobs have been added, removed, or modified in the database
   */
  private async checkForNewJobs(): Promise<void> {
    if (!this.memory) return;

    const dbJobs = this.memory.getCronJobs(false); // Get all jobs
    const currentHash = this.hashJobs(dbJobs);

    // If jobs changed in any way, reload
    if (currentHash !== this.lastJobHash) {
      console.log(`[Scheduler] Jobs changed, reloading...`);
      await this.loadJobsFromDatabase();
      this.lastJobHash = currentHash;
    }
  }

  /**
   * Check for calendar events and tasks that need reminders.
   * Uses mutex to prevent overlapping executions.
   */
  private async checkReminders(): Promise<void> {
    if (!this.db) return;

    // Mutex: prevent overlapping executions
    if (this.isCheckingReminders) {
      console.log('[Scheduler] Skipping reminder check - previous check still running');
      return;
    }

    this.isCheckingReminders = true;

    try {
      const db = this.db;
      const now = new Date();
      const nowSqlite = formatForSqlite(now);
      const channels = this.getChannels();

      // Check calendar events (delegated to calendar module)
      const calendarResults = await checkCalendarEvents(db, now, nowSqlite, channels, this.memory);
      for (const result of calendarResults) {
        this.addToHistory(result);
      }

      // Check tasks with due dates (delegated to calendar module)
      const taskResults = await checkTaskReminders(db, now, nowSqlite, channels, this.memory);
      for (const result of taskResults) {
        this.addToHistory(result);
      }

      // Check for due cron jobs
      await this.checkDueJobs(db, now);
    } catch (error) {
      console.error('[Scheduler] Reminder check failed:', error);
    } finally {
      // Release mutex (DB stays open for reuse)
      this.isCheckingReminders = false;
    }
  }

  /**
   * Check for cron jobs that are due to run
   */
  private async checkDueJobs(db: Database.Database, now: Date): Promise<void> {
    interface DueJob {
      id: number;
      name: string;
      schedule_type: string;
      schedule: string | null;
      run_at: string | null;
      interval_ms: number | null;
      prompt: string;
      channel: string;
      delete_after_run: number;
      context_messages: number;
      session_id: string | null;
      job_type: string | null;
    }

    const nowSqlite = formatForSqlite(now);
    const dueJobs = db
      .prepare(
        `
      SELECT id, name, schedule_type, schedule, run_at, interval_ms, prompt, channel, delete_after_run, context_messages, session_id, job_type
      FROM cron_jobs
      WHERE enabled = 1 AND next_run_at IS NOT NULL AND datetime(replace(next_run_at, 'Z', '')) <= datetime(?)
      LIMIT 50
    `
      )
      .all(nowSqlite) as DueJob[];

    for (const job of dueJobs) {
      const startTime = Date.now();

      const sessionId = job.session_id || 'default';

      try {
        console.log(`[Scheduler] Executing job: ${job.name}`);
        let response: string;

        if (job.job_type === 'reminder') {
          // Reminders: display the pre-composed message directly, NO LLM call
          response = job.prompt;
          console.log(`[Scheduler] Reminder (no LLM): ${job.name}`);

          // Save reminder to messages table for persistence and history display
          if (this.memory) {
            this.memory.saveMessage('assistant', response, sessionId, {
              source: 'scheduler',
              jobName: job.name,
            });
          }
        } else {
          // Routines: call LLM with context
          let contextText = '';
          if (job.context_messages > 0 && this.memory) {
            const history = this.memory.getRecentMessages(job.context_messages, sessionId);
            if (history.length > 0) {
              const lines = history.map((m) => {
                const role = m.role === 'user' ? 'User' : 'Assistant';
                const text = m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content;
                return `- ${role}: ${text}`;
              });
              contextText = '\n\nRecent context:\n' + lines.join('\n');
            }
          }

          // Only add HEARTBEAT_OK escape for recurring jobs (cron/interval).
          // One-time "at" jobs are intentionally scheduled — always produce output.
          const heartbeatEscape = job.schedule_type === 'at' ? '' : HEARTBEAT_SUFFIX;
          const fullPrompt = job.prompt + contextText + heartbeatEscape;

          if (!AgentManager.isInitialized()) {
            throw new Error('AgentManager not initialized');
          }

          const result = await AgentManager.processMessage(
            fullPrompt,
            `cron:${job.name}`,
            sessionId
          );
          response = result.response;
        }

        const duration = Date.now() - startTime;

        // Update job state
        const nextRunAt = this.calculateNextRun(job.schedule_type, job.schedule, job.interval_ms);

        if (job.delete_after_run === 1) {
          // Delete one-time job
          db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(job.id);
          console.log(`[Scheduler] Deleted one-time job: ${job.name}`);
        } else {
          // Update state
          db.prepare(
            `
            UPDATE cron_jobs SET
              last_run_at = datetime(?),
              last_status = 'ok',
              last_error = NULL,
              last_duration_ms = ?,
              next_run_at = ?,
              updated_at = datetime('now')
            WHERE id = ?
          `
          ).run(now.toISOString(), duration, nextRunAt, job.id);
        }

        // Route response to the job's session
        // For reminders, don't show prompt (the response IS the message)
        const displayPrompt = job.job_type === 'reminder' ? '' : job.prompt;
        await this.routeJobResponse(job.name, displayPrompt, response, job.channel, sessionId);

        this.addToHistory({
          jobName: job.name,
          response: response,
          channel: job.channel,
          success: true,
          timestamp: now,
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';

        console.error(`[Scheduler] Job ${job.name} failed:`, errorMsg);

        // Update state with error
        const nextRunAt = this.calculateNextRun(job.schedule_type, job.schedule, job.interval_ms);
        db.prepare(
          `
          UPDATE cron_jobs SET
            last_run_at = datetime(?),
            last_status = 'error',
            last_error = ?,
            last_duration_ms = ?,
            next_run_at = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `
        ).run(now.toISOString(), errorMsg, duration, nextRunAt, job.id);

        this.addToHistory({
          jobName: job.name,
          response: '',
          channel: job.channel,
          success: false,
          error: errorMsg,
          timestamp: now,
        });

        // Surface error to user through the same channels as success
        const errorResponse = `⚠️ Job "${job.name}" failed: ${errorMsg}`;
        try {
          await this.routeJobResponse(job.name, '', errorResponse, job.channel, sessionId);
        } catch (routeErr) {
          console.error(`[Scheduler] Failed to route job error:`, routeErr);
        }
      }
    }
  }

  /**
   * Calculate next run time based on schedule type
   */
  private calculateNextRun(
    type: string,
    schedule: string | null,
    intervalMs: number | null
  ): string | null {
    const now = new Date();

    if (type === 'at') {
      // One-time job, no next run
      return null;
    }

    if (type === 'every' && intervalMs) {
      return new Date(now.getTime() + intervalMs).toISOString();
    }

    if (type === 'cron' && schedule) {
      const parts = schedule.split(/\s+/);
      if (parts.length !== 5) {
        console.warn(`[Scheduler] Invalid cron expression (expected 5 parts): "${schedule}"`);
        return new Date(now.getTime() + 86400000).toISOString();
      }

      const [minSpec, hourSpec, domSpec, monSpec, dowSpec] = parts;

      // Iterate minute-by-minute to find next matching time (max 48h lookahead)
      const candidate = new Date(now);
      candidate.setSeconds(0, 0);
      candidate.setMinutes(candidate.getMinutes() + 1);
      const maxTime = now.getTime() + 48 * 60 * 60 * 1000;

      while (candidate.getTime() <= maxTime) {
        if (
          matchesCronField(minSpec, candidate.getMinutes(), 0, 59) &&
          matchesCronField(hourSpec, candidate.getHours(), 0, 23) &&
          matchesCronField(domSpec, candidate.getDate(), 1, 31) &&
          matchesCronField(monSpec, candidate.getMonth() + 1, 1, 12) &&
          matchesCronField(dowSpec, candidate.getDay(), 0, 6)
        ) {
          return candidate.toISOString();
        }
        candidate.setMinutes(candidate.getMinutes() + 1);
      }

      // No match in 48h — fallback to 24h
      console.warn(`[Scheduler] No cron match in 48h for "${schedule}", defaulting to 24h`);
      return new Date(now.getTime() + 86400000).toISOString();
    }

    // Fallback for unknown schedule types - don't disable the job
    console.warn(`[Scheduler] Unknown schedule type "${type}", defaulting to 24h interval`);
    return new Date(now.getTime() + 86400000).toISOString();
  }

  /**
   * Route job response to appropriate channel(s).
   * Skips notification if response is just HEARTBEAT_OK (nothing to report).
   * Always sends to desktop (to the correct session), and also to Telegram if configured.
   */
  private async routeJobResponse(
    jobName: string,
    prompt: string,
    response: string,
    _channel: string,
    sessionId: string = 'default'
  ): Promise<void> {
    // Check for silent acknowledgment - agent has nothing to report
    // Handles bold markdown, HTML wrappers, trailing punctuation
    if (isHeartbeatOk(response)) {
      console.log(`[Scheduler] Job ${jobName} returned HEARTBEAT_OK, skipping notification`);
      return;
    }

    const channels = this.getChannels();
    const plainResponse = stripMarkdown(response);
    if (channels.onNotification) {
      channels.onNotification('Pocket Agent', plainResponse.slice(0, 200));
    }
    if (channels.onChatMessage) {
      channels.onChatMessage(jobName, prompt, response, sessionId);
    }

    // Send to iOS devices
    if (channels.onIOSSync) {
      channels.onIOSSync(jobName, prompt, response, sessionId);
    }

    // Also send to Telegram if configured AND session has a linked chat
    if (channels.telegramBot && channels.memory) {
      const linkedChatId = channels.memory.getChatForSession(sessionId);
      if (linkedChatId) {
        await channels.telegramBot.sendMessage(linkedChatId, response);
      }
    }
  }

  /**
   * Set Telegram bot for routing messages
   */
  setTelegramBot(bot: TelegramBot | null): void {
    this.telegramBot = bot;
    console.log(`[Scheduler] Telegram bot ${bot ? 'connected' : 'disconnected'}`);
  }

  /**
   * Load all enabled jobs from database and schedule them
   * Note: Only 'cron' type jobs are scheduled with node-cron.
   * 'at' and 'every' jobs are handled by checkDueJobs() timer.
   */
  async loadJobsFromDatabase(): Promise<void> {
    if (!this.memory) {
      console.error('[Scheduler] Memory not initialized');
      return;
    }

    // Stop all existing cron tasks (but not the reminder interval)
    for (const [name, task] of this.tasks) {
      task.stop();
      console.log(`[Scheduler] Stopped: ${name}`);
    }
    this.tasks.clear();
    this.jobs.clear();

    // Load jobs from SQLite
    const dbJobs = this.memory.getCronJobs(true); // enabled only
    let cronJobCount = 0;

    for (const dbJob of dbJobs) {
      // Only schedule 'cron' type jobs with node-cron
      // 'at' and 'every' jobs are handled by the timer in checkDueJobs()
      const scheduleType = dbJob.schedule_type || 'cron';
      if (scheduleType !== 'cron' || !dbJob.schedule) {
        continue;
      }

      const job: ScheduledJob = {
        id: dbJob.id,
        name: dbJob.name,
        scheduleType: 'cron',
        schedule: dbJob.schedule,
        prompt: dbJob.prompt,
        channel: dbJob.channel,
        recipient: this.extractRecipient(dbJob.prompt),
        enabled: dbJob.enabled,
        sessionId: dbJob.session_id || 'default',
      };

      if (this.scheduleJob(job)) {
        cronJobCount++;
      }
    }

    console.log(
      `[Scheduler] Loaded ${dbJobs.length} jobs (${cronJobCount} cron, ${dbJobs.length - cronJobCount} timer-based)`
    );
  }

  /**
   * Extract recipient from prompt if specified (format: @recipient: prompt)
   */
  private extractRecipient(prompt: string): string | undefined {
    const match = prompt.match(/^@(\S+):\s*/);
    return match ? match[1] : undefined;
  }

  /**
   * Schedule a single job
   */
  scheduleJob(job: ScheduledJob): boolean {
    if (!job.schedule || !cron.validate(job.schedule)) {
      console.error(`[Scheduler] Invalid cron expression for ${job.name}: ${job.schedule}`);
      return false;
    }

    // Stop existing task with same name
    this.stopJob(job.name);

    const schedule = job.schedule;
    const task = cron.schedule(schedule, async () => {
      await this.executeJob(job);
    });

    this.tasks.set(job.name, task);
    this.jobs.set(job.name, job);

    console.log(`[Scheduler] Scheduled: ${job.name} (${job.schedule}) → ${job.channel}`);
    return true;
  }

  /**
   * Execute a job
   */
  private async executeJob(job: ScheduledJob): Promise<void> {
    console.log(`[Scheduler] Executing: ${job.name}`);

    const result: JobResult = {
      jobName: job.name,
      response: '',
      channel: job.channel,
      success: false,
      timestamp: new Date(),
    };

    if (!AgentManager.isInitialized()) {
      result.error = 'AgentManager not initialized';
      this.addToHistory(result);
      console.error(`[Scheduler] ${result.error}`);
      return;
    }

    try {
      // Clean prompt (remove recipient prefix if present)
      const cleanPrompt = job.prompt.replace(/^@\S+:\s*/, '');

      // Process through agent (use job's session)
      const sessionId = job.sessionId || 'default';
      const agentResult = await AgentManager.processMessage(
        cleanPrompt,
        `cron:${job.name}`,
        sessionId
      );

      result.response = agentResult.response;
      result.success = true;

      // Route response to channel
      await this.routeResponse(job, result.response);
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Scheduler] Job ${job.name} failed:`, result.error);
    }

    this.addToHistory(result);
  }

  /**
   * Route response to appropriate channel(s).
   * Always sends to desktop, and also to Telegram if configured and session has a linked chat.
   */
  private async routeResponse(job: ScheduledJob, response: string): Promise<void> {
    const sessionId = job.sessionId || 'default';
    const channels = this.getChannels();

    await sendToAllChannels(channels, job.name, job.prompt, response, sessionId, job.recipient);
  }

  /**
   * Set notification handler
   */
  setNotificationHandler(handler: (title: string, body: string) => void): void {
    this.onNotification = handler;
  }

  /**
   * Set chat message handler (for sending to chat window)
   */
  setChatHandler(
    handler: (jobName: string, prompt: string, response: string, sessionId: string) => void
  ): void {
    this.onChatMessage = handler;
  }

  /**
   * Set iOS sync handler (for sending scheduled results to iOS devices)
   */
  setIOSSyncHandler(
    handler: (jobName: string, prompt: string, response: string, sessionId: string) => void
  ): void {
    this.onIOSSync = handler;
  }

  /**
   * Add result to history
   */
  private addToHistory(result: JobResult): void {
    this.jobHistory.unshift(result);
    if (this.jobHistory.length > this.maxHistorySize) {
      this.jobHistory.pop();
    }
  }

  /**
   * Create a new job and save to database
   */
  async createJob(
    name: string,
    schedule: string,
    prompt: string,
    channel: string = 'default',
    sessionId: string = 'default'
  ): Promise<boolean> {
    if (!this.memory) return false;

    if (!cron.validate(schedule)) {
      console.error(`[Scheduler] Invalid cron: ${schedule}`);
      return false;
    }

    // Resolve session ID — if the given session doesn't exist, use first available
    let resolvedSessionId = sessionId;
    const session = this.memory.getSession(resolvedSessionId);
    if (!session) {
      const sessions = this.memory.getSessions();
      resolvedSessionId = sessions.length > 0 ? sessions[0].id : sessionId;
    }

    // Save to database
    const id = this.memory.saveCronJob(name, schedule, prompt, channel, resolvedSessionId);

    // Schedule it
    const job: ScheduledJob = {
      id,
      name,
      schedule,
      prompt,
      channel,
      recipient: this.extractRecipient(prompt),
      enabled: true,
      sessionId,
    };

    return this.scheduleJob(job);
  }

  /**
   * Delete a job
   */
  deleteJob(name: string): boolean {
    this.stopJob(name);

    if (this.memory) {
      return this.memory.deleteCronJob(name);
    }

    return false;
  }

  /**
   * Stop a specific job
   */
  stopJob(name: string): boolean {
    const task = this.tasks.get(name);
    if (task) {
      task.stop();
      this.tasks.delete(name);
      this.jobs.delete(name);
      console.log(`[Scheduler] Stopped: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * Stop all jobs
   */
  stopAll(): void {
    // Stop reload interval
    if (this.reloadInterval) {
      clearInterval(this.reloadInterval);
      this.reloadInterval = null;
    }

    // Stop reminder interval
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }

    // Close persistent DB connection
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore close errors
      }
      this.db = null;
    }

    for (const [name, task] of this.tasks) {
      task.stop();
      console.log(`[Scheduler] Stopped: ${name}`);
    }
    this.tasks.clear();
    this.jobs.clear();
  }

  /**
   * Enable/disable a job
   */
  setJobEnabled(name: string, enabled: boolean): boolean {
    if (!this.memory) return false;

    const success = this.memory.setCronJobEnabled(name, enabled);

    if (success) {
      if (enabled) {
        // Reload from database to reschedule
        const dbJobs = this.memory.getCronJobs(false);
        const dbJob = dbJobs.find((j) => j.name === name);
        if (dbJob) {
          this.scheduleJob({
            id: dbJob.id,
            name: dbJob.name,
            schedule: dbJob.schedule,
            prompt: dbJob.prompt,
            channel: dbJob.channel,
            recipient: this.extractRecipient(dbJob.prompt),
            enabled: true,
            sessionId: dbJob.session_id || 'default',
          });
        }
      } else {
        this.stopJob(name);
      }
    }

    return success;
  }

  /**
   * Run a job immediately (for testing)
   */
  async runJobNow(name: string): Promise<JobResult | null> {
    const job = this.jobs.get(name);
    if (!job) {
      console.error(`[Scheduler] Job not found: ${name}`);
      return null;
    }

    await this.executeJob(job);
    return this.jobHistory[0] || null;
  }

  /**
   * Get all jobs
   */
  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get all jobs including disabled ones
   */
  getAllJobs(): CronJob[] {
    return this.memory?.getCronJobs(false) || [];
  }

  /**
   * Get job history
   */
  getHistory(limit: number = 20): JobResult[] {
    return this.jobHistory.slice(0, limit);
  }

  /**
   * Check if a job is running
   */
  isRunning(name: string): boolean {
    return this.tasks.has(name);
  }

  /**
   * Get scheduler stats
   */
  getStats(): { activeJobs: number; totalExecutions: number; lastExecution?: Date } {
    return {
      activeJobs: this.tasks.size,
      totalExecutions: this.jobHistory.length,
      lastExecution: this.jobHistory[0]?.timestamp,
    };
  }
}

// Singleton instance
let schedulerInstance: CronScheduler | null = null;

export function getScheduler(): CronScheduler | null {
  return schedulerInstance;
}

export function createScheduler(): CronScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new CronScheduler();
  }
  return schedulerInstance;
}
