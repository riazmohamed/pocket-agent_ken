/**
 * API Key Validators - Test API keys by making lightweight requests
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface TelegramValidationResult extends ValidationResult {
  botInfo?: unknown;
}

interface ApiKeyValidationConfig {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  /** Extract error message from response JSON (defaults to data.error?.message) */
  extractError?: (data: Record<string, unknown>) => string;
  /** Custom success check (defaults to response.ok) */
  isSuccess?: (response: Response, data: Record<string, unknown>) => boolean;
}

/**
 * Generic API key validation helper.
 * Makes a test request and returns whether the key is valid.
 */
async function validateApiKey(config: ApiKeyValidationConfig): Promise<ValidationResult> {
  try {
    const fetchOptions: RequestInit = {
      method: config.method,
      headers: config.headers,
    };

    if (config.body) {
      fetchOptions.body = JSON.stringify(config.body);
    }

    const response = await fetch(config.url, fetchOptions);

    if (config.isSuccess) {
      const data = (await response.json()) as Record<string, unknown>;
      if (config.isSuccess(response, data)) {
        return { valid: true };
      }
      const errorMsg = config.extractError
        ? config.extractError(data)
        : ((data.error as Record<string, unknown>)?.message as string) || 'Invalid API key';
      return { valid: false, error: errorMsg };
    }

    if (response.ok) {
      return { valid: true };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const errorMsg = config.extractError
      ? config.extractError(data)
      : ((data.error as Record<string, unknown>)?.message as string) || 'Invalid API key';
    return { valid: false, error: errorMsg };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

/**
 * Validate an Anthropic API key by making a test call
 */
export async function validateAnthropicKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}

/**
 * Validate an OpenAI API key by listing models
 */
export async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.openai.com/v1/models',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

/**
 * Validate a Telegram bot token
 */
export async function validateTelegramToken(token: string): Promise<TelegramValidationResult> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await response.json()) as Record<string, unknown>;

    if (data.ok) {
      return { valid: true, botInfo: data.result };
    }

    return { valid: false, error: (data.description as string) || 'Invalid token' };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Connection failed' };
  }
}

/**
 * Validate a Moonshot/Kimi API key by making a test call
 */
export async function validateMoonshotKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.moonshot.ai/anthropic/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'kimi-k2.5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}

/**
 * Validate a Z.AI GLM API key by making a test call
 */
export async function validateGlmKey(apiKey: string): Promise<ValidationResult> {
  return validateApiKey({
    url: 'https://api.z.ai/api/anthropic/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'glm-5.1',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    },
  });
}
