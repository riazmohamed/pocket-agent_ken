/**
 * Chat Engine — Lightweight agent loop for General mode
 *
 * Uses @kenkaiiii/gg-agent Agent class for the agentic loop.
 * System prompt building, memory persistence, and session management
 * remain in-process.
 */

import { agentLoop } from '@kenkaiiii/gg-agent';
import type { AgentOptions } from '@kenkaiiii/gg-agent';
import { stream as ggStream } from '@kenkaiiii/gg-ai';
import type {
  ThinkingLevel,
  Message,
  TextContent,
  ImageContent as GGImageContent,
} from '@kenkaiiii/gg-ai';
import { MemoryManager } from '../memory';
import { ToolsConfig, setCurrentSessionId, runWithSessionId } from '../tools';
import { SettingsManager } from '../settings';
import { SYSTEM_GUIDELINES } from '../config/system-guidelines';
import { getModeConfig, buildRoutingInstructions } from './agent-modes';
import type { AgentModeId } from './agent-modes';
import { getStreamConfig } from './chat-providers';
import { getChatAgentTools } from './chat-tools';
import { buildTemporalContext } from './context-extraction';
import {
  formatToolName,
  formatToolInput as formatToolInputDisplay,
  isPocketCliCommand,
  formatPocketCommand,
  getSubagentMessage,
} from './display-formatting';
import type {
  AgentStatus,
  ImageContent,
  AttachmentInfo,
  ProcessResult,
  MediaAttachment,
} from './index';
import { isHeartbeatOk, stripHeartbeatSuffix } from '../utils/heartbeat';

// Conversation history uses gg-ai Message type (user/assistant only)
type MessageParam = Message;

const MAX_TOOL_ITERATIONS = 20;
const MAX_CONTEXT_MESSAGES = 80;

// Model context window sizes (tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
  'kimi-k2.5': 128_000,
  'glm-5.1': 200_000,
  'glm-5-turbo': 200_000,
  'glm-4.7': 128_000,
};

function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? 200_000;
}

// Map settings thinking level to gg-ai ThinkingLevel
const THINKING_LEVEL_MAP: Record<string, ThinkingLevel | undefined> = {
  none: undefined,
  minimal: 'low',
  normal: 'medium',
  extended: 'high',
};

interface ChatEngineConfig {
  memory: MemoryManager;
  toolsConfig: ToolsConfig;
  statusEmitter: (status: AgentStatus) => void;
}

/**
 * In-process chat engine using @kenkaiiii/gg-agent Agent class.
 */
export class ChatEngine {
  private memory: MemoryManager;
  private toolsConfig: ToolsConfig;
  private emitStatus: (status: AgentStatus) => void;
  private conversationsBySession: Map<string, MessageParam[]> = new Map();
  private abortControllersBySession: Map<string, AbortController> = new Map();
  private processingBySession: Map<string, boolean> = new Map();
  private messageQueueBySession: Map<
    string,
    Array<{
      message: string;
      channel: string;
      images?: ImageContent[];
      attachmentInfo?: AttachmentInfo;
      resolve: (result: ProcessResult) => void;
      reject: (error: Error) => void;
    }>
  > = new Map();
  private pendingMediaBySession: Map<string, MediaAttachment[]> = new Map();

