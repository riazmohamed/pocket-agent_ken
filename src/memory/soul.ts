import Database from 'better-sqlite3';

/** Hard character budget for soul aspects injected into the system prompt (~500 tokens) */
export const SOUL_CHAR_BUDGET = 1500;

export interface SoulAspect {
  id: number;
  aspect: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/**
 * Cache for soul context — invalidated on any soul mutation.
 */
export interface SoulCache {
  soulContextCache: string | null;
  soulContextCacheValid: boolean;
}

/**
 * Create a fresh (empty) SoulCache.
 */
export function createSoulCache(): SoulCache {
  return { soulContextCache: null, soulContextCacheValid: false };
}

/**
 * Set or update a soul aspect. Returns the aspect ID.
 */
export function setSoulAspect(
  db: Database.Database,
  aspect: string,
  content: string,
  cache: SoulCache
): number {
  const existing = db
    .prepare(
      `
      SELECT id FROM soul WHERE aspect = ?
    `
    )
    .get(aspect) as { id: number } | undefined;

  let aspectId: number;

  if (existing) {
    db.prepare(
      `
        UPDATE soul SET content = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?
      `
    ).run(content, existing.id);
    aspectId = existing.id;
  } else {
    const stmt = db.prepare(`
        INSERT INTO soul (aspect, content)
        VALUES (?, ?)
      `);
    const result = stmt.run(aspect, content);
    aspectId = result.lastInsertRowid as number;
  }

  // Invalidate soul context cache
  cache.soulContextCacheValid = false;

  return aspectId;
}

/**
 * Get a specific soul aspect by name.
 */
export function getSoulAspect(db: Database.Database, aspect: string): SoulAspect | null {
  const row = db
    .prepare(
      `
      SELECT id, aspect, content, created_at, updated_at
      FROM soul
      WHERE aspect = ?
    `
    )
    .get(aspect) as SoulAspect | undefined;

  return row || null;
}

/**
 * Get all soul aspects, ordered by aspect name.
 */
export function getAllSoulAspects(db: Database.Database): SoulAspect[] {
  const stmt = db.prepare(`
      SELECT id, aspect, content, created_at, updated_at
      FROM soul
      ORDER BY aspect
    `);
  return stmt.all() as SoulAspect[];
}

/**
 * Delete a soul aspect by name. Returns true if a row was deleted.
 */
export function deleteSoulAspect(db: Database.Database, aspect: string, cache: SoulCache): boolean {
  const stmt = db.prepare('DELETE FROM soul WHERE aspect = ?');
  const result = stmt.run(aspect);
  if (result.changes > 0) {
    cache.soulContextCacheValid = false;
  }
  return result.changes > 0;
}

/**
 * Delete a soul aspect by ID. Returns true if a row was deleted.
 */
export function deleteSoulAspectById(db: Database.Database, id: number, cache: SoulCache): boolean {
  const stmt = db.prepare('DELETE FROM soul WHERE id = ?');
  const result = stmt.run(id);
  if (result.changes > 0) {
    cache.soulContextCacheValid = false;
  }
  return result.changes > 0;
}

/**
 * Get soul aspects formatted for context injection.
 * Truncates at SOUL_CHAR_BUDGET and includes a usage header.
 * Uses the cache to avoid re-computing when nothing has changed.
 */
export function getSoulContext(db: Database.Database, cache: SoulCache): string {
  // Return cached result if valid
  if (cache.soulContextCacheValid && cache.soulContextCache !== null) {
    return cache.soulContextCache;
  }

  const aspects = getAllSoulAspects(db);
  if (aspects.length === 0) {
    cache.soulContextCache = '';
    cache.soulContextCacheValid = true;
    return '';
  }

  // Reserve space for the header line
  const headerReserve = 80;
  const contentBudget = SOUL_CHAR_BUDGET - headerReserve;

  const includedLines: string[] = [];
  let usedChars = 0;

  for (const aspect of aspects) {
    const aspectHeader = `\n### ${aspect.aspect}`;
    const aspectContent = aspect.content;
    const additionalChars = aspectHeader.length + 1 + aspectContent.length; // +1 for newline

    if (usedChars + additionalChars > contentBudget) break;

    usedChars += additionalChars;
    includedLines.push(aspectHeader);
    includedLines.push(aspectContent);
  }

  // Build header
  const header = `## Soul`;

  const result = [header, ...includedLines].join('\n');
  cache.soulContextCache = result;
  cache.soulContextCacheValid = true;
  return result;
}

/**
 * Get memory usage stats for the soul budget.
 */
export function getSoulMemoryUsage(db: Database.Database): {
  usedChars: number;
  budgetChars: number;
  pct: number;
} {
  const aspects = getAllSoulAspects(db);

  const headerReserve = 80;
  const contentBudget = SOUL_CHAR_BUDGET - headerReserve;
  let usedChars = 0;

  for (const aspect of aspects) {
    const aspectHeader = `\n### ${aspect.aspect}`;
    const additionalChars = aspectHeader.length + 1 + aspect.content.length;
    if (usedChars + additionalChars > contentBudget) break;
    usedChars += additionalChars;
  }

  const totalChars = usedChars + headerReserve;
  const pct = Math.round((totalChars / SOUL_CHAR_BUDGET) * 100);
  return { usedChars: totalChars, budgetChars: SOUL_CHAR_BUDGET, pct };
}
