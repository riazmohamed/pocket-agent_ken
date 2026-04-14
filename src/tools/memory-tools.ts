/**
 * Memory tools for the agent
 *
 * - remember: Save facts to long-term memory
 * - forget: Remove facts from memory
 */

import { MemoryManager } from '../memory';

let memoryManager: MemoryManager | null = null;

export function setMemoryManager(memory: MemoryManager): void {
  memoryManager = memory;
}

/**
 * Remember tool definition
 */
export function getRememberToolDefinition() {
  return {
    name: 'remember',
    description:
      'Save a fact to long-term memory. Keep each fact atomic (under 30 words, one piece of info per call). Use specific keys like "partner_name" not "family". Save proactively when user shares something meaningful.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category: user_info, preferences, projects, people, work, notes, decisions',
        },
        subject: {
          type: 'string',
          description:
            'Specific, descriptive key (e.g., "partner_name", "coffee_preference", "current_project")',
        },
        content: {
          type: 'string',
          description: 'The fact to remember (max 25-30 words, one piece of info only)',
        },
      },
      required: ['category', 'subject', 'content'],
    },
  };
}

/**
 * Remember tool handler
 */
export async function handleRememberTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { category, subject, content } = input as {
    category: string;
    subject: string;
    content: string;
  };

  if (!category || !subject || !content) {
    return JSON.stringify({ error: 'Missing required fields: category, subject, content' });
  }

  const id = memoryManager.saveFact(category, subject, content);
  console.log(`[Remember] Saved: [${category}] ${subject}: ${content}`);

  return JSON.stringify({
    success: true,
    message: `Remembered: ${subject}`,
    id,
    category,
    subject,
  });
}

/**
 * Forget tool definition
 */
export function getForgetToolDefinition() {
  return {
    name: 'forget',
    description:
      'Remove a fact from long-term memory. Forget by category + subject, or by fact ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Category of the fact to forget',
        },
        subject: {
          type: 'string',
          description: 'Subject of the fact to forget',
        },
        id: {
          type: 'number',
          description: 'Fact ID (alternative to category+subject)',
        },
      },
      required: [],
    },
  };
}

/**
 * Forget tool handler
 */
export async function handleForgetTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { category, subject, id } = input as {
    category?: string;
    subject?: string;
    id?: number;
  };

  let deleted: boolean;

  if (id !== undefined) {
    deleted = memoryManager.deleteFact(id);
  } else if (category && subject) {
    deleted = memoryManager.deleteFactBySubject(category, subject);
  } else {
    return JSON.stringify({ error: 'Provide either id OR category+subject' });
  }

  if (deleted) {
    console.log(`[Forget] Deleted: ${id ?? `${category}/${subject}`}`);
    return JSON.stringify({ success: true, message: 'Fact forgotten' });
  } else {
    return JSON.stringify({ success: false, message: 'Fact not found' });
  }
}

/**
 * List facts tool definition (for /facts command)
 */
export function getListFactsToolDefinition() {
  return {
    name: 'list_facts',
    description:
      'List all known facts from memory. Use when user asks "what do you know about me" or similar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Optional: filter by category',
        },
      },
      required: [],
    },
  };
}

/**
 * List facts tool handler
 */
export async function handleListFactsTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { category } = input as { category?: string };

  let facts;
  if (category) {
    facts = memoryManager.getFactsByCategory(category);
  } else {
    facts = memoryManager.getAllFacts();
  }

  if (facts.length === 0) {
    return JSON.stringify({
      success: true,
      message: category ? `No facts in category: ${category}` : 'No facts stored yet',
      facts: [],
    });
  }

  return JSON.stringify({
    success: true,
    count: facts.length,
    facts: facts.map((f) => ({
      id: f.id,
      category: f.category,
      subject: f.subject,
      content: f.content,
    })),
  });
}

/**
 * Memory search tool definition
 */
export function getMemorySearchToolDefinition() {
  return {
    name: 'memory_search',
    description:
      'Search long-term memory using semantic + keyword hybrid search. Use proactively to recall facts about the user. Returns top 6 results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query - can be natural language',
        },
      },
      required: ['query'],
    },
  };
}

/**
 * Memory search tool handler
 */