  constructor(config: ChatEngineConfig) {
    this.memory = config.memory;
    this.toolsConfig = config.toolsConfig;
    this.emitStatus = config.statusEmitter;

    // Wire up the summarizer for smart context / compaction
    this.memory.setSummarizer(async (messages) => {
      const summaryModel = 'claude-haiku-4-5-20251001';
      const currentModel = SettingsManager.get('agent.model') || 'claude-haiku-4-5-20251001';
      const prompt = messages.map((m) => `[${m.role}]: ${m.content}`).join('\n');
      const query = `Summarize this conversation concisely, preserving key facts, decisions, and context:\n\n${prompt}`;

      for (const model of [summaryModel, currentModel]) {
        try {
          const streamCfg = await getStreamConfig(model);
          const result = ggStream({
            provider: streamCfg.provider,
            model,
            maxTokens: 1024,
            messages: [{ role: 'user', content: query }],
            apiKey: streamCfg.apiKey,
            baseUrl: streamCfg.baseUrl,
          });
          const response = await result.response;
          const textParts = (
            Array.isArray(response.message.content)
              ? response.message.content
              : [{ type: 'text' as const, text: response.message.content }]
          ).filter((p): p is TextContent => p.type === 'text');
          return textParts.map((p) => p.text).join('') || '';
        } catch (err) {
          if (model === summaryModel) {
            console.error('[ChatEngine] Summarizer failed, falling back to current model:', err);
            continue;
          }
          throw err;
        }
      }
      return '';
    });
    console.log('[ChatEngine] Summarizer wired up');
  }

  /**
   * Process a user message through the Chat engine.
   */
  async processMessage(
    userMessage: string,
    channel: string,
    sessionId: string = 'default',
    images?: ImageContent[],
    attachmentInfo?: AttachmentInfo
  ): Promise<ProcessResult> {
    if (this.processingBySession.get(sessionId)) {
      return this.queueMessage(userMessage, channel, sessionId, images, attachmentInfo);
    }
    return this.executeMessage(userMessage, channel, sessionId, images, attachmentInfo);
  }

