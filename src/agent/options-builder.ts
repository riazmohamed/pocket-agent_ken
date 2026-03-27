/**
 * Options builder for persistent SDK sessions.
 *
 * Extracted from AgentManager.buildPersistentOptions to keep the main
 * class focused on orchestration.
 */

import { MemoryManager } from '../memory';
import { buildMCPServers, buildSdkMcpServers, ToolsConfig } from '../tools';
import { SYSTEM_GUIDELINES } from '../config/system-guidelines';
import { SettingsManager } from '../settings';
import { buildCanUseToolCallback, buildPreToolUseHook } from './safety';
import { getProviderForModel } from './providers';
import { buildTemporalContext } from './context-extraction';
import { getModeConfig } from './agent-modes';
import type { AgentModeId } from './agent-modes';

// ── SDK type aliases (mirrors the ones in index.ts) ──

type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' };

type CanUseToolCallback = (
  toolName: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal; toolUseID: string }
) => Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string; interrupt: boolean }>;

type PreToolUseHookCallback = (input: { tool_name: string; tool_input: unknown }) => Promise<{
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason?: string;
  };
}>;

type TeammateIdleHookCallback = (input: { teammate_name: string; team_name: string }) => Promise<{
  hookSpecificOutput: { hookEventName: 'TeammateIdle' };
}>;

type TaskCompletedHookCallback = (input: {
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
}) => Promise<{
  hookSpecificOutput: { hookEventName: 'TaskCompleted' };
}>;

type UserPromptSubmitHookCallback = (
  input: unknown,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<{
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit';
    additionalContext?: string;
  };
}>;

export type SDKOptions = {
  model?: string;
  cwd?: string;
  maxTurns?: number;
  maxThinkingTokens?: number;
  thinking?: ThinkingConfig;
  effort?: 'low' | 'medium' | 'high' | 'max';
  abortController?: AbortController;
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  allowedTools?: string[];
  persistSession?: boolean;
  resume?: string;
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  mcpServers?: Record<string, unknown>;
  settingSources?: ('project' | 'user')[];
  canUseTool?: CanUseToolCallback;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  env?: { [envVar: string]: string | undefined };
  hooks?: {
    PreToolUse?: Array<{ hooks: PreToolUseHookCallback[] }>;
    UserPromptSubmit?: Array<{ hooks: UserPromptSubmitHookCallback[] }>;
    TeammateIdle?: Array<{ hooks: TeammateIdleHookCallback[] }>;
    TaskCompleted?: Array<{ hooks: TaskCompletedHookCallback[] }>;
  };
};

// Thinking level to config mapping.
const THINKING_CONFIGS: Record<
  string,
  { thinking: ThinkingConfig; effort?: 'low' | 'medium' | 'high' }
> = {
  none: { thinking: { type: 'disabled' } },
  minimal: { thinking: { type: 'enabled', budgetTokens: 2048 }, effort: 'low' },
  normal: { thinking: { type: 'enabled', budgetTokens: 10000 }, effort: 'medium' },
  extended: { thinking: { type: 'adaptive' }, effort: 'high' },
};

// ── Public interface ──

/** Dependencies needed by buildPersistentOptions. */
export interface BuildOptionsConfig {
  model: string;
  workspace: string;
  toolsConfig: ToolsConfig | null;
  /** Emit a status event (for team hooks). */
  emitStatus: (status: {
    type: string;
    teammateName?: string;
    teamName?: string;
    taskId?: string;
    taskSubject?: string;
    message?: string;
  }) => void;
  /** Build provider env vars (no process.env mutation). */
  buildProviderEnv: (model: string) => Promise<Record<string, string | undefined>>;
}

/**
 * Build options for persistent sessions.
 *
 * Static context (identity, instructions, profile, capabilities) goes in systemPrompt.append
 * since it only needs to be set once when the session is created.
 *
 * Dynamic context (temporal, facts, soul, daily logs) is injected per-message via
 * the UserPromptSubmit hook's additionalContext, so it's fresh for each turn.
 */
