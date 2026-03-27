/**
 * Agent mode registry — defines all available agent personas.
 *
 * Each mode specifies its engine, system prompt, tool access, and UI metadata.
 * The `switch_agent` tool and options builder both reference this registry.
 */

// ── Types ──

export type AgentModeId = 'general' | 'coder' | 'researcher' | 'writer' | 'therapist';

export interface AgentMode {
  id: AgentModeId;
  name: string;
  icon: string;
  engine: 'chat' | 'sdk';
  systemPrompt: string;
  allowedTools: string[];
  mcpServers?: string[];
  description: string;
  /** LLM-facing description of when to hand off to this mode */
  handoffDescription: string;
  /** Which modes this agent can hand off to */
  canHandoffTo: AgentModeId[];
  /** Whether this mode produces technical artifacts (tool calls, file contents, etc.) */
  technicalMode: boolean;
}

/** Context passed to on_handoff callbacks */
export interface HandoffContext {
  sessionId: string;
  fromMode: AgentModeId;
  toMode: AgentModeId;
  reason: string;
  timestamp: Date;
}

export type OnHandoffCallback = (context: HandoffContext) => void | Promise<void>;

// ── Shared tool lists ──

const SDK_CORE_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  // Plan mode
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
  // Agent Teams
  'TeammateTool',
  'TeamCreate',
  'SendMessage',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskList',
  // Background tasks
  'TaskOutput',
  'TaskStop',
  'BashOutput',
  'KillBash',
];

const BROWSER_TOOLS = ['mcp__pocket-agent__browser'];
const NOTIFY_TOOLS = ['mcp__pocket-agent__notify'];
const PROJECT_TOOLS = [
  'mcp__pocket-agent__set_project',
  'mcp__pocket-agent__get_project',
  'mcp__pocket-agent__clear_project',
];
const MEMORY_TOOLS = [
  'mcp__pocket-agent__remember',
  'mcp__pocket-agent__forget',
  'mcp__pocket-agent__list_facts',
  'mcp__pocket-agent__memory_search',
  'mcp__pocket-agent__daily_log',
];
const SOUL_TOOLS = [
  'mcp__pocket-agent__soul_set',
  'mcp__pocket-agent__soul_get',
  'mcp__pocket-agent__soul_list',
  'mcp__pocket-agent__soul_delete',
];
const SCHEDULER_TOOLS = [
  'mcp__pocket-agent__schedule_task',
  'mcp__pocket-agent__create_reminder',
  'mcp__pocket-agent__list_scheduled_tasks',
  'mcp__pocket-agent__delete_scheduled_task',
];
const GREP_TOOLS = ['mcp__grep__searchGitHub'];
const SWITCH_TOOL = ['mcp__pocket-agent__switch_agent'];

// ── System prompts ──

const GENERAL_PROMPT = `## General Mode

You are the user's personal assistant. You handle their day-to-day: scheduling, reminders, quick lookups, task management, conversations, and anything that doesn't require deep specialist work. You have shell access, browser, web search, and all external services.

**How you operate:**
- You're a companion, not a search engine — be conversational, remember context, reference past conversations
- Handle requests end-to-end: don't just tell the user how to do something, do it for them
- Save new information about the user immediately — preferences, plans, people, decisions
- Be proactive — suggest reminders, follow up on past topics, anticipate needs
- If the user needs deep coding, research, writing, or emotional support, switch to the appropriate agent`;

const CODER_PROMPT = ''; // Coder uses SDK claude_code preset + workspace CLAUDE.md — no additional prompt

const RESEARCHER_PROMPT = `## Researcher Mode

You are in deep research mode. Unlike quick lookups, your job is thorough investigation: multiple sources, cross-verification, and structured findings with explicit confidence levels.

**How you operate:**
- Verify before presenting — cross-reference claims across multiple sources
- Use every tool aggressively: web search for discovery, browser for deep reading, shell and Pocket CLI for data extraction
- Structure output: lead with the answer, then evidence, then what you couldn't verify
- Distinguish between established facts, expert opinion, and speculation
- When sources conflict, present both sides — don't pick one silently
- If the request falls outside research, switch back to the appropriate agent`;

const WRITER_PROMPT = `## Writer Mode

You are in focused writing mode. You draft, edit, and refine content that matches the user's voice. You deliberately have no web search or browser — you write from what you know, using memory and soul context for the user's style and preferences.

**How you operate:**
- Clarify audience, tone, and purpose before drafting if not obvious from context
- Check soul memory for the user's communication style and match it — not generic AI voice
- Produce complete drafts, not outlines or bullet points (unless asked)
- Every sentence earns its place — cut filler, be direct, be specific
- When editing existing text, explain what you changed and why
- If the request falls outside writing, switch back to the appropriate agent`;

