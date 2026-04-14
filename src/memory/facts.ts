import Database from 'better-sqlite3';
import {
  hasEmbeddings,
  embed,
  initEmbeddings,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
} from './embeddings';

// ============ Types ============

export interface Fact {
  id: number;
  category: string;
  subject: string;
  content: string;
  importance: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  fact: Fact;
  score: number;
  vectorScore: number;
  keywordScore: number;
}

/**
 * Cache for facts context — invalidated on any fact mutation.
 */
export interface FactsCache {
  contextCache: string | null;
  contextCacheValid: boolean;
  embeddingsReady: boolean;
}

/**
 * Create a fresh (empty) FactsCache.
 */
export function createFactsCache(): FactsCache {
  return { contextCache: null, contextCacheValid: false, embeddingsReady: false };
}

// ============ Memory budget constants ============

/** Hard character budget for facts injected into the system prompt (~1,000 tokens) */
export const FACTS_CHAR_BUDGET = 3000;

// ============ Search constants ============

const VECTOR_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;
const MIN_SCORE_THRESHOLD = 0.35;
const MAX_SEARCH_RESULTS = 6;

// ============ Embedding methods ============

/**
 * Initialize embeddings with OpenAI API key
 */
export function initializeEmbeddings(openaiApiKey: string, cache: FactsCache): void {
  initEmbeddings(openaiApiKey);
  cache.embeddingsReady = true;
  console.log('[Memory] Embeddings initialized');
}

/**
 * Embed facts that don't have embeddings yet
 */
export async function embedMissingFacts(db: Database.Database): Promise<void> {
  if (!hasEmbeddings()) return;

  const factsWithoutEmbeddings = db
    .prepare(
      `
      SELECT f.id, f.category, f.subject, f.content, f.importance, f.last_accessed_at, f.created_at, f.updated_at
      FROM facts f
      LEFT JOIN chunks c ON f.id = c.fact_id
      WHERE c.id IS NULL
      LIMIT 100
    `
    )
    .all() as Fact[];

  if (factsWithoutEmbeddings.length === 0) return;

  console.log(`[Memory] Embedding ${factsWithoutEmbeddings.length} facts...`);

  // Process in parallel batches of 5 to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < factsWithoutEmbeddings.length; i += batchSize) {
    const batch = factsWithoutEmbeddings.slice(i, i + batchSize);
    await Promise.all(batch.map((fact) => embedFact(db, fact)));
  }

  console.log('[Memory] Finished embedding facts');
}

/**
 * Generate and store embedding for a fact
 */
export async function embedFact(db: Database.Database, fact: Fact): Promise<void> {
  if (!hasEmbeddings()) return;

  try {
    // Combine fact fields for embedding
    const textToEmbed = `${fact.category}: ${fact.subject} - ${fact.content}`;
    const embedding = await embed(textToEmbed);
    const embeddingBuffer = serializeEmbedding(embedding);

    // Delete existing chunk for this fact
    db.prepare('DELETE FROM chunks WHERE fact_id = ?').run(fact.id);

    // Insert new chunk with embedding
    db.prepare(
      `
        INSERT INTO chunks (fact_id, content, embedding)
        VALUES (?, ?, ?)
      `
    ).run(fact.id, textToEmbed, embeddingBuffer);
  } catch (err) {
    console.error(`[Memory] Failed to embed fact ${fact.id}:`, err);
  }
}

// ============ Fact CRUD methods ============

/**
 * Save a fact to long-term memory (with embedding)
 */
export function saveFact(
  db: Database.Database,
  category: string,
  subject: string,
  content: string,
  cache: FactsCache
): number {
  const existing = db
    .prepare(
      `
      SELECT id FROM facts WHERE category = ? AND subject = ?
    `
    )
    .get(category, subject) as { id: number } | undefined;

  let factId: number;

  if (existing) {
    db.prepare(
      `
        UPDATE facts SET content = ?, updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id = ?
      `
    ).run(content, existing.id);
    factId = existing.id;
  } else {
    const stmt = db.prepare(`
        INSERT INTO facts (category, subject, content)
        VALUES (?, ?, ?)
      `);
    const result = stmt.run(category, subject, content);
    factId = result.lastInsertRowid as number;
  }

  // Invalidate facts context cache
  cache.contextCacheValid = false;

  // Embed the fact asynchronously
  if (hasEmbeddings()) {
    const fact: Fact = {
      id: factId,
      category,
      subject,
      content,
      importance: 50,
      last_accessed_at: null,
      created_at: '',
      updated_at: '',
    };
    embedFact(db, fact).catch((err) => {
      console.error(`[Memory] Failed to embed fact ${factId}:`, err);
    });
  }

  return factId;
}

