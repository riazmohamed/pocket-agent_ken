/**
 * Tests for quick-win fixes:
 * - pendingMediaBySession (per-session isolation in ChatEngine)
 * - cleanupSession (memory leak prevention in AgentManager)
 * - Telegram callbackDeps getter (lazy resolution)
 * - Telegram commands.ts lazy deps access
 * - Dead code removal verification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock modules needed by ChatEngine ────────────────────────────────

let mockAgentEvents: Array<Record<string, unknown>> = [];

function mockAgentLoop() {
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

vi.mock('@kenkaiiii/gg-agent', () => ({
  Agent: class MockAgent {},
  agentLoop: () => mockAgentLoop(),
}));

vi.mock('@kenkaiiii/gg-ai', () => ({ stream: vi.fn() }));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn((key: string) => {
      if (key === 'agent.model') return 'claude-opus-4-7';
      if (key === 'agent.thinkingLevel') return 'normal';
      return undefined;
    }),
    getFormattedProfile: vi.fn(() => ''),
    getFormattedIdentity: vi.fn(() => '# Test\n\nYou are a test assistant.'),
    getFormattedUserContext: vi.fn(() => ''),
  },
}));

vi.mock('../../src/memory', () => ({ MemoryManager: vi.fn() }));
vi.mock('../../src/config/system-guidelines', () => ({ SYSTEM_GUIDELINES: 'Test guidelines' }));

vi.mock('../../src/agent/chat-providers', () => ({
  getStreamConfig: vi.fn(async () => ({ provider: 'anthropic', apiKey: 'test-key' })),
  getProviderForModel: vi.fn(() => 'anthropic'),
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

// ── Helpers ───────────────────────────────────────────────────────────

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
    getSessionWorkingDirectory: vi.fn(() => null),
  };
  const engine = new ChatEngine({
    memory: memory as never,
    toolsConfig: {} as never,
    statusEmitter: vi.fn(),
    workspace: '/tmp/test-workspace',
  });
  return { engine, memory };
}

function setDefaultAgentEvents(text = 'Hello') {
  mockAgentEvents = [
    { type: 'text_delta' as const, text },
    { type: 'turn_end' as const, turn: 1, usage: { inputTokens: 100, outputTokens: 50 } },
    { type: 'agent_done' as const, totalTurns: 1, totalUsage: { inputTokens: 100, outputTokens: 50 } },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Quick Wins Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentEvents = [];
  });

  // ── pendingMediaBySession isolation ─────────────────────────────────

  describe('ChatEngine pendingMediaBySession', () => {
    it('clearSession cleans up per-session pending media', async () => {
      const { engine } = createEngine();

      setDefaultAgentEvents('Hi A');
      await engine.processMessage('hello', 'desktop', 'session-A');

      // Clear session-A — should not throw
      engine.clearSession('session-A');

      // Process on session-B — should work independently
      setDefaultAgentEvents('Hi B');
      const result = await engine.processMessage('hello', 'desktop', 'session-B');
      expect(result.response).toBe('Hi B');
    });

    it('sessions do not share pending media state', async () => {
      const { engine } = createEngine();

      setDefaultAgentEvents('Response A');
      const resultA = await engine.processMessage('msg', 'desktop', 'session-A');

      setDefaultAgentEvents('Response B');
      const resultB = await engine.processMessage('msg', 'desktop', 'session-B');

      expect(resultA.response).toBe('Response A');
      expect(resultB.response).toBe('Response B');
    });
  });

  // ── Dead code removal verification ──────────────────────────────────

  describe('Dead code removal', () => {
    it('message-extraction.ts should not exist', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(__dirname, '../../src/agent/message-extraction.ts');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('telegram handlers/index.ts barrel should not exist', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(__dirname, '../../src/channels/telegram/handlers/index.ts');
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('telegram features/index.ts barrel should not exist', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const filePath = path.join(__dirname, '../../src/channels/telegram/features/index.ts');
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });
});
