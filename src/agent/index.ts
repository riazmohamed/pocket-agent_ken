import { MemoryManager, Message, DailyLog } from '../memory';
import {
  setMemoryManager,
  setSoulMemoryManager,
  ToolsConfig,
  validateToolsConfig,
  getCurrentSessionId,
} from '../tools';
import {
  setSwitchModeCallback,
  setGetSessionIdCallback,
  setGetCurrentModeCallback,
  addOnHandoffCallback,
} from '../tools/agent-mode-tools';
import { closeBrowserManager } from '../browser';
import { SettingsManager } from '../settings';
import { EventEmitter } from 'events';
import { setStatusEmitter } from './safety';
import { type AgentModeId, isValidModeId, getModeConfig } from './agent-modes';
import { ChatEngine } from './chat-engine';

// Status event types
export type AgentStatus = {
  type:
    | 'thinking'
    | 'tool_start'
    | 'tool_end'
    | 'tool_blocked'
    | 'responding'
    | 'done'
    | 'subagent_start'
    | 'subagent_update'
    | 'subagent_end'
    | 'queued'
    | 'queue_processing'
    | 'teammate_start'
    | 'teammate_idle'
    | 'teammate_message'
    | 'task_completed'
    | 'background_task_start'
    | 'background_task_output'
    | 'background_task_end'
    | 'partial_text'
    | 'plan_mode_entered'
    | 'plan_mode_exited'
    | 'memory_compacting';
  sessionId?: string;
  toolName?: string;
  toolInput?: string;
  message?: string;
  // Partial text preview (streamed as agent composes)
  partialText?: string;
  // If true, partialText is the full accumulated text (replace, don't append)
  partialReplace?: boolean;
  // Subagent tracking
  agentId?: string;
  agentType?: string;
  agentCount?: number; // Number of active subagents
  // Queue tracking
  queuePosition?: number;
  queuedMessage?: string;
  // Safety blocking
  blockedReason?: string;
  // Pocket CLI indicator
  isPocketCli?: boolean;
  // Team tracking
  teammateName?: string;
  teamName?: string;
  taskId?: string;
  taskSubject?: string;
  // Background task tracking
  backgroundTaskId?: string;
  backgroundTaskDescription?: string;
  backgroundTaskCount?: number;
};

// Image content for multimodal messages
export interface ImageContent {
  type: 'base64';
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: string; // base64 encoded
}

// Attachment info for tracking attachments in metadata
export interface AttachmentInfo {
  hasAttachment: boolean;
  attachmentType?: 'photo' | 'voice' | 'audio' | 'document' | 'location';
}

export interface AgentConfig {
  memory: MemoryManager;
  projectRoot?: string;
  workspace?: string; // Isolated working directory for agent file operations
  dataDir?: string; // App data directory (e.g. ~/Library/Application Support/pocket-agent)
  model?: string;
  tools?: ToolsConfig;
}

export interface MediaAttachment {
  type: 'image';
  filePath: string; // absolute path on disk
  mimeType: string; // e.g. 'image/png'
}

export interface ProcessResult {
  response: string;
  tokensUsed: number;
  wasCompacted: boolean;
  suggestedPrompt?: string;
  contextTokens?: number;
  contextWindow?: number;
  media?: MediaAttachment[];
  planPending?: boolean;
}

/**
 * AgentManager - Singleton orchestrator routing all modes through ChatEngine
 */
class AgentManagerClass extends EventEmitter {
  private static instance: AgentManagerClass | null = null;
  private memory: MemoryManager | null = null;
  private projectRoot: string = process.cwd();
  private workspace: string = process.cwd(); // Isolated working directory for agent
  private model: string = 'claude-opus-4-7';
  private mode: AgentModeId = 'coder';
  private chatEngine: ChatEngine | null = null;
  private toolsConfig: ToolsConfig | null = null;
  private initialized: boolean = false;
  private contextUsageBySession: Map<string, { contextTokens: number; contextWindow: number }> =
    new Map();
  private pendingProjectSwitch: Set<string> = new Set();
  private pendingModeSwitch: Set<string> = new Set();

  private constructor() {
    super();
  }