const THERAPIST_PROMPT = `## Therapist Mode

You are in supportive listening mode. The user wants to talk through something — stress, decisions, feelings, relationships, life direction. You have access to their memory and soul context, so you know their life, goals, struggles, and history.

**How you operate:**
- Listen first. Reflect back what you hear before offering perspective
- Ask thoughtful questions — help them think, don't think for them
- Don't jump to solutions unless they explicitly ask for advice
- Reference what you know about their life, goals, and past conversations when relevant — show you remember
- Validate emotions without being patronizing — no "that must be really hard" on repeat
- Be honest, not just agreeable. If they're avoiding something obvious, gently point it out
- If the conversation shifts to tasks, coding, or research, switch back to the appropriate agent`;

// ── Mode registry ──

export const AGENT_MODES: Record<AgentModeId, AgentMode> = {
  general: {
    id: 'general',
    name: 'General',
    icon: '🐾',
    engine: 'chat',
    systemPrompt: GENERAL_PROMPT,
    allowedTools: [
      ...SDK_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...MEMORY_TOOLS,
      ...SOUL_TOOLS,
      ...SCHEDULER_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['pocket-agent'],
    description: 'Personal assistant — remembers, schedules, browses, manages life',
    handoffDescription: 'General conversation, scheduling, reminders, task management',
    canHandoffTo: ['coder', 'researcher', 'writer', 'therapist'],
    technicalMode: false,
  },
  coder: {
    id: 'coder',
    name: 'Coder',
    icon: '🔧',
    engine: 'sdk',
    systemPrompt: CODER_PROMPT,
    allowedTools: [
      ...SDK_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...GREP_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['pocket-agent', 'grep'],
    description: 'Full coding agent with file access and GitHub search',
    handoffDescription: 'Code, file edits, debugging, programming tasks',
    canHandoffTo: ['general', 'researcher'],
    technicalMode: true,
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    icon: '🔍',
    engine: 'sdk',
    systemPrompt: RESEARCHER_PROMPT,
    allowedTools: [
      ...SDK_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...MEMORY_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['pocket-agent'],
    description: 'Deep research — web search, browsing, note-taking',
    handoffDescription: 'Deep multi-source research, fact-checking, investigation',
    canHandoffTo: ['general', 'coder', 'writer'],
    technicalMode: true,
  },
  writer: {
    id: 'writer',
    name: 'Writer',
    icon: '✍️',
    engine: 'chat',
    systemPrompt: WRITER_PROMPT,
    allowedTools: [...MEMORY_TOOLS, ...SOUL_TOOLS, ...NOTIFY_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['pocket-agent'],
    description: 'Focused writing — no web search, no browser distractions',
    handoffDescription: 'Drafting, editing, content creation — no web distractions',
    canHandoffTo: ['general', 'researcher'],
    technicalMode: false,
  },
  therapist: {
    id: 'therapist',
    name: 'Therapist',
    icon: '💬',
    engine: 'chat',
    systemPrompt: THERAPIST_PROMPT,
    allowedTools: [...MEMORY_TOOLS, ...SOUL_TOOLS, ...NOTIFY_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['pocket-agent'],
    description: 'Supportive listening — talk through stress, decisions, feelings',
    handoffDescription: 'Talk through feelings, stress, decisions, personal matters',
    canHandoffTo: ['general'],
    technicalMode: false,
  },
};

/** All valid mode IDs */
export const ALL_MODE_IDS: AgentModeId[] = Object.keys(AGENT_MODES) as AgentModeId[];

/** Check if a string is a valid mode ID */
export function isValidModeId(mode: string): mode is AgentModeId {
  return mode in AGENT_MODES;
}

/** Get the mode config, falling back to 'coder' for invalid IDs */
export function getModeConfig(mode: string): AgentMode {
  return AGENT_MODES[mode as AgentModeId] || AGENT_MODES.coder;
}

/** Get all modes as an array (for UI rendering) */
export function getAllModes(): AgentMode[] {
  return ALL_MODE_IDS.map((id) => AGENT_MODES[id]);
}

/** Build dynamic routing instructions for injection into system prompt */
export function buildRoutingInstructions(currentMode: AgentModeId): string {
  const config = AGENT_MODES[currentMode];
  const targets = config.canHandoffTo;

  if (targets.length === 0) return '';

  const targetList = targets
    .map((id) => `\`${id}\` — ${AGENT_MODES[id].handoffDescription}`)
    .join('; ');

  return `You can use \`switch_agent\` to hand off when the conversation shifts: ${targetList}. Transfers are seamless — do not announce or draw attention to them.`;
}
