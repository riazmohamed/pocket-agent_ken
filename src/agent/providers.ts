/**
 * Shared provider configuration for LLM backends.
 * Single source of truth — imported by both coder mode (agent/index.ts)
 * and general/chat mode (chat-providers.ts).
 */

export type ProviderType =
  | 'anthropic'
  | 'moonshot'
  | 'glm'
  | 'xiaomi'
  | 'openai'
  | 'minimax'
  | 'deepseek';

export interface ProviderConfig {
  /** OpenAI-compatible base URL (used by gg-ai chat engine in General mode) */
  baseUrl?: string;
  /** Anthropic-compatible base URL (used by Claude Agent SDK subprocess in Coder mode) */
  sdkBaseUrl?: string;
}

export const PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
  anthropic: {
    // No baseUrl = uses default Anthropic endpoint for both modes
  },
  moonshot: {
    // General mode: gg-ai uses OpenAI-compat endpoint (no baseUrl = gg-ai default /v1)
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.moonshot.ai/anthropic',
  },
  glm: {
    // General mode: no baseUrl — gg-ai's built-in GLM provider handles endpoint
    // selection with fallback (coding endpoint first, then regular).
    // Setting baseUrl would bypass this and break Coding Plan models like glm-5.1.
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.z.ai/api/anthropic',
  },
  xiaomi: {
    // General mode: gg-ai uses OpenAI-compat endpoint for Xiaomi models
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
  },
  openai: {
    // General mode: gg-ai uses OpenAI-compat endpoint (no baseUrl = gg-ai default)
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.openai.com/v1',
  },
  minimax: {
    // General mode: gg-ai uses Anthropic-compat endpoint for MiniMax models
    baseUrl: 'https://api.minimax.io/anthropic',
  },
  deepseek: {
    // General mode: gg-ai uses OpenAI-compat endpoint for DeepSeek models
    baseUrl: 'https://api.deepseek.com/v1',
  },
};

// Model to provider mapping
export const MODEL_PROVIDERS: Record<string, ProviderType> = {
  // Anthropic models
  'claude-opus-4-7': 'anthropic',
  'claude-opus-4-6': 'anthropic',
  'claude-opus-4-5-20251101': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'claude-haiku-4-5-20251001': 'anthropic',
  // Moonshot/Kimi models
  'kimi-k2.6': 'moonshot',
  // Z.AI GLM models
  'glm-5.1': 'glm',
  'glm-5-turbo': 'glm',
  'glm-4.7': 'glm',
  'glm-4.7-flash': 'glm',
  // Xiaomi/MiMo models
  'mimo-v2-pro': 'xiaomi',
  // OpenAI models
  'gpt-5.5': 'openai',
  'gpt-5.5-pro': 'openai',
  'gpt-5.4': 'openai',
  'gpt-5.4-mini': 'openai',
  'gpt-5.3-codex': 'openai',
  'codex-mini-latest': 'openai',
  // MiniMax models
  'MiniMax-M2.7': 'minimax',
  'MiniMax-M2.7-highspeed': 'minimax',
  // DeepSeek models
  'deepseek-v4-pro': 'deepseek',
  'deepseek-v4-flash': 'deepseek',
};

export function getProviderForModel(model: string): ProviderType {
  return MODEL_PROVIDERS[model] || 'anthropic';
}