  static getInstance(): AgentManagerClass {
    if (!AgentManagerClass.instance) {
      AgentManagerClass.instance = new AgentManagerClass();
    }
    return AgentManagerClass.instance;
  }

  initialize(config: AgentConfig): void {
    this.memory = config.memory;
    this.projectRoot = config.projectRoot || process.cwd();
    this.workspace = config.workspace || this.projectRoot;
    this.model = config.model || 'claude-opus-4-7';
    this.toolsConfig = config.tools || null;
    this.initialized = true;

    setMemoryManager(this.memory);
    setSoulMemoryManager(this.memory);

    // Set up safety status emitter for UI feedback on blocked tools
    setStatusEmitter((status) => {
      this.emitStatus(status);
    });

    console.log('[AgentManager] Initialized');
    console.log('[AgentManager] Project root:', this.projectRoot);
    console.log('[AgentManager] Workspace:', this.workspace);
    console.log('[AgentManager] Model:', this.model);

    if (this.toolsConfig) {
      const validation = validateToolsConfig(this.toolsConfig);
      if (!validation.valid) {
        console.warn('[AgentManager] Tool config issues:', validation.errors);
      }

      if (this.toolsConfig.browser.enabled) {
        console.log('[AgentManager] Browser: 2-tier (Electron, CDP)');
      }
    }

    // Instantiate Chat engine (handles all modes)
    if (this.toolsConfig) {
      this.chatEngine = new ChatEngine({
        memory: this.memory,
        toolsConfig: this.toolsConfig,
        statusEmitter: (status) => this.emitStatus(status),
        workspace: this.workspace,
      });
      console.log('[AgentManager] Chat engine initialized');
    }

    // Read persisted mode from settings
    const savedMode = SettingsManager.get('agent.mode');
    if (isValidModeId(savedMode as string)) {
      this.mode = savedMode as AgentModeId;
      console.log('[AgentManager] Mode:', this.mode);
    }

    // Set up switch_agent tool callbacks
    setSwitchModeCallback(async (sessionId, newMode, reason) => {
      return this.switchSessionMode(sessionId, newMode, reason);
    });
    setGetSessionIdCallback(() => getCurrentSessionId());
    setGetCurrentModeCallback((sessionId) => {
      return (this.memory?.getSessionMode(sessionId) as AgentModeId) ?? 'general';
    });

    // Register default on_handoff callback — log handoffs to daily log
    addOnHandoffCallback(({ fromMode, toMode, reason }) => {
      console.log(`[AgentManager] Handoff: ${fromMode} -> ${toMode} (${reason})`);
    });

    // Backfill message embeddings asynchronously (for semantic retrieval)
    this.backfillMessageEmbeddings().catch((e) => {
      console.error('[AgentManager] Embedding backfill failed:', e);
    });
  }

  /**
   * Backfill embeddings for messages that don't have them yet.
   * Runs asynchronously in the background during initialization.
   */
  private async backfillMessageEmbeddings(): Promise<void> {
    if (!this.memory) return;

    // Get all sessions and backfill each
    const sessions = this.memory.getSessions();
    for (const session of sessions) {
      const embedded = await this.memory.embedRecentMessages(session.id, 100);
      if (embedded > 0) {
        console.log(`[AgentManager] Backfilled ${embedded} embeddings for session ${session.id}`);
      }
    }
  }

  isInitialized(): boolean {
    return this.initialized && this.memory !== null;
  }

  getModel(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
    SettingsManager.set('agent.model', model);
    console.log('[AgentManager] Model changed to:', model);
    this.emit('model:changed', model);
  }

  getMode(): AgentModeId {
    return this.mode;
  }

  setMode(mode: AgentModeId): void {
    if (this.mode === mode) return;
    const previousMode = this.mode;
    this.mode = mode;
    console.log(`[AgentManager] Default mode changed: ${previousMode} -> ${mode}`);
    this.emit('mode:changed', mode);
  }