export async function buildPersistentOptions(
  config: BuildOptionsConfig,
  memory: MemoryManager,
  sessionId: string,
  sdkSessionId?: string
): Promise<SDKOptions> {
  // Determine session mode and get mode config from registry
  const sessionMode = memory.getSessionMode(sessionId) as AgentModeId;
  const modeConfig = getModeConfig(sessionMode);
  const isLeanMode = sessionMode === 'coder'; // Coder gets SDK preset + CLAUDE.md only, no identity/guidelines

  // === Static context (cacheable — hardcoded, never changes mid-session) ===
  // NOTE: CLAUDE.md (instructions) is NOT included here because the SDK
  // already reads it from the workspace via cwd + settingSources: ['project'].
  // Including it here would inject it twice.
  const staticParts: string[] = [];

  // Personalize and guidelines — skipped for coder (uses workspace CLAUDE.md)
  if (isLeanMode) {
    console.log(
      `[AgentManager] ${modeConfig.name} mode — skipping identity, guidelines (SDK uses workspace CLAUDE.md)`
    );
  } else {
    // 1. System Guidelines — operational instructions first (highest attention weight)
    staticParts.push(SYSTEM_GUIDELINES);
    console.log(`[AgentManager] System guidelines injected: ${SYSTEM_GUIDELINES.length} chars`);
  }

  // 2. Mode-specific system prompt (from registry) — always injected, even for coder
  if (modeConfig.systemPrompt) {
    staticParts.push(modeConfig.systemPrompt);
    console.log(`[AgentManager] Mode prompt injected: ${modeConfig.systemPrompt.length} chars`);
  }

  // 3. Identity — agent name, description, personality (skipped for coder)
  if (!isLeanMode) {
    const identity = SettingsManager.getFormattedIdentity();
    if (identity) {
      staticParts.push(identity);
      console.log(`[AgentManager] Identity injected: ${identity.length} chars`);
    }
  }

  // Look up per-session working directory (falls back to global workspace)
  const sessionWorkingDir = memory.getSessionWorkingDirectory(sessionId);
  const effectiveCwd = sessionWorkingDir || config.workspace;
  console.log(
    `[AgentManager] buildPersistentOptions session=${sessionId} mode=${sessionMode} | sessionWorkingDir=${sessionWorkingDir || 'null'} | effectiveCwd=${effectiveCwd}`
  );

  console.log(
    `[AgentManager] ${modeConfig.name} mode prompt — static: ${staticParts.join('\n\n').length} chars`
  );

  // Get thinking level config — only Anthropic models support thinking/effort.
  // Non-Anthropic providers (Kimi, GLM) use Anthropic-compatible APIs but may not
  // handle thinking parameters correctly, causing all output to go to thinking blocks.
  const provider = getProviderForModel(config.model);
  const thinkingLevel = SettingsManager.get('agent.thinkingLevel') || 'normal';
  const thinkingEntry = THINKING_CONFIGS[thinkingLevel] || THINKING_CONFIGS['normal'];
  const isAnthropicModel = provider === 'anthropic';

  // Build provider env vars without mutating process.env (race-safe)
  const providerEnv = await config.buildProviderEnv(config.model);
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...providerEnv,
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
  };
  delete env.CLAUDE_CONFIG_DIR;

  const options: SDKOptions = {
    model: config.model,
    cwd: effectiveCwd,
    maxTurns: 100,
    ...(isAnthropicModel && { thinking: thinkingEntry.thinking }),
    ...(isAnthropicModel && thinkingEntry.effort && { effort: thinkingEntry.effort }),
    tools: { type: 'preset', preset: 'claude_code' },
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: ['project'],
    canUseTool: buildCanUseToolCallback(),
    env,
    hooks: {
      PreToolUse: [buildPreToolUseHook()],
      // Dynamic context injection: fresh facts/soul/temporal for each message
      // Lean modes (coder) skip personal assistant context
      UserPromptSubmit: [
        {
          hooks: [
            async () => {
              if (isLeanMode) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'UserPromptSubmit' as const,
                    additionalContext: '',
                  },
                };
              }

              const dynamicParts: string[] = [];

              // 1. Soul — behavioral guidance (strongest signal)
              const soulContext = memory.getSoulContext();
              if (soulContext) {
                dynamicParts.push(soulContext);
              }

              // 2. User context — profile, goals, struggles, fun facts (editable)
              const userContext = SettingsManager.getFormattedUserContext();
              if (userContext) {
                dynamicParts.push(userContext);
              }

              // 3. Facts — remembered information (updated constantly)
              const factsContext = memory.getFactsForContext();
              if (factsContext) {
                dynamicParts.push(factsContext);
              }

              // 4. Daily logs — recent history
              const dailyLogsContext = memory.getDailyLogsContext(3);
              if (dailyLogsContext) {
                dynamicParts.push(dailyLogsContext);
              }

              // 5. Temporal — current time (least info-dense, last)
              const recentMsgs = memory.getRecentMessages(1, sessionId);
              const lastUserMsg = recentMsgs.find((m) => m.role === 'user');
              const temporalContext = buildTemporalContext(lastUserMsg?.timestamp);
              dynamicParts.push(temporalContext);

              return {
                hookSpecificOutput: {
                  hookEventName: 'UserPromptSubmit' as const,
                  additionalContext: dynamicParts.join('\n\n'),
                },
              };
            },
          ],
        },
      ],
      TeammateIdle: [
        {
          hooks: [
            async (input: { teammate_name: string; team_name: string }) => {
              config.emitStatus({
                type: 'teammate_idle',
                teammateName: input.teammate_name,
                teamName: input.team_name,
                message: `${input.teammate_name} is idle`,
              });
              return { hookSpecificOutput: { hookEventName: 'TeammateIdle' as const } };
            },
          ],
        },
      ],
      TaskCompleted: [
        {
          hooks: [
            async (input: {
              task_id: string;
              task_subject: string;
              task_description?: string;
              teammate_name?: string;
              team_name?: string;
            }) => {
              config.emitStatus({
                type: 'task_completed',
                taskId: input.task_id,
                taskSubject: input.task_subject,
                teammateName: input.teammate_name,
                teamName: input.team_name,
                message: `task done: ${input.task_subject}`,
              });
              return { hookSpecificOutput: { hookEventName: 'TaskCompleted' as const } };
            },
          ],
        },
      ],
    },
    // Use mode registry for allowed tools
    allowedTools: [...modeConfig.allowedTools],
    persistSession: true,
    ...(sdkSessionId && { resume: sdkSessionId }),
  };

  if (staticParts.length > 0) {
    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: staticParts.join('\n\n'),
    };
  }

  if (config.toolsConfig) {
    // Build child process MCP servers (e.g., computer use)
    const mcpServers = buildMCPServers(config.toolsConfig);

    // Build SDK MCP servers (in-process tools — scoped by mode)
    const sdkMcpServers = await buildSdkMcpServers(config.toolsConfig, sessionMode);

    // Merge both types + remote MCP servers (mode-dependent)
    const needsGrep = modeConfig.mcpServers?.includes('grep');
    const allServers: Record<string, unknown> = {
      ...mcpServers,
      ...(sdkMcpServers || {}),
      // Grep MCP — remote code search across 1M+ public GitHub repos
      ...(needsGrep ? { grep: { type: 'http', url: 'https://mcp.grep.app' } } : {}),
    };

    if (Object.keys(allServers).length > 0) {
      options.mcpServers = allServers;
      console.log('[AgentManager] MCP servers:', Object.keys(allServers).join(', '));
    }
  }

  return options;
}