export async function handleMemorySearchTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { query } = input as { query: string };

  if (!query || query.trim().length === 0) {
    return JSON.stringify({ error: 'Query is required' });
  }

  try {
    const results = await memoryManager.searchFactsHybrid(query);

    if (results.length === 0) {
      return JSON.stringify({
        success: true,
        message: 'No relevant facts found',
        results: [],
      });
    }

    console.log(`[MemorySearch] Found ${results.length} results for: "${query}"`);

    return JSON.stringify({
      success: true,
      count: results.length,
      results: results.map((r) => ({
        id: r.fact.id,
        category: r.fact.category,
        subject: r.fact.subject,
        content: r.fact.content,
        score: Math.round(r.score * 100) / 100,
        vectorScore: Math.round(r.vectorScore * 100) / 100,
        keywordScore: Math.round(r.keywordScore * 100) / 100,
      })),
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[MemorySearch] Failed:', errorMsg);
    return JSON.stringify({ error: errorMsg });
  }
}

/**
 * Daily log tool definition
 */
export function getDailyLogToolDefinition() {
  return {
    name: 'daily_log',
    description:
      "Add an entry to today's daily log. Journal what the user worked on, talked about, decided, or how they seemed.",
    input_schema: {
      type: 'object' as const,
      properties: {
        entry: {
          type: 'string',
          description: 'One concise line describing what happened (auto-timestamped)',
        },
      },
      required: ['entry'],
    },
  };
}

/**
 * Extract meaningful words (>3 chars) from text, lowercased.
 */
function extractWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

/**
 * Check if a new entry is too similar to ANY existing log entry today.
 * Two checks:
 * 1. Word overlap — if >50% of the new entry's words appear in ANY single
 *    existing entry, it's a duplicate.
 * 2. Prefix match — if the first 60 chars of the new entry match the start
 *    of any existing entry (ignoring timestamps), it's a duplicate.
 */
function isDuplicateLogEntry(existingContent: string, newEntry: string): boolean {
  // Split into individual timestamped entries
  const entries = existingContent.split(/\n/).filter((l) => l.startsWith('['));
  if (entries.length === 0) return false;

  const newWords = extractWords(newEntry);
  if (newWords.size === 0) return false;

  // Normalize the new entry for prefix comparison (strip timestamp-like prefixes)
  const newNormalized = newEntry
    .toLowerCase()
    .replace(/^\[.*?\]\s*/, '')
    .slice(0, 60);

  for (const entry of entries) {
    // Check 1: Prefix match against this entry (strip timestamp)
    const entryBody = entry.replace(/^\[.*?\]\s*/, '').toLowerCase();
    if (newNormalized.length >= 20 && entryBody.startsWith(newNormalized)) {
      return true;
    }

    // Check 2: Word overlap against this single entry
    const entryWords = extractWords(entryBody);
    if (entryWords.size === 0) continue;

    let overlap = 0;
    for (const word of newWords) {
      if (entryWords.has(word)) overlap++;
    }

    const overlapPct = overlap / newWords.size;
    if (overlapPct > 0.5) return true;
  }

  return false;
}

/**
 * Daily log tool handler
 */
export async function handleDailyLogTool(input: unknown): Promise<string> {
  if (!memoryManager) {
    return JSON.stringify({ error: 'Memory not initialized' });
  }

  const { entry } = input as { entry: string };

  if (!entry || entry.trim().length === 0) {
    return JSON.stringify({ error: 'Entry is required' });
  }

  // Check for duplicate content against today's log
  const todayLog = memoryManager.getDailyLog();
  if (todayLog && isDuplicateLogEntry(todayLog.content, entry.trim())) {
    console.log(`[DailyLog] Skipped duplicate: ${entry.trim().slice(0, 60)}...`);
    return JSON.stringify({
      success: true,
      message:
        'Skipped — this topic is already logged today. Only log if something materially new happened.',
      date: todayLog.date,
      skipped: true,
    });
  }

  const log = memoryManager.appendToDailyLog(entry.trim());
  console.log(`[DailyLog] Added: ${entry.trim()}`);

  return JSON.stringify({
    success: true,
    message: 'Entry added to daily log',
    date: log.date,
  });
}

/**
 * Get all memory tools
 */
export function getMemoryTools() {
  return [
    {
      ...getRememberToolDefinition(),
      handler: handleRememberTool,
    },
    {
      ...getForgetToolDefinition(),
      handler: handleForgetTool,
    },
    {
      ...getListFactsToolDefinition(),
      handler: handleListFactsTool,
    },
    {
      ...getMemorySearchToolDefinition(),
      handler: handleMemorySearchTool,
    },
    {
      ...getDailyLogToolDefinition(),
      handler: handleDailyLogTool,
    },
  ];
}