/**
 * Get all facts ordered by category and subject.
 */
export function getAllFacts(db: Database.Database): Fact[] {
  const stmt = db.prepare(`
      SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
      FROM facts
      ORDER BY category, subject
    `);
  return stmt.all() as Fact[];
}

/**
 * Format a single fact line for context injection.
 */
function formatFactLine(fact: Fact): string {
  return fact.subject ? `- **${fact.subject}**: ${fact.content}` : `- ${fact.content}`;
}

/**
 * Get facts formatted for context injection.
 * Sorts by importance DESC, truncates at FACTS_CHAR_BUDGET, and includes
 * a usage header with memory pressure warning when >80% full.
 * Uses the cache to avoid re-computing when nothing has changed.
 */
export function getFactsForContext(db: Database.Database, cache: FactsCache): string {
  // Return cached result if valid (avoids repeated DB queries on every message)
  if (cache.contextCacheValid && cache.contextCache !== null) {
    return cache.contextCache;
  }

  // Fetch facts sorted by importance DESC, then recency
  const facts = db
    .prepare(
      `SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
       FROM facts
       ORDER BY importance DESC, updated_at DESC`
    )
    .all() as Fact[];

  if (facts.length === 0) {
    cache.contextCache = '';
    cache.contextCacheValid = true;
    return '';
  }

  // Build fact lines, accumulating chars up to budget
  // Reserve space for the header line (estimated ~80 chars max)
  const headerReserve = 100;
  const contentBudget = FACTS_CHAR_BUDGET - headerReserve;

  const includedFacts: Fact[] = [];
  const byCategory = new Map<string, Fact[]>();
  let usedChars = 0;

  for (const fact of facts) {
    const line = formatFactLine(fact);
    // Account for category header if this is the first fact in its category
    const categoryHeader = byCategory.has(fact.category) ? '' : `\n### ${fact.category}\n`;
    const additionalChars = categoryHeader.length + line.length + 1; // +1 for newline

    if (usedChars + additionalChars > contentBudget) break;

    usedChars += additionalChars;
    includedFacts.push(fact);

    const list = byCategory.get(fact.category) || [];
    list.push(fact);
    byCategory.set(fact.category, list);
  }

  // Update last_accessed_at for included facts
  if (includedFacts.length > 0) {
    const ids = includedFacts.map((f) => f.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE facts SET last_accessed_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  // Build header
  const header = `## Known Facts`;

  const lines: string[] = [header];
  for (const [category, categoryFacts] of byCategory) {
    lines.push(`\n### ${category}`);
    for (const fact of categoryFacts) {
      lines.push(formatFactLine(fact));
    }
  }

  const result = lines.join('\n');
  cache.contextCache = result;
  cache.contextCacheValid = true;
  return result;
}

/**
 * Get memory usage stats for the facts budget.
 */
export function getFactsMemoryUsage(db: Database.Database): {
  usedChars: number;
  budgetChars: number;
  pct: number;
} {
  const facts = db
    .prepare(
      `SELECT category, subject, content FROM facts ORDER BY importance DESC, updated_at DESC`
    )
    .all() as Array<{ category: string; subject: string; content: string }>;

  const headerReserve = 100;
  const contentBudget = FACTS_CHAR_BUDGET - headerReserve;
  const seenCategories = new Set<string>();
  let usedChars = 0;

  for (const fact of facts) {
    const line = fact.subject ? `- **${fact.subject}**: ${fact.content}` : `- ${fact.content}`;
    const categoryHeader = seenCategories.has(fact.category) ? '' : `\n### ${fact.category}\n`;
    const additionalChars = categoryHeader.length + line.length + 1;

    if (usedChars + additionalChars > contentBudget) break;

    usedChars += additionalChars;
    seenCategories.add(fact.category);
  }

  const totalChars = usedChars + headerReserve;
  const pct = Math.round((totalChars / FACTS_CHAR_BUDGET) * 100);
  return { usedChars: totalChars, budgetChars: FACTS_CHAR_BUDGET, pct };
}

/**
 * Delete a fact by ID. Returns true if a row was deleted.
 */
export function deleteFact(db: Database.Database, id: number, cache: FactsCache): boolean {
  // Chunks will be deleted by CASCADE
  const stmt = db.prepare('DELETE FROM facts WHERE id = ?');
  const result = stmt.run(id);
  if (result.changes > 0) {
    cache.contextCacheValid = false; // Invalidate cache
  }
  return result.changes > 0;
}

/**
 * Delete a fact by category + subject. Returns true if a row was deleted.
 */
export function deleteFactBySubject(
  db: Database.Database,
  category: string,
  subject: string,
  cache: FactsCache
): boolean {
  const stmt = db.prepare('DELETE FROM facts WHERE category = ? AND subject = ?');
  const result = stmt.run(category, subject);
  if (result.changes > 0) {
    cache.contextCacheValid = false; // Invalidate cache
  }
  return result.changes > 0;
}

// ============ Search methods ============

/**
 * Hybrid semantic + keyword search for facts
 */
export async function searchFactsHybrid(
  db: Database.Database,
  query: string
): Promise<SearchResult[]> {
  const results: Map<number, SearchResult> = new Map();

  // Determine weights based on whether embeddings are available
  const embeddingsAvailable = hasEmbeddings();
  const vectorWeight = embeddingsAvailable ? VECTOR_WEIGHT : 0;
  const keywordWeight = embeddingsAvailable ? KEYWORD_WEIGHT : 1.0; // 100% weight when no embeddings
  const scoreThreshold = embeddingsAvailable ? MIN_SCORE_THRESHOLD : 0.15; // Lower threshold for keyword-only

  // 1. Vector search (if embeddings available)
  if (embeddingsAvailable) {
    try {
      const queryEmbedding = await embed(query);

      // Limit chunks to prevent loading entire table into memory
      const chunks = db
        .prepare(
          `
          SELECT c.fact_id, c.embedding, f.id, f.category, f.subject, f.content, f.importance, f.last_accessed_at, f.created_at, f.updated_at
          FROM chunks c
          JOIN facts f ON c.fact_id = f.id
          WHERE c.embedding IS NOT NULL
          ORDER BY c.created_at DESC
          LIMIT 500
        `
        )
        .all() as Array<{
        fact_id: number;
        embedding: Buffer;
        id: number;
        category: string;
        subject: string;
        content: string;
        importance: number;
        last_accessed_at: string | null;
        created_at: string;
        updated_at: string;
      }>;

      for (const chunk of chunks) {
        const chunkEmbedding = deserializeEmbedding(chunk.embedding);
        // Validate embedding before computing similarity
        if (
          !chunkEmbedding ||
          chunkEmbedding.length === 0 ||
          chunkEmbedding.length !== queryEmbedding.length
        ) {
          continue; // Skip invalid embeddings
        }
        const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);

        const fact: Fact = {
          id: chunk.id,
          category: chunk.category,
          subject: chunk.subject,
          content: chunk.content,
          importance: chunk.importance,
          last_accessed_at: chunk.last_accessed_at,
          created_at: chunk.created_at,
          updated_at: chunk.updated_at,
        };

        results.set(chunk.id, {
          fact,
          score: similarity * vectorWeight,
          vectorScore: similarity,
          keywordScore: 0,
        });
      }
    } catch (err) {
      console.error('[Memory] Vector search failed:', err);
    }
  }

  // 2. Keyword search using FTS5
  try {
    // Strip all non-alphanumeric characters (except spaces) to prevent FTS5 syntax errors
    // FTS5 operators include: AND, OR, NOT, NEAR, *, ^, ", ', (), column: filters
    const escapedQuery = query.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (escapedQuery) {
      const ftsResults = db
        .prepare(
          `
          SELECT f.id, f.category, f.subject, f.content, f.importance, f.last_accessed_at, f.created_at, f.updated_at,
                 bm25(facts_fts) as rank
          FROM facts_fts
          JOIN facts f ON facts_fts.rowid = f.id
          WHERE facts_fts MATCH ?
          ORDER BY rank
          LIMIT 20
        `
        )
        .all(`"${escapedQuery}" OR ${escapedQuery.split(/\s+/).join(' OR ')}`) as Array<
        Fact & { rank: number }
      >;

      // Normalize keyword scores (BM25 returns negative values, lower is better)
      const maxRank = Math.max(...ftsResults.map((r) => Math.abs(r.rank)), 1);

      for (const ftsResult of ftsResults) {
        const normalizedScore = 1 - Math.abs(ftsResult.rank) / maxRank;
        const existing = results.get(ftsResult.id);

        if (existing) {
          existing.keywordScore = normalizedScore;
          existing.score += normalizedScore * keywordWeight;
        } else {
          const fact: Fact = {
            id: ftsResult.id,
            category: ftsResult.category,
            subject: ftsResult.subject,
            content: ftsResult.content,
            importance: ftsResult.importance,
            last_accessed_at: ftsResult.last_accessed_at,
            created_at: ftsResult.created_at,
            updated_at: ftsResult.updated_at,
          };

          results.set(ftsResult.id, {
            fact,
            score: normalizedScore * keywordWeight,
            vectorScore: 0,
            keywordScore: normalizedScore,
          });
        }
      }
    }
  } catch (err) {
    console.error('[Memory] Keyword search failed:', err);
  }

  // 3. Sort by score and filter
  const sortedResults = Array.from(results.values())
    .filter((r) => r.score >= scoreThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEARCH_RESULTS);

  // Update last_accessed_at for returned facts
  if (sortedResults.length > 0) {
    const ids = sortedResults.map((r) => r.fact.id);
    const placeholders = ids.map(() => '?').join(',');
    try {
      db.prepare(
        `UPDATE facts SET last_accessed_at = (strftime('%Y-%m-%dT%H:%M:%fZ')) WHERE id IN (${placeholders})`
      ).run(...ids);
    } catch {
      // Non-critical — don't fail the search
    }
  }

  return sortedResults;
}

/**
 * Simple search (fallback, no embeddings)
 */
export function searchFacts(db: Database.Database, query: string, category?: string): Fact[] {
  const searchPattern = `%${query}%`;

  if (category) {
    const stmt = db.prepare(`
        SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
        FROM facts
        WHERE category = ? AND (content LIKE ? OR subject LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `);
    return stmt.all(category, searchPattern, searchPattern, MAX_SEARCH_RESULTS) as Fact[];
  }

  const stmt = db.prepare(`
      SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
      FROM facts
      WHERE content LIKE ? OR subject LIKE ? OR category LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `);
  return stmt.all(searchPattern, searchPattern, searchPattern, MAX_SEARCH_RESULTS) as Fact[];
}

/**
 * Get all facts for a given category.
 */
export function getFactsByCategory(db: Database.Database, category: string): Fact[] {
  const stmt = db.prepare(`
      SELECT id, category, subject, content, importance, last_accessed_at, created_at, updated_at
      FROM facts
      WHERE category = ?
      ORDER BY subject, updated_at DESC
    `);
  return stmt.all(category) as Fact[];
}

/**
 * Get a list of distinct fact categories.
 */
export function getFactCategories(db: Database.Database): string[] {
  const stmt = db.prepare(`
      SELECT DISTINCT category FROM facts ORDER BY category
    `);
  const rows = stmt.all() as { category: string }[];
  return rows.map((r) => r.category);
}

// ============ Importance decay ============

/**
 * Decay importance for facts not accessed recently.
 * Run at app startup to gradually demote stale facts.
 *
 * - Facts not accessed in 30+ days: importance -= 10 (min 10)
 * - Facts not accessed in 90+ days: importance -= 20 (min 5)
 */
export function decayFactImportance(db: Database.Database): void {
  // 90+ days first (larger decay), then 30+ days
  const decayed90 = db
    .prepare(
      `UPDATE facts
       SET importance = MAX(5, importance - 20)
       WHERE last_accessed_at IS NOT NULL
         AND last_accessed_at < datetime('now', '-90 days')
         AND importance > 5`
    )
    .run();

  const decayed30 = db
    .prepare(
      `UPDATE facts
       SET importance = MAX(10, importance - 10)
       WHERE last_accessed_at IS NOT NULL
         AND last_accessed_at < datetime('now', '-30 days')
         AND last_accessed_at >= datetime('now', '-90 days')
         AND importance > 10`
    )
    .run();

  const total = (decayed90.changes || 0) + (decayed30.changes || 0);
  if (total > 0) {
    console.log(
      `[Memory] Decayed importance for ${total} stale facts (90d: ${decayed90.changes}, 30d: ${decayed30.changes})`
    );
  }
}
