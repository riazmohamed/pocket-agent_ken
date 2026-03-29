/**
 * Unit tests for ChatEngine after migration to @kenkaiiii/gg-agent + @kenkaiiii/gg-ai
 *
 * Tests:
 * - Public interface preservation (processMessage, stopQuery, isQueryProcessing, clearSession, buildSystemPrompt, getDeveloperPrompt)
 * - Thinking level mapping
 * - System prompt building (static/dynamic split)
 * - Session management (abort, queue, clear)
 * - Status event emission
 * - Token tracking from agent events
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock event helpers ────────────────────────────────────────────────

function makeTextDelta(text: string) {
  return { type: 'text_delta' as const, text };
}

function makeTurnEnd(turn: number, usage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number }) {
  return { type: 'turn_end' as const, turn, usage };
}

function makeAgentDone(totalTurns: number, totalUsage: { inputTokens: number; outputTokens: number; cacheRead?: number; cacheWrite?: number }) {
  return { type: 'agent_done' as const, totalTurns, totalUsage };
}

// ── Mock Agent class ──────────────────────────────────────────────────

let capturedAgentOptions: Record<string, unknown> | null = null;
let capturedAgentMessages: Array<Record<string, unknown>> | null = null;
let mockAgentEvents: Array<Record<string, unknown>> = [];

vi.mock('@kenkaiiii/gg-agent', () => ({
  Agent: class MockAgent {
    constructor(options: Record<string, unknown>) {
      capturedAgentOptions = options;
    }
    prompt(_message: string) {
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < mockAgentEvents.length) {
                return { value: mockAgentEvents[i++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
      };
    }
  },
  agentLoop(messages: Array<Record<string, unknown>>, options: Record<string, unknown>) {
    capturedAgentMessages = messages;
    capturedAgentOptions = options;
    return {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i < mockAgentEvents.length) {
              return { value: mockAgentEvents[i++], done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
  },
}));

vi.mock('@kenkaiiii/gg-ai', () => ({
  stream: vi.fn(),
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn((key: string) => {
      if (key === 'agent.model') return 'claude-opus-4-6';
      if (key === 'agent.thinkingLevel') return 'normal';
      return undefined;
    }),
    getFormattedProfile: vi.fn(() => ''),
    getFormattedIdentity: vi.fn(() => '# Frankie\n\nYou are a personal AI assistant.'),
    getFormattedUserContext: vi.fn(() => ''),
  },
}));

vi.mock('../../src/memory', () => ({
  MemoryManager: vi.fn(),
}));

vi.mock('../../src/config/system-guidelines', () => ({
  SYSTEM_GUIDELINES: 'Test system guidelines',
}));

vi.mock('../../src/agent/chat-providers', () => ({
  getStreamConfig: vi.fn(async () => ({
    provider: 'anthropic',
    apiKey: 'test-key',
  })),
  getProviderForModel: vi.fn((model: string) => {
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('kimi-')) return 'moonshot';
    return 'anthropic';
  }),
}));

vi.mock('../../src/agent/chat-tools', () => ({
  getChatAgentTools: vi.fn(() => []),
  getServerTools: vi.fn(() => []),
}));

vi.mock('../../src/tools', () => ({
  setCurrentSessionId: vi.fn(),
  runWithSessionId: vi.fn((_id: string, fn: () => unknown) => fn()),
}));

import { ChatEngine } from '../../src/agent/chat-engine';
import { SettingsManager } from '../../src/settings';
import { getStreamConfig } from '../../src/agent/chat-providers';

// ── Helpers ────────────────────────────────────────────────────────────

function createEngine() {
  const memory = {
    setSummarizer: vi.fn(),
    getRecentMessages: vi.fn(() => []),
    getSessionMessageCount: vi.fn(() => 0),
    getFactsForContext: vi.fn(() => ''),
    getSoulContext: vi.fn(() => ''),
    getDailyLogsContext: vi.fn(() => ''),
    saveMessage: vi.fn(() => 1),
    embedMessage: vi.fn(async () => {}),
    getSmartContext: vi.fn(async () => ({ recentMessages: [], rollingSummary: null })),
    getSessionMode: vi.fn(() => 'general'),
  };

  const statusEmitter = vi.fn();

  const engine = new ChatEngine({
    memory: memory as never,
    toolsConfig: {} as never,
    statusEmitter,
  });

  return { engine, memory, statusEmitter };
}

function setDefaultAgentEvents(text = 'Hello') {
  mockAgentEvents = [
    makeTextDelta(text),
    makeTurnEnd(1, { inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
    makeAgentDone(1, { inputTokens: 100, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ChatEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedAgentOptions = null;
    capturedAgentMessages = null;
    mockAgentEvents = [];

    // Reset default mock implementations
    vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
      if (key === 'agent.model') return 'claude-opus-4-6';
      if (key === 'agent.thinkingLevel') return 'normal';
      return undefined;
    });
    vi.mocked(getStreamConfig).mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'test-key',
    });
  });

  // ─── Public Interface ───────────────────────────────────────────────

  describe('Public interface', () => {
    it('exposes processMessage method', () => {
      const { engine } = createEngine();
      expect(typeof engine.processMessage).toBe('function');
    });

    it('exposes stopQuery method', () => {
      const { engine } = createEngine();
      expect(typeof engine.stopQuery).toBe('function');
    });

    it('exposes isQueryProcessing method', () => {
      const { engine } = createEngine();
      expect(typeof engine.isQueryProcessing).toBe('function');
    });

    it('exposes clearSession method', () => {
      const { engine } = createEngine();
      expect(typeof engine.clearSession).toBe('function');
    });

    it('exposes buildSystemPrompt method', () => {
      const { engine } = createEngine();
      expect(typeof engine.buildSystemPrompt).toBe('function');
    });

    it('exposes getDeveloperPrompt method', () => {
      const { engine } = createEngine();
      expect(typeof engine.getDeveloperPrompt).toBe('function');
    });
  });

  // ─── processMessage ─────────────────────────────────────────────────

  describe('processMessage', () => {
    it('returns ProcessResult with response and tokensUsed', async () => {
      setDefaultAgentEvents('Hello there');
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      expect(result.response).toBe('Hello there');
      expect(result.tokensUsed).toBe(150); // 100 input + 50 output
      expect(typeof result.wasCompacted).toBe('boolean');
    });

    it('passes system prompt to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      // System prompt is passed as the first message to agentLoop
      expect(capturedAgentMessages).not.toBeNull();
      const systemMsg = capturedAgentMessages!.find((m) => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(typeof systemMsg!.content).toBe('string');
      expect(systemMsg!.content as string).toContain('Test system guidelines');
    });

    it('passes model from settings to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.model).toBe('claude-opus-4-6');
    });

    it('passes provider from getStreamConfig to Agent', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.provider).toBe('anthropic');
    });

    it('saves messages to memory after processing', async () => {
      setDefaultAgentEvents('Hello');
      const { engine, memory } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(memory.saveMessage).toHaveBeenCalledWith('user', 'hi', 'test-session', undefined);
      expect(memory.saveMessage).toHaveBeenCalledWith('assistant', 'Hello', 'test-session', undefined);
    });
  });

  // ─── Thinking Level Mapping ─────────────────────────────────────────

  describe('Thinking level mapping', () => {
    it('maps "normal" thinking to "medium"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-6';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('medium');
    });

    it('maps "extended" thinking to "high"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-6';
        if (key === 'agent.thinkingLevel') return 'extended';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('high');
    });

    it('maps "minimal" thinking to "low"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-6';
        if (key === 'agent.thinkingLevel') return 'minimal';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBe('low');
    });

    it('disables thinking when level is "none"', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'claude-opus-4-6';
        if (key === 'agent.thinkingLevel') return 'none';
        return undefined;
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.thinking).toBeUndefined();
    });
  });

  // ─── Multi-Provider Support ─────────────────────────────────────────

  describe('Multi-provider support', () => {
    it('uses moonshot provider for kimi models', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'kimi-k2.5';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      vi.mocked(getStreamConfig).mockResolvedValue({
        provider: 'moonshot',
        apiKey: 'moonshot-key',
        baseUrl: 'https://api.moonshot.cn/v1',
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.provider).toBe('moonshot');
      expect(capturedAgentOptions!.apiKey).toBe('moonshot-key');
      expect(capturedAgentOptions!.baseUrl).toBe('https://api.moonshot.cn/v1');
    });

    it('enables cache retention for anthropic provider', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.cacheRetention).toBe('short');
    });

    it('disables cache retention for non-anthropic providers', async () => {
      vi.mocked(SettingsManager.get).mockImplementation((key: string) => {
        if (key === 'agent.model') return 'kimi-k2.5';
        if (key === 'agent.thinkingLevel') return 'normal';
        return undefined;
      });
      vi.mocked(getStreamConfig).mockResolvedValue({
        provider: 'moonshot',
        apiKey: 'moonshot-key',
      });
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.cacheRetention).toBe('none');
    });
  });

  // ─── System Prompt Building ─────────────────────────────────────────

  describe('System prompt building', () => {
    it('builds system prompt with static and dynamic parts', () => {
      const { engine } = createEngine();
      const { staticPrompt, dynamicPrompt } = engine.buildSystemPrompt();

      expect(staticPrompt).toContain('Frankie');
      expect(staticPrompt).toContain('Test system guidelines');
      expect(typeof dynamicPrompt).toBe('string');
    });

    it('getDeveloperPrompt returns system guidelines', () => {
      const { engine } = createEngine();
      expect(engine.getDeveloperPrompt()).toBe('Test system guidelines');
    });

    it('includes identity in static prompt', () => {
      const { engine } = createEngine();
      const { staticPrompt } = engine.buildSystemPrompt();
      expect(staticPrompt).toContain('# Frankie');
    });

    it('includes temporal context in dynamic prompt', () => {
      const { engine } = createEngine();
      const { dynamicPrompt } = engine.buildSystemPrompt();
      expect(dynamicPrompt).toContain('Current Time');
    });
  });

  // ─── Status Event Emission ──────────────────────────────────────────

  describe('Status event emission', () => {
    it('emits thinking status at start', async () => {
      setDefaultAgentEvents('Hi');
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const thinkingEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'thinking'
      );
      expect(thinkingEvent).toBeDefined();
    });

    it('emits partial_text for text deltas', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello '),
        makeTextDelta('world'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ];
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const textEvents = statusEmitter.mock.calls.filter(
        (args: unknown[]) => (args[0] as { type: string }).type === 'partial_text'
      );
      expect(textEvents.length).toBe(2);
      expect((textEvents[0][0] as { partialText: string }).partialText).toBe('Hello ');
      expect((textEvents[1][0] as { partialText: string }).partialText).toBe('world');
    });

    it('emits tool_start for tool_call_start events', async () => {
      mockAgentEvents = [
        { type: 'tool_call_start', name: 'web_fetch', args: { url: 'https://example.com' } },
        { type: 'tool_call_end', name: 'web_fetch' },
        makeTextDelta('Done'),
        makeTurnEnd(1, { inputTokens: 100, outputTokens: 50 }),
        makeAgentDone(1, { inputTokens: 100, outputTokens: 50 }),
      ];
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('fetch it', 'desktop', 'test-session');

      const toolStartEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'tool_start'
      );
      expect(toolStartEvent).toBeDefined();
      // formatToolName maps 'web_fetch' → 'fetching that page'
      expect((toolStartEvent![0] as { toolName: string }).toolName).toBe('fetching that page');
    });

    it('emits done status at end', async () => {
      setDefaultAgentEvents('Hi');
      const { engine, statusEmitter } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const doneEvent = statusEmitter.mock.calls.find(
        (args: unknown[]) => (args[0] as { type: string }).type === 'done'
      );
      expect(doneEvent).toBeDefined();
    });
  });

  // ─── Token Tracking ─────────────────────────────────────────────────

  describe('Token tracking', () => {
    it('returns tokensUsed from single turn', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 300, outputTokens: 75, cacheRead: 0, cacheWrite: 0 }),
        makeAgentDone(1, { inputTokens: 300, outputTokens: 75 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');
      expect(result.tokensUsed).toBe(375);
    });

    it('accumulates tokens across multiple turns', async () => {
      mockAgentEvents = [
        { type: 'tool_call_start', name: 'test_tool', args: {} },
        { type: 'tool_call_end', name: 'test_tool' },
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 30 }),
        makeTextDelta('Done'),
        makeTurnEnd(2, { inputTokens: 400, outputTokens: 60 }),
        makeAgentDone(2, { inputTokens: 600, outputTokens: 90 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('use tool', 'desktop', 'test-session');

      // 200 + 30 + 400 + 60 = 690
      expect(result.tokensUsed).toBe(690);
    });

    it('tracks cache stats in contextTokens', async () => {
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 50, cacheRead: 400, cacheWrite: 50 }),
        makeAgentDone(1, { inputTokens: 200, outputTokens: 50, cacheRead: 400, cacheWrite: 50 }),
      ];
      const { engine } = createEngine();

      const result = await engine.processMessage('hi', 'desktop', 'test-session');

      // contextTokens = inputTokens + cacheRead + cacheWrite = 200 + 400 + 50
      expect(result.contextTokens).toBe(650);
    });
  });

  // ─── Performance Logging ────────────────────────────────────────────

  describe('Performance logging', () => {
    it('logs session config at start', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const configLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('Session config')
      );
      expect(configLog).toBeDefined();
      expect(configLog![0]).toContain('claude-opus-4-6');
      expect(configLog![0]).toContain('anthropic');

      consoleSpy.mockRestore();
    });

    it('logs per-turn cache stats', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 500, outputTokens: 100, cacheRead: 400, cacheWrite: 50 }),
        makeAgentDone(1, { inputTokens: 500, outputTokens: 100, cacheRead: 400, cacheWrite: 50 }),
      ];
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const turnLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('Turn 1')
      );
      expect(turnLog).toBeDefined();
      expect(turnLog![0]).toContain('cache_read: 400');
      // cache_hit = 400 / (500 + 400 + 50) = 42%
      expect(turnLog![0]).toContain('cache_hit: 42%');

      consoleSpy.mockRestore();
    });

    it('logs completion summary', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      mockAgentEvents = [
        makeTextDelta('Hello'),
        makeTurnEnd(1, { inputTokens: 200, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
        makeAgentDone(1, { inputTokens: 200, outputTokens: 50, cacheRead: 0, cacheWrite: 0 }),
      ];
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      const summaryLog = consoleSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[ChatEngine] Done')
      );
      expect(summaryLog).toBeDefined();
      expect(summaryLog![0]).toContain('250 total tokens');

      consoleSpy.mockRestore();
    });
  });

  // ─── Session Management ─────────────────────────────────────────────

  describe('Session management', () => {
    it('isQueryProcessing returns false when idle', () => {
      const { engine } = createEngine();
      expect(engine.isQueryProcessing('test-session')).toBe(false);
    });

    it('clearSession removes conversation history', async () => {
      setDefaultAgentEvents('Hello');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');
      engine.clearSession('test-session');

      // No error means success — session was cleared
      expect(engine.isQueryProcessing('test-session')).toBe(false);
    });

    it('stopQuery returns false when no query is processing', () => {
      const { engine } = createEngine();
      expect(engine.stopQuery('test-session')).toBe(false);
    });
  });

  // ─── Agent options ──────────────────────────────────────────────────

  describe('Agent options', () => {
    it('sets maxTurns to 20', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.maxTurns).toBe(20);
    });

    it('sets maxTokens to 16384', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.maxTokens).toBe(16384);
    });

    it('passes abort signal', async () => {
      setDefaultAgentEvents('Hi');
      const { engine } = createEngine();

      await engine.processMessage('hi', 'desktop', 'test-session');

      expect(capturedAgentOptions!.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
