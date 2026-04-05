/**
 * Chat mode provider configuration for @kenkaiiii/gg-ai
 *
 * Returns provider/apiKey/baseUrl configs matching gg-ai's StreamOptions shape.
 * Uses the shared MODEL_PROVIDERS mapping from providers.ts.
 */

import type { Provider } from '@kenkaiiii/gg-ai';
import { SettingsManager } from '../settings';
import { getProviderForModel, PROVIDER_CONFIGS } from './providers';

export { getProviderForModel };

export interface StreamConfig {
  provider: Provider;
  apiKey?: string;
  baseUrl?: string;
  accountId?: string;
}

/**
 * Get gg-ai stream configuration for the given model.
 * Returns { provider, apiKey, baseUrl } matching StreamOptions fields.
 */
export async function getStreamConfig(model: string): Promise<StreamConfig> {
  const providerType = getProviderForModel(model);
  const config = PROVIDER_CONFIGS[providerType];

  if (providerType === 'moonshot') {
    const apiKey = SettingsManager.get('moonshot.apiKey');
    if (!apiKey) {
      throw new Error('Moonshot API key not configured. Please add your key in Settings > Keys.');
    }
    return { provider: 'moonshot', apiKey, baseUrl: config.baseUrl };
  }

  if (providerType === 'glm') {
    const apiKey = SettingsManager.get('glm.apiKey');
    if (!apiKey) {
      throw new Error('Z.AI GLM API key not configured. Please add your key in Settings > LLM.');
    }
    return { provider: 'glm', apiKey, baseUrl: config.baseUrl };
  }

  if (providerType === 'xiaomi') {
    const apiKey = SettingsManager.get('xiaomi.apiKey');
    if (!apiKey) {
      throw new Error('Xiaomi API key not configured. Please add your key in Settings > LLM.');
    }
    return { provider: 'xiaomi', apiKey, baseUrl: config.baseUrl };
  }

  if (providerType === 'openai') {
    // Check for OAuth first (uses Codex Responses API with accountId)
    const openaiAuthMethod = SettingsManager.get('openai.auth.method');
    if (openaiAuthMethod === 'oauth') {
      const { OpenAIOAuth } = await import('../auth/openai-oauth');
      const token = await OpenAIOAuth.getAccessToken();
      const accountId = SettingsManager.get('openai.accountId');
      if (!token) {
        throw new Error('OpenAI session expired. Please re-authenticate in Settings.');
      }
      return { provider: 'openai', apiKey: token, accountId: accountId || undefined };
    }
    // API key path
    const apiKey = SettingsManager.get('openai.apiKey');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please add your key in Settings > LLM.');
    }
    return { provider: 'openai', apiKey, baseUrl: config.baseUrl };
  }

  if (providerType === 'minimax') {
    const apiKey = SettingsManager.get('minimax.apiKey');
    if (!apiKey) {
      throw new Error('MiniMax API key not configured. Please add your key in Settings > LLM.');
    }
    return { provider: 'minimax', apiKey, baseUrl: config.baseUrl };
  }

  // Anthropic provider
  const apiKey = SettingsManager.get('anthropic.apiKey');
  if (apiKey) {
    return { provider: 'anthropic', apiKey };
  }

  // Check for OAuth
  const authMethod = SettingsManager.get('auth.method');
  if (authMethod === 'oauth') {
    const { ClaudeOAuth } = await import('../auth/oauth');
    const token = await ClaudeOAuth.getAccessToken();
    if (token) {
      return { provider: 'anthropic', apiKey: token };
    }
    throw new Error('OAuth session expired. Please re-authenticate in Settings.');
  }

  throw new Error('No API key configured. Please add your key in Settings.');
}
