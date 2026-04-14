import Database from 'better-sqlite3';

/** Hard character budget for daily logs injected into the system prompt (~700 tokens) */
export const DAILY_LOGS_CHAR_BUDGET = 2000;

export interface DailyLog {
  id: number;
  date: string;
  content: string;
  updated_at: string;
}

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 */
export function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get a daily log by date (defaults to today)
 */
export function getDailyLog(db: Database.Database, date?: string): DailyLog | null {
  const targetDate = date || getTodayDate();
  const row = db
    .prepare(
      `
      SELECT id, date, content, updated_at
      FROM daily_logs
      WHERE date = ?
    `
    )
    .get(targetDate) as DailyLog | undefined;

  return row || null;
}

/**
 * Append an entry to today's daily log
 * Creates the log if it doesn't exist
 */
export function appendToDailyLog(db: Database.Database, entry: string): DailyLog {
  const today = getTodayDate();
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const formattedEntry = `[${timestamp}] ${entry}`;

  const existing = getDailyLog(db, today);

  if (existing) {
    // Append to existing log
    const newContent = existing.content + '\n' + formattedEntry;
    db.prepare(
      `
        UPDATE daily_logs
        SET content = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))
        WHERE date = ?
      `
    ).run(newContent, today);
  } else {
    // Create new log for today
    db.prepare(
      `
        INSERT INTO daily_logs (date, content, updated_at)
        VALUES (?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')))
      `
    ).run(today, formattedEntry);
  }

  return getDailyLog(db, today)!;
}

/**
 * Get daily logs from the last N calendar days
 */
export function getDailyLogsSince(db: Database.Database, days: number = 3): DailyLog[] {
  // Compute the cutoff in local time (not UTC) so timezone doesn't shift the window
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const year = cutoff.getFullYear();
  const month = String(cutoff.getMonth() + 1).padStart(2, '0');
  const day = String(cutoff.getDate()).padStart(2, '0');
  const cutoffDate = `${year}-${month}-${day}`;

  return db
    .prepare(
      `
      SELECT id, date, content, updated_at
      FROM daily_logs
      WHERE date >= ?
      ORDER BY date DESC
    `
    )
    .all(cutoffDate) as DailyLog[];
}

/**
 * Delete a daily log by ID
 */
export function deleteDailyLog(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM daily_logs WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Prune daily logs older than N days.
 * Called on startup to keep the table clean — only the rolling window is retained.
 */
export function pruneOldDailyLogs(db: Database.Database, days: number = 3): number {
  // Compute cutoff in local time to match how dates are stored
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const year = cutoff.getFullYear();
  const month = String(cutoff.getMonth() + 1).padStart(2, '0');
  const day = String(cutoff.getDate()).padStart(2, '0');
  const cutoffDate = `${year}-${month}-${day}`;

  const result = db.prepare('DELETE FROM daily_logs WHERE date < ?').run(cutoffDate);
  if (result.changes > 0) {
    console.log(`[DailyLogs] Pruned ${result.changes} log(s) older than ${days} days`);
  }
  return result.changes;
}

/**
 * Get daily logs as formatted context string for the agent.
 * Truncates at DAILY_LOGS_CHAR_BUDGET and includes a usage header.
 * Prioritizes most recent logs (today first, then yesterday, etc.).
 */
export function getDailyLogsContext(db: Database.Database, days: number = 3): string {
  const logs = getDailyLogsSince(db, days);
  if (logs.length === 0) {
    return '';
  }

  // Reserve space for the header line
  const headerReserve = 90;
  const contentBudget = DAILY_LOGS_CHAR_BUDGET - headerReserve;

  // Show oldest first (reverse of DESC order from DB)
  const orderedLogs = logs.reverse();

  const includedLines: string[] = [];
  let usedChars = 0;

  for (const log of orderedLogs) {
    const dateLabel = log.date === getTodayDate() ? 'Today' : log.date;
    const logHeader = `\n### ${dateLabel}`;
    const logContent = log.content;
    const additionalChars = logHeader.length + 1 + logContent.length;

    if (usedChars + additionalChars > contentBudget) {
      // Try to include a truncated version of this log
      const remaining = contentBudget - usedChars - logHeader.length - 1;
      if (remaining > 50) {
        includedLines.push(logHeader);
        includedLines.push(logContent.slice(0, remaining) + '...');
      }
      break;
    }

    usedChars += additionalChars;
    includedLines.push(logHeader);
    includedLines.push(logContent);
  }

  // Build header
  const header = `## Recent Daily Logs`;

  return [header, ...includedLines].join('\n');
}

/**
 * Get memory usage stats for the daily logs budget.
 */
export function getDailyLogsMemoryUsage(
  db: Database.Database,
  days: number = 3
): {
  usedChars: number;
  budgetChars: number;
  pct: number;
} {
  const logs = getDailyLogsSince(db, days);

  const headerReserve = 90;
  const contentBudget = DAILY_LOGS_CHAR_BUDGET - headerReserve;
  let usedChars = 0;

  for (const log of logs.reverse()) {
    const dateLabel = log.date === getTodayDate() ? 'Today' : log.date;
    const logHeader = `\n### ${dateLabel}`;
    const additionalChars = logHeader.length + 1 + log.content.length;
    if (usedChars + additionalChars > contentBudget) {
      // Mirror getDailyLogsContext: count partial inclusion when truncated
      const remaining = contentBudget - usedChars - logHeader.length - 1;
      if (remaining > 50) {
        usedChars = contentBudget; // truncated content fills remaining budget
      }
      break;
    }
    usedChars += additionalChars;
  }

  const totalChars = usedChars + headerReserve;
  const pct = Math.round((totalChars / DAILY_LOGS_CHAR_BUDGET) * 100);
  return { usedChars: totalChars, budgetChars: DAILY_LOGS_CHAR_BUDGET, pct };
}