  private queueMessage(
    userMessage: string,
    channel: string,
    sessionId: string,
    images?: ImageContent[],
    attachmentInfo?: AttachmentInfo
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      if (!this.messageQueueBySession.has(sessionId)) {
        this.messageQueueBySession.set(sessionId, []);
      }
      const queue = this.messageQueueBySession.get(sessionId)!;
      queue.push({ message: userMessage, channel, images, attachmentInfo, resolve, reject });

      this.emitStatus({
        type: 'queued',
        sessionId,
        queuePosition: queue.length,
        queuedMessage: userMessage.slice(0, 100),
        message: `in the litter queue (#${queue.length})`,
      });
    });
  }

  private async processQueue(sessionId: string): Promise<void> {
    const queue = this.messageQueueBySession.get(sessionId);
    if (!queue || queue.length === 0) return;

    const next = queue.shift()!;
    this.emitStatus({
      type: 'queue_processing',
      sessionId,
      queuedMessage: next.message.slice(0, 100),
      message: 'digging it up now...',
    });

    try {
      const result = await this.executeMessage(
        next.message,
        next.channel,
        sessionId,
        next.images,
        next.attachmentInfo
      );
      next.resolve(result);
    } catch (error) {
      next.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Execute a message — sets session context then delegates to inner logic.
   */
  private async executeMessage(
    userMessage: string,
    channel: string,
    sessionId: string,
    images?: ImageContent[],
    attachmentInfo?: AttachmentInfo
  ): Promise<ProcessResult> {
    setCurrentSessionId(sessionId);
    return runWithSessionId(sessionId, () =>
      this.executeMessageInner(userMessage, channel, sessionId, images, attachmentInfo)
    );
  }

  /**
   * Core message processing: build context, create Agent, iterate events, save to memory.
   */
  private async executeMessageInner(
    userMessage: string,
    channel: string,
    sessionId: string,
    images?: ImageContent[],
    attachmentInfo?: AttachmentInfo
  ): Promise<ProcessResult> {
    this.processingBySession.set(sessionId, true);
    this.pendingMediaBySession.set(sessionId, []);

    const abortController = new AbortController();
    this.abortControllersBySession.set(sessionId, abortController);

    try {
      // Load or get conversation history
      if (!this.conversationsBySession.has(sessionId)) {
        await this.loadConversationFromMemory(sessionId);
      }
      const conversation = this.conversationsBySession.get(sessionId)!;

      // Build timestamped user message
      const now = new Date();
      const timeTag = `[${now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}]`;
      const timestampedMessage = `${timeTag} ${userMessage}`;
      const userContent = this.buildUserContent(timestampedMessage, images);
      conversation.push({ role: 'user', content: userContent });

      // Compact if needed
      const wasCompacted = await this.compactConversation(sessionId, userMessage);

      // Build system prompt
      const { staticPrompt, dynamicPrompt } = this.buildSystemPrompt(sessionId, channel);
      const systemPrompt = `${staticPrompt}\n\n${dynamicPrompt}`;

      // Get model + provider config
      const model = SettingsManager.get('agent.model') || 'claude-opus-4-6';
      const streamConfig = await getStreamConfig(model);
      const agentTools = getChatAgentTools(this.toolsConfig);

      // Map thinking level
      const thinkingLevel = SettingsManager.get('agent.thinkingLevel') || 'normal';
      const thinking =
        thinkingLevel in THINKING_LEVEL_MAP
          ? THINKING_LEVEL_MAP[thinkingLevel]
          : THINKING_LEVEL_MAP['normal'];

      console.log(
        `[ChatEngine] Session config — model: ${model}, thinking: ${thinkingLevel}→${thinking ?? 'disabled'}, provider: ${streamConfig.provider}`
      );

      this.emitStatus({ type: 'thinking', sessionId, message: '*stretches paws* thinking...' });

      // Build Agent options
      const agentOptions: AgentOptions = {
        provider: streamConfig.provider,
        model,
        tools: agentTools,
        webSearch: true,
        maxTurns: MAX_TOOL_ITERATIONS,
        maxTokens: 16384,
        thinking,
        apiKey: streamConfig.apiKey,
        baseUrl: streamConfig.baseUrl,
        signal: abortController.signal,
        cacheRetention: streamConfig.provider === 'anthropic' ? 'short' : 'none',
      };

      // Build the full messages array: system + conversation history (which already includes the new user message)
      const messages: MessageParam[] = [{ role: 'system', content: systemPrompt }, ...conversation];

      console.log(
        `[ChatEngine] Sending ${messages.length} messages to agentLoop (${conversation.length} conversation + 1 system)`
      );

      // Run agentLoop directly with full conversation context
      const loop = agentLoop(messages, agentOptions);

      // Iterate agent events
      let response = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheRead = 0;
      let totalCacheWrite = 0;
      // Track active subagents for status display
      const activeSubagents = new Map<string, { type: string; description: string }>();
      // Track whether a tool call happened since last text, so we can insert a separator
      let hadToolSinceLastText = false;

      for await (const event of loop) {
        switch (event.type) {
          case 'text_delta': {
            // If text resumes after a tool call, insert a newline separator
            let delta = event.text;
            if (hadToolSinceLastText && response.length > 0) {
              const separator = '\n\n';
              response += separator;
              this.emitStatus({
                type: 'partial_text',
                sessionId,
                partialText: separator,
                message: 'composing...',
              });
            }
            hadToolSinceLastText = false;
            response += delta;
            this.emitStatus({
              type: 'partial_text',
              sessionId,
              partialText: delta,
              message: 'composing...',
            });
            break;
          }

          case 'tool_call_start': {
            const toolName = formatToolName(event.name);
            const toolInput = formatToolInputDisplay(event.args);

            // Subagent tool — show purple subagent indicator
            if (event.name === 'subagent') {
              const args = event.args as { task?: string; agent?: string };
              const agentType = args.agent || 'general';
              const description = args.task?.slice(0, 80) || 'working on it';
              const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              activeSubagents.set(agentId, { type: agentType, description });

              this.emitStatus({
                type: 'subagent_start',
                sessionId,
                agentId,
                agentType,
                toolInput: description,
                agentCount: activeSubagents.size,
                message: getSubagentMessage(agentType),
              });
              break;
            }

            // Shell command — check for pocket CLI
            if (event.name === 'shell_command') {
              const isPocket = isPocketCliCommand(event.args);
              if (isPocket) {
                const pocketName = formatPocketCommand(event.args);
                this.emitStatus({
                  type: 'tool_start',
                  sessionId,
                  toolName: pocketName,
                  toolInput,
                  message: `${pocketName}...`,
                  isPocketCli: true,
                });
              } else {
                this.emitStatus({
                  type: 'tool_start',
                  sessionId,
                  toolName,
                  toolInput,
                  message: toolInput ? `running ${toolInput}...` : `${toolName}...`,
                  isPocketCli: false,
                });
              }
              break;
            }

            // All other tools — use friendly formatted name
            this.emitStatus({
              type: 'tool_start',
              sessionId,
              toolName,
              toolInput,
              message: `${toolName}...`,
            });
            break;
          }

          case 'tool_call_end': {
            hadToolSinceLastText = true;
            // Check if a subagent just finished
            if (activeSubagents.size > 0) {
              const firstKey = activeSubagents.keys().next().value;
              if (firstKey) activeSubagents.delete(firstKey);

              if (activeSubagents.size > 0) {
                this.emitStatus({
                  type: 'subagent_update',
                  sessionId,
                  agentCount: activeSubagents.size,
                  message: `${activeSubagents.size} kitty${activeSubagents.size > 1 ? 'ies' : ''} still hunting`,
                });
              } else {
                this.emitStatus({
                  type: 'subagent_end',
                  sessionId,
                  agentCount: 0,
                  message: 'squad done! cleaning up...',
                });
              }
            } else {
              this.emitStatus({
                type: 'tool_end',
                sessionId,
                message: 'caught it! processing...',
              });
            }
            break;
          }

          case 'server_tool_call':
            this.emitStatus({
              type: 'tool_start',
              sessionId,
              toolName: formatToolName(event.name),
              message: 'prowling the web...',
            });
            break;

          case 'server_tool_result':
            this.emitStatus({
              type: 'tool_end',
              sessionId,
              message: 'found some stuff!',
            });
            break;

          case 'turn_end': {
            const u = event.usage;
            totalInputTokens += u.inputTokens;
            totalOutputTokens += u.outputTokens;
            totalCacheRead += u.cacheRead ?? 0;
            totalCacheWrite += u.cacheWrite ?? 0;

            const turnTotal = u.inputTokens + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
            const hitPct = turnTotal > 0 ? Math.round(((u.cacheRead ?? 0) / turnTotal) * 100) : 0;
            console.log(
              `[ChatEngine] Turn ${event.turn} — in: ${u.inputTokens}, out: ${u.outputTokens}, cache_read: ${u.cacheRead ?? 0}, cache_create: ${u.cacheWrite ?? 0}, cache_hit: ${hitPct}%`
            );
            break;
          }

          case 'agent_done': {
            const tu = event.totalUsage;
            const overallIn = tu.inputTokens + (tu.cacheRead ?? 0) + (tu.cacheWrite ?? 0);
            const overallHit =
              overallIn > 0 ? Math.round(((tu.cacheRead ?? 0) / overallIn) * 100) : 0;
            console.log(
              `[ChatEngine] Done — ${event.totalTurns} turn(s), ${tu.inputTokens + tu.outputTokens} total tokens (in: ${tu.inputTokens}, out: ${tu.outputTokens}), cache_hit: ${overallHit}%, cache_read: ${tu.cacheRead ?? 0}, cache_create: ${tu.cacheWrite ?? 0}`
            );
            break;
          }

          case 'error':
            console.error('[ChatEngine] Agent error event:', event.error);
            this.emitStatus({
              type: 'thinking',
              sessionId,
              message: 'hit a snag, recovering...',
            });
            break;

          // thinking_delta — internal chain-of-thought, not user-facing
          // tool_call_update — onUpdate from tools, no tools use it yet
          // steering_message — internal framework steering
        }
      }

      // Update in-memory conversation with the final assistant response
      // (Agent manages its own internal messages, but we track for session persistence)
      if (response) {
        conversation.push({ role: 'assistant', content: response });
      }

      this.emitStatus({ type: 'done', sessionId });

      if (!response) {
        response = 'Task completed (no details available).';
      }

      // Save to memory
      const totalTokens = totalInputTokens + totalOutputTokens;
      this.saveToMemory(userMessage, response, channel, sessionId, images, attachmentInfo);

      return {
        response,
        tokensUsed: totalTokens,
        wasCompacted,
        media:
          (this.pendingMediaBySession.get(sessionId) || []).length > 0
            ? this.pendingMediaBySession.get(sessionId)
            : undefined,
        contextTokens: totalInputTokens + totalCacheRead + totalCacheWrite,
        contextWindow: getContextWindow(model),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (errorMsg.includes('aborted') || errorMsg.includes('interrupted')) {
        this.emitStatus({ type: 'done', sessionId });
        return { response: '', tokensUsed: 0, wasCompacted: false };
      }

      console.error('[ChatEngine] Query failed:', errorMsg);

      this.memory.saveMessage('user', userMessage, sessionId);
      this.memory.saveMessage('assistant', errorMsg, sessionId, { isError: true });

      throw error;
    } finally {
      this.processingBySession.delete(sessionId);
      this.abortControllersBySession.delete(sessionId);
      this.pendingMediaBySession.delete(sessionId);

      setTimeout(() => {
        this.processQueue(sessionId).catch((err) => {
          console.error('[ChatEngine] Queue processing failed:', err);
        });
      }, 0);
    }
  }

  /**
   * Save user + assistant messages to memory and trigger embedding.
   */
  private saveToMemory(
    userMessage: string,
    response: string,
    channel: string,
    sessionId: string,
    images?: ImageContent[],
    attachmentInfo?: AttachmentInfo
  ): void {
    const isScheduledJob = channel.startsWith('cron:');

    if (isScheduledJob && isHeartbeatOk(response)) return;

    let messageToSave = stripHeartbeatSuffix(userMessage);

    // Convert reminder prompts
    const reminderMatch = messageToSave.match(
      /^\[SCHEDULED REMINDER - DELIVER NOW\]\nThe user previously asked to be reminded about: "(.+?)"\n\nDeliver this reminder/
    );
    if (reminderMatch) {
      messageToSave = `Reminder: ${reminderMatch[1]}`;
    }

    // Build metadata
    let metadata: Record<string, unknown> | undefined;
    if (channel.startsWith('cron:')) {
      metadata = { source: 'scheduler', jobName: channel.slice(5) };
    } else if (channel === 'telegram') {
      const hasAttachment = attachmentInfo?.hasAttachment ?? (images && images.length > 0);
      const attachmentType =
        attachmentInfo?.attachmentType ?? (images && images.length > 0 ? 'photo' : undefined);
      metadata = { source: 'telegram', hasAttachment, attachmentType };
    } else if (channel === 'ios') {
      metadata = { source: 'ios' };
    }

    const userMsgId = this.memory.saveMessage('user', messageToSave, sessionId, metadata);
    const assistantMetadata = metadata ? { source: metadata.source } : undefined;
    const assistantMsgId = this.memory.saveMessage(
      'assistant',
      response,
      sessionId,
      assistantMetadata
    );

    // Embed asynchronously
    this.memory
      .embedMessage(userMsgId)
      .catch((e) => console.error('[ChatEngine] Failed to embed user message:', e));
    this.memory
      .embedMessage(assistantMsgId)
      .catch((e) => console.error('[ChatEngine] Failed to embed assistant message:', e));
  }

  // ─── User content building ─────────────────────────────────────

  private buildUserContent(
    message: string,
    images?: ImageContent[]
  ): string | (TextContent | GGImageContent)[] {
    if (!images || images.length === 0) return message;

    const content: (TextContent | GGImageContent)[] = [{ type: 'text', text: message }];
    for (const img of images) {
      content.push({
        type: 'image',
        mediaType: img.mediaType,
        data: img.data,
      });
    }
    return content;
  }

  // ─── System prompt building ────────────────────────────────────

  /**
   * Build system prompt split into static (cacheable) and dynamic (per-turn) parts.
   */
  buildSystemPrompt(
    sessionId?: string,
    channel?: string
  ): { staticPrompt: string; dynamicPrompt: string } {
    // === Static context (cacheable — hardcoded, never changes mid-session) ===
    const staticParts: string[] = [];

    // 1. System guidelines — operational instructions first (highest attention weight)
    staticParts.push(SYSTEM_GUIDELINES);
    console.log(`[ChatEngine] System guidelines injected: ${SYSTEM_GUIDELINES.length} chars`);

    // 2. Mode prompt — specializes behavior for this agent mode
    const sessionMode = (
      sessionId ? this.memory.getSessionMode(sessionId) : 'general'
    ) as AgentModeId;
    const modeConfig = getModeConfig(sessionMode);
    if (modeConfig.systemPrompt) {
      staticParts.push(modeConfig.systemPrompt);
      console.log(
        `[ChatEngine] Mode prompt injected (${sessionMode}): ${modeConfig.systemPrompt.length} chars`
      );
    }

    // 2b. Dynamic routing instructions — mode-specific handoff targets
    const routingInstructions = buildRoutingInstructions(sessionMode);
    if (routingInstructions) {
      staticParts.push(routingInstructions);
      console.log(
        `[ChatEngine] Routing instructions injected (${sessionMode}): ${routingInstructions.length} chars`
      );
    }

    // 3. Identity — agent name, description, personality
    const identity = SettingsManager.getFormattedIdentity();
    if (identity) {
      staticParts.push(identity);
      console.log(`[ChatEngine] Identity injected: ${identity.length} chars`);
    }

    // === Dynamic context (per-turn — can change between messages) ===
    const dynamicParts: string[] = [];

    // 1. Soul — behavioral guidance for working with this user (strongest signal)
    const soul = this.memory.getSoulContext();
    if (soul) {
      dynamicParts.push(soul);
      console.log(`[ChatEngine] Soul injected: ${soul.length} chars`);
    }

    // 2. User context — profile, goals, struggles, fun facts (editable in settings)
    const userContext = SettingsManager.getFormattedUserContext();
    if (userContext) {
      dynamicParts.push(userContext);
      console.log(`[ChatEngine] User context injected: ${userContext.length} chars`);
    }

    // 3. Facts — remembered information about the user (updated constantly)
    const facts = this.memory.getFactsForContext();
    if (facts) {
      dynamicParts.push(facts);
      console.log(`[ChatEngine] Facts injected: ${facts.length} chars`);
    }

    // 4. Daily logs — recent conversation history (skip for scheduled/routine runs)
    const isScheduledRun = channel?.startsWith('cron:');
    if (!isScheduledRun) {
      const dailyLogs = this.memory.getDailyLogsContext(3);
      if (dailyLogs) {
        dynamicParts.push(dailyLogs);
        console.log(`[ChatEngine] Daily logs injected: ${dailyLogs.length} chars`);
      }
    }

    // 5. Temporal — current time (least info-dense, last position)
    const lastUserMsg = sessionId ? this.getLastUserMessageTimestamp(sessionId) : undefined;
    const temporal = this.buildTemporalContext(lastUserMsg);
    dynamicParts.push(temporal);
    console.log(`[ChatEngine] Temporal context injected: ${temporal.length} chars`);

    const staticPrompt = staticParts.join('\n\n');
    const dynamicPrompt = dynamicParts.join('\n\n');
    console.log(
      `[ChatEngine] ${sessionMode} mode prompt — static: ${staticPrompt.length} chars, dynamic: ${dynamicPrompt.length} chars, total: ${staticPrompt.length + dynamicPrompt.length} chars`
    );

    return { staticPrompt, dynamicPrompt };
  }

  private getLastUserMessageTimestamp(sessionId: string): string | undefined {
    try {
      const messages = this.memory.getRecentMessages(1, sessionId);
      if (messages.length > 0) return messages[0].timestamp;
    } catch {
      /* ignore */
    }
    return undefined;
  }

  private buildTemporalContext(lastMessageTimestamp?: string): string {
    return buildTemporalContext(lastMessageTimestamp);
  }

  /**
   * Get the developer-controlled prompt (System Guidelines).
   */
  getDeveloperPrompt(): string {
    return SYSTEM_GUIDELINES;
  }

  // ─── Conversation loading & compaction ─────────────────────────

  /**
   * Load conversation history from SQLite.
   * Uses smart context (rolling summary + recent) for longer sessions.
   * Applies history filtering based on the target mode (strips technical noise for non-technical modes).
   */
  async loadConversationFromMemory(sessionId: string): Promise<void> {
    const messageCount = this.memory.getSessionMessageCount(sessionId);
    const sessionMode = this.memory.getSessionMode(sessionId) as AgentModeId;

    if (messageCount <= MAX_CONTEXT_MESSAGES) {
      const messages = this.memory.getRecentMessages(MAX_CONTEXT_MESSAGES, sessionId);
      const conversation: MessageParam[] = [];
      for (const msg of messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          conversation.push({ role: msg.role, content: msg.content });
        }
      }
      const cleaned = this.filterHistoryForMode(this.cleanConversation(conversation), sessionMode);
      this.conversationsBySession.set(sessionId, cleaned);
      console.log(`[ChatEngine] Loaded ${cleaned.length} messages for session ${sessionId}`);
      return;
    }

    try {
      const smartContext = await this.memory.getSmartContext(sessionId, {
        recentMessageLimit: 40,
        rollingSummaryInterval: 30,
        semanticRetrievalCount: 0,
      });

      const conversation: MessageParam[] = [];
      if (smartContext.rollingSummary) {
        conversation.push({ role: 'user', content: '[System: Previous conversation summary]' });
        conversation.push({ role: 'assistant', content: smartContext.rollingSummary });
      }
      for (const msg of smartContext.recentMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          conversation.push({ role: msg.role, content: msg.content });
        }
      }

      const cleaned = this.filterHistoryForMode(this.cleanConversation(conversation), sessionMode);
      this.conversationsBySession.set(sessionId, cleaned);
      console.log(
        `[ChatEngine] Loaded ${cleaned.length} messages with smart context for session ${sessionId} (summary: ${smartContext.rollingSummary ? 'yes' : 'no'})`
      );
    } catch (err) {
      console.error(
        '[ChatEngine] Smart context load failed, falling back to recent messages:',
        err
      );
      const messages = this.memory.getRecentMessages(MAX_CONTEXT_MESSAGES, sessionId);
      const conversation: MessageParam[] = [];
      for (const msg of messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          conversation.push({ role: msg.role, content: msg.content });
        }
      }
      const cleaned = this.filterHistoryForMode(this.cleanConversation(conversation), sessionMode);
      this.conversationsBySession.set(sessionId, cleaned);
      console.log(
        `[ChatEngine] Fallback loaded ${cleaned.length} messages for session ${sessionId}`
      );
    }
  }

  /**
   * Filter conversation history based on the target mode.
   * Non-technical modes (writer, therapist) get tool calls and technical artifacts stripped
   * to reduce noise and save context tokens.
   */
  private filterHistoryForMode(
    conversation: MessageParam[],
    targetMode: AgentModeId
  ): MessageParam[] {
    const modeConfig = getModeConfig(targetMode);
    if (modeConfig.technicalMode) return conversation;

    // Patterns that indicate technical tool output
    const technicalPatterns = [
      /^```(?:diff|json|typescript|javascript|python|bash|shell|xml|yaml|html|css)/m,
      /^\s*\d+[→│|]\s/m, // Line-numbered file content (e.g., "  42→  const x = 1")
      /^(?:Reading|Writing|Editing|Searching|Running) (?:file|command)/im,
      /\[tool_(?:use|result)\]/i,
      /^(?:---|@@|\+\+\+|---) /m, // Diff hunks
    ];

    let strippedCount = 0;
    const filtered = conversation.map((msg): MessageParam => {
      if (typeof msg.content !== 'string') return msg;

      const isTechnical = technicalPatterns.some((p) => p.test(msg.content as string));
      if (!isTechnical) return msg;

      strippedCount++;
      // For user messages with technical content, keep the conversational part
      if (msg.role === 'user') {
        const lines = (msg.content as string).split('\n');
        const conversational = lines.filter((line) => !technicalPatterns.some((p) => p.test(line)));
        const kept = conversational.join('\n').trim();
        return {
          role: 'user',
          content: kept || '[Previous technical request]',
        };
      }

      // For assistant messages with technical output, replace with summary
      return {
        role: 'assistant',
        content: '[Previous technical response — details omitted for this mode]',
      };
    });

    if (strippedCount > 0) {
      console.log(
        `[ChatEngine] History filter: stripped technical content from ${strippedCount} messages for ${targetMode} mode`
      );
    }

    return filtered;
  }

  private cleanConversation(conversation: MessageParam[]): MessageParam[] {
    while (conversation.length > 0 && conversation[0].role !== 'user') {
      conversation.shift();
    }

    const cleaned: MessageParam[] = [];
    for (const msg of conversation) {
      if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === msg.role) {
        const prev = cleaned[cleaned.length - 1];
        const prevText = typeof prev.content === 'string' ? prev.content : '';
        const curText = typeof msg.content === 'string' ? msg.content : '';
        prev.content = prevText + '\n\n' + curText;
      } else {
        cleaned.push({ ...msg });
      }
    }
    return cleaned;
  }

  private async compactConversation(sessionId: string, currentQuery: string): Promise<boolean> {
    const conversation = this.conversationsBySession.get(sessionId);
    if (!conversation || conversation.length <= MAX_CONTEXT_MESSAGES) return false;

    try {
      const smartContext = await this.memory.getSmartContext(sessionId, {
        recentMessageLimit: 40,
        rollingSummaryInterval: 30,
        semanticRetrievalCount: 5,
        currentQuery,
      });

      const newConversation: MessageParam[] = [];
      if (smartContext.rollingSummary) {
        newConversation.push({ role: 'user', content: '[System: Previous conversation summary]' });
        newConversation.push({ role: 'assistant', content: smartContext.rollingSummary });
      }
      for (const msg of smartContext.recentMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          newConversation.push({ role: msg.role, content: msg.content });
        }
      }
      while (newConversation.length > 0 && newConversation[0].role !== 'user') {
        newConversation.shift();
      }

      this.conversationsBySession.set(sessionId, newConversation);
      console.log(
        `[ChatEngine] Compacted: ${conversation.length} -> ${newConversation.length} messages (summary: ${smartContext.rollingSummary ? 'yes' : 'no'})`
      );
      return true;
    } catch (err) {
      console.error('[ChatEngine] Compaction failed, falling back to naive trim:', err);
      const trimTo = Math.floor(MAX_CONTEXT_MESSAGES * 0.75);
      const trimmed = conversation.slice(-trimTo);
      while (trimmed.length > 0 && trimmed[0].role !== 'user') {
        trimmed.shift();
      }
      this.conversationsBySession.set(sessionId, trimmed);
      return false;
    }
  }

  // ─── Session management ────────────────────────────────────────

  stopQuery(sessionId?: string): boolean {
    if (sessionId) {
      const queue = this.messageQueueBySession.get(sessionId);
      if (queue) {
        for (const item of queue) item.reject(new Error('Queue cleared'));
        this.messageQueueBySession.delete(sessionId);
      }

      const controller = this.abortControllersBySession.get(sessionId);
      if (controller && this.processingBySession.get(sessionId)) {
        controller.abort();
        return true;
      }
      return false;
    }

    for (const [sid, isProcessing] of this.processingBySession.entries()) {
      if (isProcessing) {
        const controller = this.abortControllersBySession.get(sid);
        if (controller) {
          controller.abort();
          return true;
        }
      }
    }
    return false;
  }

  isQueryProcessing(sessionId?: string): boolean {
    if (sessionId) return this.processingBySession.get(sessionId) || false;
    for (const v of this.processingBySession.values()) {
      if (v) return true;
    }
    return false;
  }

  clearSession(sessionId: string): void {
    this.conversationsBySession.delete(sessionId);
    this.pendingMediaBySession.delete(sessionId);
  }
}
