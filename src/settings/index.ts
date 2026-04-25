/**
 * Settings Manager - SQLite-based configuration with encryption
 *
 * Uses Electron's safeStorage API to encrypt sensitive values like API keys.
 * All settings stored in SQLite for persistence and atomic updates.
 */

import Database from 'better-sqlite3';
import { safeStorage } from 'electron';

import { SETTINGS_SCHEMA } from './schema';
import type { SettingDefinition } from './schema';
import {
  validateAnthropicKey,
  validateOpenAIKey,
  validateTelegramToken,
  validateMoonshotKey,
  validateGlmKey,
  validateXiaomiKey,
  validateMiniMaxKey,
  validateDeepSeekKey,
} from './validators';

// Re-export types and schema so external consumers aren't broken
export { SETTINGS_SCHEMA };
export type { Setting, SettingDefinition } from './schema';

class SettingsManagerClass {
  private static instance: SettingsManagerClass | null = null;
  private db: Database.Database | null = null;
  private cache: Map<string, string> = new Map();
  private initialized: boolean = false;

  private constructor() {}

  static getInstance(): SettingsManagerClass {
    if (!SettingsManagerClass.instance) {
      SettingsManagerClass.instance = new SettingsManagerClass();
    }
    return SettingsManagerClass.instance;
  }

  /**
   * Initialize settings with database path
   */
  initialize(dbPath: string): void {
    this.db = new Database(dbPath);
    this.createTable();
    this.loadDefaults();
    this.loadToCache();
    this.initialized = true;
    console.log('[Settings] Initialized');
  }

  private createTable(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted INTEGER DEFAULT 0,
        category TEXT DEFAULT 'general',
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
    `);
  }

  /**
   * Load default settings that don't exist yet
   */
  private loadDefaults(): void {
    if (!this.db) return;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO settings (key, value, encrypted, category)
      VALUES (?, ?, ?, ?)
    `);

