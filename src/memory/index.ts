import Database from 'better-sqlite3';
import type { AgentModeId } from '../agent/agent-modes';
import {
  type Message,
  type SmartContextOptions,
  type SmartContext,
  type SummarizerFn,
  saveMessage as _saveMessage,
  getRecentMessages as _getRecentMessages,
  getMessageCount as _getMessageCount,
  getSmartContext as _getSmartContext,
  embedMessage as _embedMessage,
  embedRecentMessages as _embedRecentMessages,
} from './messages';
import {
  type DailyLog,
  getDailyLog as _getDailyLog,
  appendToDailyLog as _appendToDailyLog,
  getDailyLogsSince as _getDailyLogsSince,
  getDailyLogsContext as _getDailyLogsContext,
  getDailyLogsMemoryUsage as _getDailyLogsMemoryUsage,
  deleteDailyLog as _deleteDailyLog,
  pruneOldDailyLogs as _pruneOldDailyLogs,
} from './daily-logs';
import {
  createSoulCache,
  setSoulAspect as _setSoulAspect,
  getSoulAspect as _getSoulAspect,
  getAllSoulAspects as _getAllSoulAspects,
  deleteSoulAspect as _deleteSoulAspect,
  deleteSoulAspectById as _deleteSoulAspectById,
  getSoulContext as _getSoulContext,
  getSoulMemoryUsage as _getSoulMemoryUsage,
} from './soul';
import type { SoulCache, SoulAspect } from './soul';
import {
  type CronJob,
  saveCronJob as _saveCronJob,
  getCronJobs as _getCronJobs,
  setCronJobEnabled as _setCronJobEnabled,
  deleteCronJob as _deleteCronJob,
} from './cron-jobs';
import {
  type TelegramChatSession,
  linkTelegramChat as _linkTelegramChat,
  unlinkTelegramChat as _unlinkTelegramChat,
  getSessionForChat as _getSessionForChat,
  getChatForSession as _getChatForSession,
  getAllTelegramChatSessions as _getAllTelegramChatSessions,
} from './telegram-sessions';
import {
  createFactsCache,
  initializeEmbeddings as _initializeEmbeddings,
  embedMissingFacts as _embedMissingFacts,
  saveFact as _saveFact,
  getAllFacts as _getAllFacts,
  getFactsForContext as _getFactsForContext,
  getFactsMemoryUsage as _getFactsMemoryUsage,
  deleteFact as _deleteFact,
  deleteFactBySubject as _deleteFactBySubject,
  searchFactsHybrid as _searchFactsHybrid,
  searchFacts as _searchFacts,
  getFactsByCategory as _getFactsByCategory,
  getFactCategories as _getFactCategories,
  decayFactImportance as _decayFactImportance,
} from './facts';
import type { FactsCache, Fact, SearchResult } from './facts';
import {
  type Session,
  createSession as _createSession,
  ensureSession as _ensureSession,
  getSession as _getSession,
  getSessionByName as _getSessionByName,
  getSessions as _getSessions,
  getSessionWorkingDirectory as _getSessionWorkingDirectory,
  setSessionWorkingDirectory as _setSessionWorkingDirectory,
  renameSession as _renameSession,
  deleteSession as _deleteSession,
  touchSession as _touchSession,
  getSessionMessageCount as _getSessionMessageCount,
  getSessionMode as _getSessionMode,
  setSessionMode as _setSessionMode,
  getSdkSessionId as _getSdkSessionId,
  setSdkSessionId as _setSdkSessionId,
  clearSdkSessionId as _clearSdkSessionId,
} from './sessions';

// Types
export type { Session } from './sessions';
export type { Message, SmartContextOptions, SmartContext, SummarizerFn } from './messages';
export type { Fact, SearchResult } from './facts';
export type { CronJob } from './cron-jobs';
export type { DailyLog } from './daily-logs';
export type { TelegramChatSession } from './telegram-sessions';
export type { SoulAspect } from './soul';

export class MemoryManager {
  private db: Database.Database;
  private summarizer?: SummarizerFn;

  // Cache for facts context + embeddings state — owned by FactsRepository
  private factsCache: FactsCache = createFactsCache();

  // Cache for soul context (invalidated on soul changes) — owned by SoulRepository
  private soulCache: SoulCache = createSoulCache();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();

    // Run importance decay on startup (reduces importance for stale facts)
    _decayFactImportance(this.db);

