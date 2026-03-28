/**
 * Pure display formatting functions for agent tool/status display.
 * These have ZERO state access — they only transform inputs to display strings.
 */

/**
 * Get a fun status message for a subagent type.
 */
export function getSubagentMessage(agentType: string): string {
  const messages: Record<string, string> = {
    Explore: 'sent a curious kitten to explore',
    Plan: 'calling in the architect cat',
    Bash: 'summoning a terminal tabby',
    'general-purpose': 'summoning a helper kitty',
  };
  return messages[agentType] || `summoning ${agentType} cat friend`;
}

/**
 * Convert a raw tool name to a cat-themed display name.
 */
export function formatToolName(name: string): string {
  // Fun, cat-themed tool names that match PA's vibe
  const friendlyNames: Record<string, string> = {
    // SDK built-in tools
    Read: 'sniffing this file',
    Write: 'scratching notes down',
    Edit: 'pawing at some code',
    Bash: 'hacking at the terminal',
    Glob: 'hunting for files',
    Grep: 'digging through code',
    WebSearch: 'prowling the web',
    WebFetch: 'fetching that page',
    Task: 'summoning a helper kitty',
    NotebookEdit: 'editing notebook',

    // Memory tools
    remember: 'stashing in my cat brain',
    forget: 'knocking it off the shelf',
    list_facts: 'checking my memories',
    memory_search: 'sniffing through archives',

    // Browser tool
    browser: 'pouncing on browser',

    // Computer use tool
    computer: 'walking on the keyboard',

    // Scheduler tools
    schedule_task: 'setting an alarm meow',
    list_scheduled_tasks: 'checking the schedule',
    delete_scheduled_task: 'knocking that off',

    // macOS tools
    notify: 'sending a meow',

    // Soul tools
    soul_set: 'shaping my personality',
    soul_get: 'checking my vibe',
    soul_list: 'listing my traits',
    soul_delete: 'shedding a trait',

    // Project tools
    set_project: 'setting up the workspace',
    get_project: 'checking the workspace',
    clear_project: 'clearing the workspace',

    // Agent tools
    switch_agent: 'shapeshifting to another form',
    web_fetch: 'fetching that page',
    shell_command: 'hacking at the terminal',
    subagent: 'summoning a helper kitty',

    // Agent Teams tools
    TeammateTool: 'rallying the squad',
    TeamCreate: 'rallying the squad',
    SendMessage: 'passing a note',
    TaskCreate: 'creating a team task',
    TaskGet: 'checking task details',
    TaskUpdate: 'updating team task',
    TaskList: 'listing team tasks',
    TaskOutput: 'checking background task',
    TaskStop: 'stopping background task',
    BashOutput: 'checking background command',
    KillBash: 'killing background command',
  };
  return friendlyNames[name] || name;
}

/**
 * Format tool input into a concise display string.
 */
export function formatToolInput(input: unknown): string {
  if (!input) return '';
  // Extract meaningful info from tool input
  if (typeof input === 'string') return input.slice(0, 100);
  const inp = input as Record<string, string | number[] | undefined>;

  // File operations
  if (inp.file_path) return inp.file_path as string;
  if (inp.notebook_path) return inp.notebook_path as string;

  // Search/patterns
  if (inp.pattern) return inp.pattern as string;
  if (inp.query) return inp.query as string;

  // Commands
  if (inp.command) return (inp.command as string).slice(0, 80);

  // Web
  if (inp.url) return inp.url as string;

  // Agent/Task
  if (inp.prompt) return (inp.prompt as string).slice(0, 80);
  if (inp.description) return (inp.description as string).slice(0, 80);

  // Memory tools
  if (inp.category && inp.subject) return `${inp.category}/${inp.subject}`;
  if (inp.content) return (inp.content as string).slice(0, 80);

  // Browser tool
  if (inp.action) {
    const browserActions: Record<string, string> = {
      navigate: inp.url ? `→ ${inp.url}` : 'navigating',
      screenshot: 'capturing screen',
      click: inp.selector ? `clicking ${inp.selector}` : 'clicking',
      type: inp.text ? `typing "${(inp.text as string).slice(0, 30)}"` : 'typing',
      evaluate: 'running script',
      extract: (inp.extract_type as string) || 'extracting data',
    };
    return browserActions[inp.action as string] || (inp.action as string);
  }

  // Computer use
  if (inp.coordinate && Array.isArray(inp.coordinate) && inp.coordinate.length >= 2) {
    return `at (${inp.coordinate[0]}, ${inp.coordinate[1]})`;
  }
  if (inp.text) return `"${(inp.text as string).slice(0, 40)}"`;

  // Agent Teams tools
  if (inp.to && inp.message) return `→ ${inp.to}: ${(inp.message as string).slice(0, 60)}`;
  if (inp.name && inp.team_name) return `${inp.name} in ${inp.team_name}`;
  if (inp.name) return inp.name as string;

  return '';
}

/**
 * Check if a Bash tool input is a pocket CLI command.
 */
export function isPocketCliCommand(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const command = (input as Record<string, unknown>).command;
  if (typeof command !== 'string') return false;
  return command.trimStart().startsWith('pocket');
}

/**
 * Format a pocket CLI command into a friendly display string.
 */
export function formatPocketCommand(input: unknown): string {
  if (!input || typeof input !== 'object') return 'running pocket cli';
  const command = ((input as Record<string, unknown>).command as string) || '';
  const parts = command.trimStart().split(/\s+/);
  const subcommand = parts[1] || '';
  const categories: Record<string, string> = {
    news: 'fetching the latest news',
    utility: 'running pocket utility',
    knowledge: 'checking the knowledge base',
    dev: 'querying dev tools',
    commands: 'listing pocket commands',
    setup: 'configuring pocket',
    integrations: 'checking integrations',
  };
  return categories[subcommand] || 'running pocket cli';
}