    for (const def of SETTINGS_SCHEMA) {
      insert.run(def.key, def.defaultValue, def.encrypted ? 1 : 0, def.category);
    }
  }

  /**
   * Load all settings to memory cache
   */
  private loadToCache(): void {
    if (!this.db) return;

    const rows = this.db.prepare('SELECT key, value, encrypted FROM settings').all() as Array<{
      key: string;
      value: string;
      encrypted: number;
    }>;

    for (const row of rows) {
      let value = row.value;

      // Decrypt if needed
      if (row.encrypted && value) {
        try {
          value = this.decrypt(value);
        } catch {
          // If decryption fails, value stays encrypted (might be from old install)
          console.warn(`[Settings] Failed to decrypt ${row.key}`);
        }
      }

      this.cache.set(row.key, value);
    }
  }

  /**
   * Encrypt a value using safeStorage
   */
  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[Settings] Encryption not available, storing as plain text');
      return value;
    }
    const encrypted = safeStorage.encryptString(value);
    return encrypted.toString('base64');
  }

  /**
   * Decrypt a value using safeStorage
   */
  private decrypt(encrypted: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      return encrypted;
    }
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  }

  /**
   * Get a setting value
   */
  get(key: string): string {
    if (!this.initialized) {
      console.warn('[Settings] Not initialized, returning default');
      const def = SETTINGS_SCHEMA.find((s) => s.key === key);
      return def?.defaultValue || '';
    }

    return this.cache.get(key) || '';
  }

  /**
   * Get a setting as a specific type
   */
  getNumber(key: string): number {
    return parseFloat(this.get(key)) || 0;
  }

  getBoolean(key: string): boolean {
    return this.get(key) === 'true';
  }

  getArray(key: string): string[] {
    try {
      const value = this.get(key);
      if (!value) return [];
      // Try JSON parse first
      if (value.startsWith('[')) {
        return JSON.parse(value);
      }
      // Fall back to comma-separated
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Set a setting value
   */
  set(key: string, value: string, encrypted?: boolean): void {
    if (!this.db) {
      console.warn('[Settings] Not initialized, cannot save:', key);
      return;
    }

    // Determine if should be encrypted
    const def = SETTINGS_SCHEMA.find((s) => s.key === key);
    const shouldEncrypt = encrypted ?? def?.encrypted ?? false;
    const category = def?.category || 'general';

    // Encrypt if needed
    let storedValue = value;
    if (shouldEncrypt && value) {
      storedValue = this.encrypt(value);
    }

    // Update database
    this.db
      .prepare(
        `
      INSERT INTO settings (key, value, encrypted, category, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        encrypted = excluded.encrypted,
        updated_at = excluded.updated_at
    `
      )
      .run(key, storedValue, shouldEncrypt ? 1 : 0, category);

    // Update cache with unencrypted value
    this.cache.set(key, value);

    console.log(`[Settings] Updated: ${key}`);
  }

  /**
   * Delete a setting
   */
  delete(key: string): boolean {
    if (!this.db) return false;

    const result = this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    this.cache.delete(key);

    return result.changes > 0;
  }

  /**
   * Get all settings
   */
  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.cache) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Get all settings with encrypted values redacted.
   * Safe to send to renderer processes.
   */
  getAllSafe(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.cache) {
      const def = SETTINGS_SCHEMA.find((s) => s.key === key);
      if (def?.encrypted && value) {
        // Send a masked placeholder so the UI knows a value is set
        result[key] = '••••••••';
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Get all settings by category
   */
  getByCategory(category: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const def of SETTINGS_SCHEMA) {
      if (def.category === category) {
        result[def.key] = this.get(def.key);
      }
    }
    return result;
  }

  /**
   * Get schema for a category
   */
  getSchema(category?: string): SettingDefinition[] {
    if (category) {
      return SETTINGS_SCHEMA.filter((s) => s.category === category);
    }
    return SETTINGS_SCHEMA;
  }

  /**
   * Check if required authentication is set
   * Returns true if any LLM provider key is configured (Anthropic, Moonshot, or OAuth)
   */
  hasRequiredKeys(): boolean {
    const authMethod = this.get('auth.method');

    // Check for OAuth authentication
    if (authMethod === 'oauth') {
      const oauthToken = this.get('auth.oauthToken');
      return !!oauthToken;
    }

    // Check for API key authentication (any supported provider)
    const anthropicKey = this.get('anthropic.apiKey');
    const moonshotKey = this.get('moonshot.apiKey');
    const glmKey = this.get('glm.apiKey');
    return !!anthropicKey || !!moonshotKey || !!glmKey;
  }

  /**
   * Get the current authentication method
   */
  getAuthMethod(): 'api_key' | 'oauth' | null {
    const method = this.get('auth.method');
    if (method === 'oauth' || method === 'api_key') {
      return method;
    }
    // Legacy check - if API key exists, assume api_key method
    if (this.get('anthropic.apiKey')) {
      return 'api_key';
    }
    return null;
  }

  /**
   * Check if first run (no authentication set or onboarding not completed)
   */
  isFirstRun(): boolean {
    if (!this.hasRequiredKeys()) return true;
    // If keys exist but onboarding was explicitly reset, show it again
    const completed = this.get('onboarding.completed');
    if (completed === 'false') return true;
    return false;
  }

  /**
   * Reset onboarding so it shows again on next app launch or window reload.
   */
  resetOnboarding(): void {
    this.set('onboarding.completed', 'false');
  }

  /**
   * Initialize keychain access by triggering a test encryption.
   * This prompts macOS for keychain permission upfront during onboarding
   * rather than surprising users later when saving API keys.
   * Returns true if encryption is available and working.
   */
  initializeKeychain(): { available: boolean; error?: string } {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return { available: false, error: 'Encryption not available on this system' };
      }
      // Trigger keychain access with a test encryption
      const testValue = 'keychain-init-test';
      const encrypted = safeStorage.encryptString(testValue);
      const decrypted = safeStorage.decryptString(encrypted);
      if (decrypted !== testValue) {
        return { available: false, error: 'Encryption verification failed' };
      }
      return { available: true };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get agent identity: name, description, personality (who am I).
   */
  getFormattedIdentity(): string {
    const agentName = this.get('personalize.agentName') || 'Frankie';
    const description = this.get('personalize.description');
    const personality = this.get('personalize.personality');

    const lines: string[] = [`# ${agentName}`];

    if (description) {
      lines.push('');
      lines.push(description);
    }

    if (personality) {
      lines.push('');
      lines.push(personality);
    }

    return lines.join('\n');
  }

  /**
   * Get user context: profile details + world (goals, struggles, fun facts).
   * Groups all "about the user" content together.
   */
  getFormattedUserContext(): string {
    const profile = this.getFormattedProfile();
    const goals = this.get('personalize.goals');
    const struggles = this.get('personalize.struggles');
    const funFacts = this.get('personalize.funFacts');

    const parts: string[] = [];

    if (profile) {
      parts.push(profile);
    }

    const hasWorld = goals || struggles || funFacts;
    if (hasWorld) {
      const worldLines: string[] = ['## Your World'];
      if (goals) {
        worldLines.push('');
        worldLines.push('### Goals');
        worldLines.push(goals);
      }
      if (struggles) {
        worldLines.push('');
        worldLines.push('### Struggles');
        worldLines.push(struggles);
      }
      if (funFacts) {
        worldLines.push('');
        worldLines.push('### Fun Facts');
        worldLines.push(funFacts);
      }
      parts.push(worldLines.join('\n'));
    }

    return parts.join('\n\n');
  }

  /**
   * Get formatted user profile for agent context
   */
  getFormattedProfile(): string {
    const name = this.get('profile.name');
    const location = this.get('profile.location');
    const timezone = this.get('profile.timezone');
    const occupation = this.get('profile.occupation');
    const birthday = this.get('profile.birthday');

    // If no profile data, return empty string
    if (!name && !location && !timezone && !occupation && !birthday) {
      return '';
    }

    const lines: string[] = ['## User Profile'];

    if (name) lines.push(`- **Name:** ${name}`);
    if (location) lines.push(`- **Location:** ${location}`);
    if (timezone) lines.push(`- **Timezone:** ${timezone}`);
    if (occupation) lines.push(`- **Occupation:** ${occupation}`);
    if (birthday) lines.push(`- **Birthday:** ${birthday}`);

    return lines.join('\n');
  }

  /**
   * Validate an Anthropic API key by making a test call
   */
  async validateAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return validateAnthropicKey(apiKey);
  }

  async validateOpenAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return validateOpenAIKey(apiKey);
  }

  async validateTelegramToken(
    token: string
  ): Promise<{ valid: boolean; error?: string; botInfo?: unknown }> {
    return validateTelegramToken(token);
  }

  /**
   * Validate a Moonshot/Kimi API key by making a test call
   */
  async validateMoonshotKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return validateMoonshotKey(apiKey);
  }

  async validateGlmKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return validateGlmKey(apiKey);
  }

  async validateXiaomiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return validateXiaomiKey(apiKey);
  }

  async validateMiniMaxKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return validateMiniMaxKey(apiKey);
  }

  async validateDeepSeekKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    return validateDeepSeekKey(apiKey);
  }

  /**
   * Get API keys as environment variables for skill execution.
   * Maps settings keys to the environment variable names that skills expect.
   * Returns empty object if SettingsManager is not initialized yet.
   */
  getApiKeysAsEnv(): Record<string, string> {
    if (!this.initialized) {
      return {};
    }

    const env: Record<string, string> = {};

    // Map settings keys to environment variable names
    const keyMappings: Record<string, string> = {
      'openai.apiKey': 'OPENAI_API_KEY',
      'anthropic.apiKey': 'ANTHROPIC_API_KEY',
      'moonshot.apiKey': 'MOONSHOT_API_KEY',
      'deepseek.apiKey': 'DEEPSEEK_API_KEY',
    };

    for (const [settingKey, envVar] of Object.entries(keyMappings)) {
      const value = this.get(settingKey);
      if (value) {
        env[envVar] = value;
      }
    }

    return env;
  }

  /**
   * Check if a specific API key is configured.
   * Returns false if SettingsManager is not initialized yet.
   */
  hasApiKey(envVarName: string): boolean {
    if (!this.initialized) {
      return false;
    }

    const reverseMapping: Record<string, string> = {
      OPENAI_API_KEY: 'openai.apiKey',
      ANTHROPIC_API_KEY: 'anthropic.apiKey',
      MOONSHOT_API_KEY: 'moonshot.apiKey',
      DEEPSEEK_API_KEY: 'deepseek.apiKey',
    };

    const settingKey = reverseMapping[envVarName];
    if (!settingKey) return false;

    return !!this.get(settingKey);
  }

  /**
   * Export settings for backup (excluding encrypted values)
   */
  exportSettings(): Record<string, unknown> {
    const all = this.getAll();
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(all)) {
      const def = SETTINGS_SCHEMA.find((s) => s.key === key);
      if (def?.encrypted) {
        result[key] = '***ENCRYPTED***';
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Import settings from backup
   */
  importSettings(settings: Record<string, string>): void {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== '***ENCRYPTED***') {
        this.set(key, value);
      }
    }
  }

  /**
   * Migrate settings from old config.json file
   */
  async migrateFromConfig(configPath: string): Promise<boolean> {
    try {
      const fs = await import('fs');
      if (!fs.existsSync(configPath)) {
        return false;
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      // Migrate Anthropic settings
      if (config.anthropic?.apiKey) {
        this.set('anthropic.apiKey', config.anthropic.apiKey);
      }
      if (config.anthropic?.model) {
        this.set('agent.model', config.anthropic.model);
      }

      // Migrate OpenAI settings
      if (config.openai?.apiKey) {
        this.set('openai.apiKey', config.openai.apiKey);
      }

      // Migrate Telegram settings
      if (config.telegram?.botToken) {
        this.set('telegram.botToken', config.telegram.botToken);
      }
      if (config.telegram?.enabled !== undefined) {
        this.set('telegram.enabled', config.telegram.enabled.toString());
      }
      if (config.telegram?.allowedUserIds?.length) {
        this.set('telegram.allowedUserIds', JSON.stringify(config.telegram.allowedUserIds));
      }

      // Migrate scheduler settings
      if (config.scheduler?.enabled !== undefined) {
        this.set('scheduler.enabled', config.scheduler.enabled.toString());
      }

      // Migrate browser settings
      if (config.tools?.browser?.enabled !== undefined) {
        this.set('browser.enabled', config.tools.browser.enabled.toString());
      }
      if (config.tools?.browser?.cdpUrl) {
        this.set('browser.cdpUrl', config.tools.browser.cdpUrl);
      }

      console.log('[Settings] Migrated settings from config.json');

      // Rename the old config file to indicate migration
      fs.renameSync(configPath, configPath + '.migrated');

      return true;
    } catch (error) {
      console.error('[Settings] Migration failed:', error);
      return false;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }
}

export const SettingsManager = SettingsManagerClass.getInstance();