  /**
   * Switch a session's mode at runtime (called by the switch_agent tool).
   * Clears session caches so the next message picks up the new mode.
   */
  async switchSessionMode(
    sessionId: string,
    newMode: AgentModeId,
    reason: string
  ): Promise<string> {
    if (!this.memory) return 'Error: AgentManager not initialized';

    const currentMode = this.memory.getSessionMode(sessionId);
    if (currentMode === newMode) {
      return `Already in ${newMode} mode.`;
    }

    const modeConfig = getModeConfig(newMode);

    // Update mode in DB
    this.memory.setSessionMode(sessionId, newMode);

    // Flag for deferred cleanup after the current turn completes
    this.pendingModeSwitch.add(sessionId);

    // Clear ChatEngine conversation cache so the next message reloads from SQLite
    // with history filtering applied for the new mode.
    this.chatEngine?.clearSession(sessionId);

    // Emit mode change event for UI
    this.emit('sessionModeChanged', sessionId, newMode, modeConfig.icon, modeConfig.name);

    console.log(
      `[AgentManager] Session ${sessionId} switched: ${currentMode} → ${newMode} (${reason})`
    );
    return `Switched to ${modeConfig.name} mode. ${reason}`;
  }

  async processMessage(
    userMessage: string,
    channel: string = 'default',
    sessionId: string = 'default',
    images?: ImageContent[],
    attachmentInfo?: AttachmentInfo
  ): Promise<ProcessResult> {
    if (!this.memory) {
      throw new Error('AgentManager not initialized - call initialize() first');
    }

    if (!this.chatEngine) {
      throw new Error('Chat engine not initialized');
    }

    const result = await this.chatEngine.processMessage(
      userMessage,
      channel,
      sessionId,
      images,
      attachmentInfo
    );

    // Store context usage for stats display
    if (result.contextTokens !== undefined || result.contextWindow !== undefined) {
      this.contextUsageBySession.set(sessionId, {
        contextTokens: result.contextTokens ?? 0,
        contextWindow: result.contextWindow ?? 0,
      });
    }

    return result;
  }

  getQueueLength(sessionId: string = 'default'): number {
    return this.chatEngine?.isQueryProcessing(sessionId) ? 1 : 0;
  }

  clearQueue(sessionId: string = 'default'): void {
    this.chatEngine?.stopQuery(sessionId);
  }

  stopQuery(sessionId?: string): boolean {
    return this.chatEngine?.stopQuery(sessionId) ?? false;
  }

  /**
   * Check if a query is currently processing (optionally for a specific session)
   */
  isQueryProcessing(sessionId?: string): boolean {
    return this.chatEngine?.isQueryProcessing(sessionId) ?? false;
  }

  /**
   * Get the current workspace directory
   */
  getWorkspace(): string {
    return this.workspace;
  }

  /**
   * Get the default project root directory
   */
  getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Flag that a project switch occurred for a session.
   * After the current turn completes, the session cache will be cleared
   * so the next message picks up the new cwd.
   */
  flagProjectSwitch(sessionId: string): void {
    this.pendingProjectSwitch.add(sessionId);
    this.chatEngine?.clearSession(sessionId);
    console.log(`[AgentManager] Project switch flagged for session ${sessionId}`);
  }

  /**
   * Set the workspace directory for agent file operations.
   */
  setWorkspace(newPath: string): void {
    console.log('[AgentManager] Workspace changed:', this.workspace, '->', newPath);
    this.workspace = newPath;
  }

  /**
   * Reset workspace to default project root
   */
  resetWorkspace(): void {
    console.log('[AgentManager] Workspace reset to project root:', this.projectRoot);
    this.workspace = this.projectRoot;
  }

  /**
   * Clean up all per-session state for a deleted session to prevent memory leaks.
   * Call this when a session is permanently removed.
   */
  cleanupSession(sessionId: string): void {
    this.contextUsageBySession.delete(sessionId);
    this.pendingProjectSwitch.delete(sessionId);
    this.pendingModeSwitch.delete(sessionId);
    this.chatEngine?.clearSession(sessionId);
    console.log(`[AgentManager] Cleaned up per-session state for ${sessionId}`);
  }

  private emitStatus(status: AgentStatus): void {
    this.emit('status', status);
  }