    // Prune daily logs older than 3 days — only the rolling window is kept
    _pruneOldDailyLogs(this.db, 3);
  }

  private initialize(): void {
    this.db.exec(`
      -- Sessions for isolated conversation threads
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Main conversation messages (per-session)
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        timestamp TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        token_count INTEGER,
        session_id TEXT REFERENCES sessions(id)
      );

      -- Facts extracted from conversations (long-term memory)
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Embedding chunks linked to facts
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        FOREIGN KEY (fact_id) REFERENCES facts(id) ON DELETE CASCADE
      );

      -- Scheduled cron jobs (supports cron/at/every schedule types)
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        schedule_type TEXT NOT NULL DEFAULT 'cron' CHECK(schedule_type IN ('cron', 'at', 'every')),
        schedule TEXT,
        run_at TEXT,
        interval_ms INTEGER,
        prompt TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'desktop',
        enabled INTEGER DEFAULT 1,
        delete_after_run INTEGER DEFAULT 0,
        context_messages INTEGER DEFAULT 0,
        next_run_at TEXT,
        last_run_at TEXT,
        last_status TEXT CHECK(last_status IN ('ok', 'error', 'skipped')),
        last_error TEXT,
        last_duration_ms INTEGER,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Summaries of older conversation chunks (per-session)
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_message_id INTEGER NOT NULL,
        end_message_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        session_id TEXT REFERENCES sessions(id),
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Calendar events
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        all_day INTEGER DEFAULT 0,
        location TEXT,
        reminder_minutes INTEGER DEFAULT 15,
        reminded INTEGER DEFAULT 0,
        channel TEXT DEFAULT 'desktop',
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Tasks / Todos
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        due_date TEXT,
        priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
        reminder_minutes INTEGER,
        reminded INTEGER DEFAULT 0,
        channel TEXT DEFAULT 'desktop',
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Daily logs for memory journaling (global across all sessions)
      CREATE TABLE IF NOT EXISTS daily_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Soul aspects (agent's evolving identity/personality)
      CREATE TABLE IF NOT EXISTS soul (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aspect TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Telegram chat to session mapping
      CREATE TABLE IF NOT EXISTS telegram_chat_sessions (
        chat_id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        group_name TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Message embeddings for semantic search of past conversations
      CREATE TABLE IF NOT EXISTS message_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL UNIQUE,
        embedding BLOB NOT NULL,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );

      -- Rolling summaries for smart context (different from compaction summaries)
      CREATE TABLE IF NOT EXISTS rolling_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        start_message_id INTEGER NOT NULL,
        end_message_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_message_embeddings_message ON message_embeddings(message_id);
      CREATE INDEX IF NOT EXISTS idx_rolling_summaries_session ON rolling_summaries(session_id, end_message_id);
      CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_chunks_fact_id ON chunks(fact_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_range ON summaries(start_message_id, end_message_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_time);
      CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);
      CREATE INDEX IF NOT EXISTS idx_soul_aspect ON soul(aspect);

      -- Unique constraint on session names (for Telegram group linking)
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_name_unique ON sessions(name);
    `);

    // Create FTS5 virtual table for keyword search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
          category,
          subject,
          content,
          content='facts',
          content_rowid='id'
        );
      `);

      // Create triggers to keep FTS index in sync
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
          INSERT INTO facts_fts(rowid, category, subject, content)
          VALUES (new.id, new.category, new.subject, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
          INSERT INTO facts_fts(facts_fts, rowid, category, subject, content)
          VALUES ('delete', old.id, old.category, old.subject, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
          INSERT INTO facts_fts(facts_fts, rowid, category, subject, content)
          VALUES ('delete', old.id, old.category, old.subject, old.content);
          INSERT INTO facts_fts(rowid, category, subject, content)
          VALUES (new.id, new.category, new.subject, new.content);
        END;
      `);
    } catch {
      // FTS5 triggers may already exist
    }

    // Migration: add subject column if missing (must run BEFORE FTS rebuild)
    const columns = this.db.pragma('table_info(facts)') as Array<{ name: string }>;
    const hasSubject = columns.some((c) => c.name === 'subject');
    if (!hasSubject) {
      this.db.exec(`ALTER TABLE facts ADD COLUMN subject TEXT NOT NULL DEFAULT ''`);
      console.log('[Memory] Migrated facts table: added subject column');
    }

    // Migration: add importance and last_accessed_at columns to facts
    const factsColumns = this.db.pragma('table_info(facts)') as Array<{ name: string }>;
    if (!factsColumns.some((c) => c.name === 'importance')) {
      this.db.exec(`ALTER TABLE facts ADD COLUMN importance INTEGER DEFAULT 50`);
      console.log('[Memory] Migrated facts table: added importance column');
    }
    if (!factsColumns.some((c) => c.name === 'last_accessed_at')) {
      this.db.exec(`ALTER TABLE facts ADD COLUMN last_accessed_at TEXT`);
      console.log('[Memory] Migrated facts table: added last_accessed_at column');
    }

    // Rebuild FTS index from existing facts (after all schema migrations)
    this.rebuildFtsIndex();

    // Migration: add session_id to messages if missing
    const msgColumns = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
    const hasSessionId = msgColumns.some((c) => c.name === 'session_id');
    if (!hasSessionId) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
      console.log('[Memory] Migrated messages table: added session_id column');
    }

    // Migration: add session_id to summaries if missing
    const sumColumns = this.db.pragma('table_info(summaries)') as Array<{ name: string }>;
    const sumHasSessionId = sumColumns.some((c) => c.name === 'session_id');
    if (!sumHasSessionId) {
      this.db.exec(`ALTER TABLE summaries ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
      console.log('[Memory] Migrated summaries table: added session_id column');
    }

    // Migration: add metadata column to messages if missing
    const msgColsForMeta = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
    const hasMetadata = msgColsForMeta.some((c) => c.name === 'metadata');
    if (!hasMetadata) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
      console.log('[Memory] Migrated messages table: added metadata column');
    }

    // Migration: create default session and migrate orphan messages
    this.migrateToDefaultSession();

    // Migration: add session_id to calendar_events, tasks, and cron_jobs
    this.migrateSessionScopedTables();

    // Migration: add sdk_session_id to sessions for SDK session persistence
    const sessColumns = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    if (!sessColumns.some((c) => c.name === 'sdk_session_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT');
      console.log('[Memory] Migrated sessions table: added sdk_session_id column');
    }

    // Migration: add mode column to sessions for per-session mode lock
    const sessColumnsForMode = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    if (!sessColumnsForMode.some((c) => c.name === 'mode')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'coder'");
      console.log('[Memory] Migrated sessions table: added mode column');
    }

    // Migration: add working_directory column to sessions for per-session workspace
    const sessColumnsForWd = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    if (!sessColumnsForWd.some((c) => c.name === 'working_directory')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN working_directory TEXT');
      console.log('[Memory] Migrated sessions table: added working_directory column');
    }
  }

  /**
   * Add session_id column to calendar_events, tasks, and cron_jobs tables
   * and migrate existing records to the default session
   */
  private migrateSessionScopedTables(): void {
    const DEFAULT_SESSION_ID = 'default';

    // Helper to check if column exists
    const hasColumn = (table: string, column: string): boolean => {
      const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
      return columns.some((c) => c.name === column);
    };

    // Migrate calendar_events
    if (!hasColumn('calendar_events', 'session_id')) {
      this.db.exec(
        `ALTER TABLE calendar_events ADD COLUMN session_id TEXT REFERENCES sessions(id)`
      );
      const count = (
        this.db
          .prepare('SELECT COUNT(*) as c FROM calendar_events WHERE session_id IS NULL')
          .get() as { c: number }
      ).c;
      if (count > 0) {
        this.db
          .prepare('UPDATE calendar_events SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${count} calendar events to default session`);
      }
      console.log('[Memory] Migrated calendar_events table: added session_id column');
    }

    // Migrate tasks
    if (!hasColumn('tasks', 'session_id')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
      const count = (
        this.db.prepare('SELECT COUNT(*) as c FROM tasks WHERE session_id IS NULL').get() as {
          c: number;
        }
      ).c;
      if (count > 0) {
        this.db
          .prepare('UPDATE tasks SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${count} tasks to default session`);
      }
      console.log('[Memory] Migrated tasks table: added session_id column');
    }

    // Migrate cron_jobs
    if (!hasColumn('cron_jobs', 'session_id')) {
      this.db.exec(`ALTER TABLE cron_jobs ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
      const count = (
        this.db.prepare('SELECT COUNT(*) as c FROM cron_jobs WHERE session_id IS NULL').get() as {
          c: number;
        }
      ).c;
      if (count > 0) {
        this.db
          .prepare('UPDATE cron_jobs SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${count} cron jobs to default session`);
      }
      console.log('[Memory] Migrated cron_jobs table: added session_id column');
    }

    // Create indexes for session filtering
    try {
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_calendar_session ON calendar_events(session_id)`
      );
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_cron_session ON cron_jobs(session_id)`);
    } catch {
      // Indexes may already exist
    }
  }

  /**
   * Create default session and migrate existing messages without session_id
   */
  private migrateToDefaultSession(): void {
    const DEFAULT_SESSION_ID = 'default';
    const DEFAULT_SESSION_NAME = 'Chat';

    // Only create default session if NO sessions exist at all
    // (Don't recreate it if user deleted it and has other sessions)
    const sessionCount = (
      this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }
    ).c;
    const existing = this.db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(DEFAULT_SESSION_ID);
    if (!existing && sessionCount === 0) {
      // Create default session
      this.db
        .prepare(
          `
        INSERT INTO sessions (id, name, created_at, updated_at)
        VALUES (?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')), (strftime('%Y-%m-%dT%H:%M:%fZ')))
      `
        )
        .run(DEFAULT_SESSION_ID, DEFAULT_SESSION_NAME);
      console.log('[Memory] Created default session');
    }

    // Migrate orphan messages/summaries to default session (only if it exists)
    const defaultExists = this.db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(DEFAULT_SESSION_ID);
    if (defaultExists) {
      const orphanCount = (
        this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id IS NULL').get() as {
          c: number;
        }
      ).c;
      if (orphanCount > 0) {
        this.db
          .prepare('UPDATE messages SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${orphanCount} messages to default session`);
      }

      const orphanSumCount = (
        this.db.prepare('SELECT COUNT(*) as c FROM summaries WHERE session_id IS NULL').get() as {
          c: number;
        }
      ).c;
      if (orphanSumCount > 0) {
        this.db
          .prepare('UPDATE summaries SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${orphanSumCount} summaries to default session`);
      }
    }
  }

  /**
   * Rebuild FTS index from existing facts
   */
  private rebuildFtsIndex(): void {
    try {
      // Check if FTS table is empty but facts exist
      const ftsCount = (
        this.db.prepare('SELECT COUNT(*) as c FROM facts_fts').get() as { c: number }
      ).c;
      const factsCount = (this.db.prepare('SELECT COUNT(*) as c FROM facts').get() as { c: number })
        .c;

      if (ftsCount === 0 && factsCount > 0) {
        console.log('[Memory] Rebuilding FTS index...');
        const facts = this.db
          .prepare('SELECT id, category, subject, content FROM facts')
          .all() as Fact[];
        const insert = this.db.prepare(
          'INSERT INTO facts_fts(rowid, category, subject, content) VALUES (?, ?, ?, ?)'
        );

        for (const fact of facts) {
          insert.run(fact.id, fact.category, fact.subject, fact.content);
        }
        console.log(`[Memory] Rebuilt FTS index with ${facts.length} facts`);
      }
    } catch (e) {
      console.warn('[Memory] FTS rebuild failed:', e);
    }
  }

  /**
   * Initialize embeddings with OpenAI API key
   */
  initializeEmbeddings(openaiApiKey: string): void {
    _initializeEmbeddings(openaiApiKey, this.factsCache);

    // Embed any facts that don't have embeddings
    _embedMissingFacts(this.db).catch((err) => {
      console.error('[Memory] Failed to embed missing facts:', err);
    });
  }

  /**
   * Set the summarizer function
   */
  setSummarizer(fn: SummarizerFn): void {
    this.summarizer = fn;
  }

  // ============ SESSION METHODS ============

  createSession(
    name: string,
    mode: AgentModeId = 'coder',
    workingDirectory?: string | null
  ): Session {
    return _createSession(this.db, name, mode, workingDirectory);
  }

  ensureSession(id: string, mode: AgentModeId = 'coder'): void {
    _ensureSession(this.db, id, mode);
  }

  getSessionByName(name: string): Session | null {
    return _getSessionByName(this.db, name);
  }

  getSession(id: string): Session | null {
    return _getSession(this.db, id);
  }

  getSessions(): Session[] {
    return _getSessions(this.db);
  }

  getSessionWorkingDirectory(sessionId: string): string | null {
    return _getSessionWorkingDirectory(this.db, sessionId);
  }

  setSessionWorkingDirectory(sessionId: string, workingDirectory: string | null): void {
    _setSessionWorkingDirectory(this.db, sessionId, workingDirectory);
  }

  renameSession(id: string, name: string, workingDirectory?: string): boolean {
    return _renameSession(this.db, id, name, workingDirectory);
  }

  deleteSession(id: string): boolean {
    return _deleteSession(this.db, id);
  }

  touchSession(id: string): void {
    _touchSession(this.db, id);
  }

  getSessionMessageCount(sessionId: string): number {
    return _getSessionMessageCount(this.db, sessionId);
  }

  getSessionMode(sessionId: string): AgentModeId {
    return _getSessionMode(this.db, sessionId);
  }

  setSessionMode(sessionId: string, mode: AgentModeId): boolean {
    return _setSessionMode(this.db, sessionId, mode);
  }

  // ============ TELEGRAM CHAT SESSION METHODS ============

  /**
   * Link a Telegram chat to a session
   */
  linkTelegramChat(chatId: number, sessionId: string, groupName?: string): boolean {
    return _linkTelegramChat(this.db, chatId, sessionId, groupName);
  }

  /**
   * Unlink a Telegram chat from its session
   */
  unlinkTelegramChat(chatId: number): boolean {
    return _unlinkTelegramChat(this.db, chatId);
  }

  /**
   * Get the session ID for a Telegram chat
   */
  getSessionForChat(chatId: number): string | null {
    return _getSessionForChat(this.db, chatId);
  }

  /**
   * Get the Telegram chat ID for a session
   */
  getChatForSession(sessionId: string): number | null {
    return _getChatForSession(this.db, sessionId);
  }

  /**
   * Get all Telegram chat to session mappings
   */
  getAllTelegramChatSessions(): TelegramChatSession[] {
    return _getAllTelegramChatSessions(this.db);
  }

  // ============ DAILY LOG METHODS ============

  getDailyLog(date?: string): DailyLog | null {
    return _getDailyLog(this.db, date);
  }

  appendToDailyLog(entry: string): DailyLog {
    return _appendToDailyLog(this.db, entry);
  }

  getDailyLogsSince(days: number = 3): DailyLog[] {
    return _getDailyLogsSince(this.db, days);
  }

  deleteDailyLog(id: number): boolean {
    return _deleteDailyLog(this.db, id);
  }

  getDailyLogsContext(days: number = 3): string {
    return _getDailyLogsContext(this.db, days);
  }

  // ============ MESSAGE METHODS ============

  saveMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    sessionId: string = 'default',
    metadata?: Record<string, unknown>
  ): number {
    return _saveMessage(this.db, role, content, sessionId, metadata);
  }

  getRecentMessages(limit: number = 50, sessionId: string = 'default'): Message[] {
    return _getRecentMessages(this.db, limit, sessionId);
  }

  getMessageCount(sessionId?: string): number {
    return _getMessageCount(this.db, sessionId);
  }

  async getSmartContext(
    sessionId: string = 'default',
    options: SmartContextOptions
  ): Promise<SmartContext> {
    return _getSmartContext(this.db, sessionId, options, {
      summarizer: this.summarizer,
      embeddingsReady: this.factsCache.embeddingsReady,
    });
  }

  async embedMessage(messageId: number): Promise<void> {
    return _embedMessage(this.db, messageId);
  }

  async embedRecentMessages(sessionId: string = 'default', limit: number = 50): Promise<number> {
    return _embedRecentMessages(this.db, sessionId, limit);
  }

  // ============ FACT METHODS ============

  saveFact(category: string, subject: string, content: string): number {
    return _saveFact(this.db, category, subject, content, this.factsCache);
  }

  getAllFacts(): Fact[] {
    return _getAllFacts(this.db);
  }

  getFactsForContext(): string {
    return _getFactsForContext(this.db, this.factsCache);
  }

  getFactsMemoryUsage(): { usedChars: number; budgetChars: number; pct: number } {
    return _getFactsMemoryUsage(this.db);
  }

  deleteFact(id: number): boolean {
    return _deleteFact(this.db, id, this.factsCache);
  }

  deleteFactBySubject(category: string, subject: string): boolean {
    return _deleteFactBySubject(this.db, category, subject, this.factsCache);
  }

  async searchFactsHybrid(query: string): Promise<SearchResult[]> {
    return _searchFactsHybrid(this.db, query);
  }

  searchFacts(query: string, category?: string): Fact[] {
    return _searchFacts(this.db, query, category);
  }

  getFactsByCategory(category: string): Fact[] {
    return _getFactsByCategory(this.db, category);
  }

  getFactCategories(): string[] {
    return _getFactCategories(this.db);
  }

  // ============ CRON JOB METHODS ============

  saveCronJob(
    name: string,
    schedule: string,
    prompt: string,
    channel: string = 'default',
    sessionId: string = 'default'
  ): number {
    return _saveCronJob(this.db, name, schedule, prompt, channel, sessionId);
  }

  getCronJobs(enabledOnly: boolean = true): CronJob[] {
    return _getCronJobs(this.db, enabledOnly);
  }

  setCronJobEnabled(name: string, enabled: boolean): boolean {
    return _setCronJobEnabled(this.db, name, enabled);
  }

  deleteCronJob(name: string): boolean {
    return _deleteCronJob(this.db, name);
  }

  // ============ UTILITY METHODS ============

  getStats(sessionId?: string): {
    messageCount: number;
    factCount: number;
    cronJobCount: number;
    summaryCount: number;
    estimatedTokens: number;
    embeddedFactCount: number;
    sessionCount?: number;
  } {
    let messages: { c: number; t: number };
    let summaries: { c: number };

    if (sessionId) {
      // Session-specific stats
      messages = this.db
        .prepare('SELECT COUNT(*) as c, SUM(token_count) as t FROM messages WHERE session_id = ?')
        .get(sessionId) as { c: number; t: number };
      summaries = this.db
        .prepare('SELECT COUNT(*) as c FROM summaries WHERE session_id = ?')
        .get(sessionId) as { c: number };
    } else {
      // Global stats
      messages = this.db
        .prepare('SELECT COUNT(*) as c, SUM(token_count) as t FROM messages')
        .get() as { c: number; t: number };
      summaries = this.db.prepare('SELECT COUNT(*) as c FROM summaries').get() as { c: number };
    }

    const facts = this.db.prepare('SELECT COUNT(*) as c FROM facts').get() as { c: number };
    const cronJobs = this.db.prepare('SELECT COUNT(*) as c FROM cron_jobs').get() as { c: number };
    const embeddedFacts = this.db
      .prepare('SELECT COUNT(DISTINCT fact_id) as c FROM chunks WHERE embedding IS NOT NULL')
      .get() as { c: number };
    const sessionCount = this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as {
      c: number;
    };

    return {
      messageCount: messages.c,
      factCount: facts.c,
      cronJobCount: cronJobs.c,
      summaryCount: summaries.c,
      estimatedTokens: messages.t || 0,
      embeddedFactCount: embeddedFacts.c,
      sessionCount: sessionCount.c,
    };
  }

  clearConversation(sessionId?: string): void {
    if (sessionId) {
      // Clear only the specified session
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM summaries WHERE session_id = ?').run(sessionId);
      // Clear SDK session so next message starts fresh
      this.clearSdkSessionId(sessionId);
    } else {
      // Clear all (legacy behavior)
      this.db.exec('DELETE FROM messages');
      this.db.exec('DELETE FROM summaries');
      this.db.exec('UPDATE sessions SET sdk_session_id = NULL');
    }
  }

  // ============ SDK SESSION PERSISTENCE ============

  getSdkSessionId(sessionId: string): string | null {
    return _getSdkSessionId(this.db, sessionId);
  }

  setSdkSessionId(sessionId: string, sdkSessionId: string): void {
    _setSdkSessionId(this.db, sessionId, sdkSessionId);
  }

  clearSdkSessionId(sessionId: string): void {
    _clearSdkSessionId(this.db, sessionId);
  }

  // ============ SOUL METHODS ============

  setSoulAspect(aspect: string, content: string): number {
    return _setSoulAspect(this.db, aspect, content, this.soulCache);
  }

  getSoulAspect(aspect: string): SoulAspect | null {
    return _getSoulAspect(this.db, aspect);
  }

  getAllSoulAspects(): SoulAspect[] {
    return _getAllSoulAspects(this.db);
  }

  deleteSoulAspect(aspect: string): boolean {
    return _deleteSoulAspect(this.db, aspect, this.soulCache);
  }

  deleteSoulAspectById(id: number): boolean {
    return _deleteSoulAspectById(this.db, id, this.soulCache);
  }

  getSoulContext(): string {
    return _getSoulContext(this.db, this.soulCache);
  }

  getSoulMemoryUsage(): { usedChars: number; budgetChars: number; pct: number } {
    return _getSoulMemoryUsage(this.db);
  }

  getDailyLogsMemoryUsage(days: number = 3): {
    usedChars: number;
    budgetChars: number;
    pct: number;
  } {
    return _getDailyLogsMemoryUsage(this.db, days);
  }

  close(): void {
    this.db.close();
  }
}

export { MemoryManager as MemoryStore };