  /**
   * Parse database timestamp
   * If user has timezone configured, treat DB timestamps as UTC
   * Otherwise, use system local time (original behavior)
   */
  private parseDbTimestamp(timestamp: string): Date {
    // If already has timezone indicator, parse directly
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(timestamp)) {
      return new Date(timestamp);
    }

    // Check if user has configured a timezone
    const userTimezone = SettingsManager.get('profile.timezone');

    if (userTimezone) {
      // User has timezone set - treat DB timestamps as UTC
      const normalized = timestamp.replace(' ', 'T');
      return new Date(normalized + 'Z');
    } else {
      // No timezone configured - use system local time
      const normalized = timestamp.replace(' ', 'T');
      return new Date(normalized);
    }
  }

  private extractAndStoreFacts(userMessage: string): void {
    if (!this.memory) return;

    const patterns: Array<{ pattern: RegExp; category: string; subject: string }> = [
      { pattern: /my name is (\w+)/i, category: 'user_info', subject: 'name' },
      { pattern: /call me (\w+)/i, category: 'user_info', subject: 'name' },
      { pattern: /i live in ([^.,]+)/i, category: 'user_info', subject: 'location' },
      { pattern: /i'm from ([^.,]+)/i, category: 'user_info', subject: 'location' },
      { pattern: /i work (?:at|for) ([^.,]+)/i, category: 'work', subject: 'employer' },
      { pattern: /i work as (?:a |an )?([^.,]+)/i, category: 'work', subject: 'role' },
      { pattern: /my job is ([^.,]+)/i, category: 'work', subject: 'role' },
    ];

    for (const { pattern, category, subject } of patterns) {
      const match = userMessage.match(pattern);
      if (match && match[1]) {
        this.memory.saveFact(category, subject, match[1].trim());
        console.log(`[AgentManager] Extracted fact: [${category}] ${subject}: ${match[1]}`);
      }
    }
  }

  // ============ Public API ============

  getStats(
    sessionId?: string
  ):
    | (ReturnType<MemoryManager['getStats']> & { contextTokens?: number; contextWindow?: number })
    | null {
    const stats = this.memory?.getStats(sessionId);
    if (!stats) return null;
    const contextUsage = sessionId ? this.contextUsageBySession.get(sessionId) : undefined;
    return {
      ...stats,
      contextTokens: contextUsage?.contextTokens,
      contextWindow: contextUsage?.contextWindow,
    };
  }

  clearConversation(sessionId?: string): void {
    this.memory?.clearConversation(sessionId);
    if (sessionId && this.chatEngine) {
      this.chatEngine.clearSession(sessionId);
    }
    console.log(
      '[AgentManager] Conversation cleared' + (sessionId ? ` (session: ${sessionId})` : '')
    );
  }

  getMemory(): MemoryManager | null {
    return this.memory;
  }

  searchFacts(queryStr: string): Array<{ category: string; subject: string; content: string }> {
    return this.memory?.searchFacts(queryStr) || [];
  }

  saveFact(category: string, subject: string, content: string): void {
    this.memory?.saveFact(category, subject, content);
  }

  /**
   * Get the assembled system prompt for display in the UI.
   */
  getSystemPrompt(): { staticPrompt: string; dynamicPrompt: string } | null {
    if (!this.chatEngine) return null;
    return this.chatEngine.buildSystemPrompt();
  }

  /**
   * Get only developer-controlled prompt sections (System Guidelines).
   * Excludes user-editable content and dynamic injections.
   */
  getDeveloperPrompt(): string | null {
    if (!this.chatEngine) return null;
    return this.chatEngine.getDeveloperPrompt();
  }

  getAllFacts(): Array<{ id: number; category: string; subject: string; content: string }> {
    return this.memory?.getAllFacts() || [];
  }

  getDailyLogsSince(days: number = 3): DailyLog[] {
    return this.memory?.getDailyLogsSince(days) || [];
  }

  getRecentMessages(limit: number = 10, sessionId: string = 'default'): Message[] {
    return this.memory?.getRecentMessages(limit, sessionId) || [];
  }

  cleanup(): void {
    closeBrowserManager();
    console.log('[AgentManager] Cleanup complete');
  }
}

export const AgentManager = AgentManagerClass.getInstance();
