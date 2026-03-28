/**
 * Settings Schema - Static setting definitions
 *
 * Defines all available settings, their defaults, types, and categories.
 */

export interface Setting {
  key: string;
  value: string;
  encrypted: boolean;
  category: string;
  updated_at: string;
}

export interface SettingDefinition {
  key: string;
  defaultValue: string;
  encrypted: boolean;
  category: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'password' | 'array' | 'textarea';
  validation?: (value: string) => boolean;
}

// Default settings schema
export const SETTINGS_SCHEMA: SettingDefinition[] = [
  // Auth settings
  {
    key: 'auth.method',
    defaultValue: '',
    encrypted: false,
    category: 'auth',
    label: 'Authentication Method',
    description: 'How you authenticate with Claude (api_key or oauth)',
    type: 'string',
  },
  {
    key: 'auth.oauthToken',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'OAuth Token',
    description: 'OAuth access token for Claude subscription',
    type: 'password',
  },
  {
    key: 'auth.refreshToken',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'Refresh Token',
    description: 'OAuth refresh token',
    type: 'password',
  },
  {
    key: 'auth.tokenExpiresAt',
    defaultValue: '',
    encrypted: false,
    category: 'auth',
    label: 'Token Expiry',
    description: 'When the OAuth token expires',
    type: 'string',
  },

  // API Keys
  {
    key: 'anthropic.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'Anthropic API Key',
    description: 'Your Anthropic API key for Claude',
    type: 'password',
  },
  {
    key: 'openai.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'OpenAI API Key',
    description: 'Your OpenAI API key for embeddings and image generation',
    type: 'password',
  },
  {
    key: 'moonshot.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'Moonshot/Kimi API Key',
    description: 'Your Moonshot API key for Kimi models',
    type: 'password',
  },
  {
    key: 'glm.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'Z.AI GLM API Key',
    description: 'Your Z.AI API key for GLM models',
    type: 'password',
  },

  // Agent settings
  {
    key: 'agent.model',
    defaultValue: 'claude-opus-4-6',
    encrypted: false,
    category: 'agent',
    label: 'Default Model',
    description: 'Claude model to use for conversations',
    type: 'string',
  },
  {
    key: 'agent.mode',
    defaultValue: 'coder',
    encrypted: false,
    category: 'agent',
    label: 'Agent Mode',
    description: 'General (fast chat) or Coder (full coding tools)',
    type: 'string',
  },
  {
    key: 'agent.thinkingLevel',
    defaultValue: 'normal',
    encrypted: false,
    category: 'agent',
    label: 'Thinking Level',
    description: 'How much reasoning to show (none, minimal, normal, extended)',
    type: 'string',
  },

  // Telegram settings
  {
    key: 'telegram.botToken',
    defaultValue: '',
    encrypted: true,
    category: 'telegram',
    label: 'Bot Token',
    description: 'Telegram bot token from @BotFather',
    type: 'password',
  },
  {
    key: 'telegram.allowedUserIds',
    defaultValue: '[]',
    encrypted: false,
    category: 'telegram',
    label: 'Allowed User IDs',
    description: 'Comma-separated list of Telegram user IDs',
    type: 'array',
  },
  {
    key: 'telegram.enabled',
    defaultValue: 'false',
    encrypted: false,
    category: 'telegram',
    label: 'Enable Telegram',
    description: 'Enable Telegram bot integration',
    type: 'boolean',
  },
  {
    key: 'telegram.defaultChatId',
    defaultValue: '',
    encrypted: false,
    category: 'telegram',
    label: 'Default Chat ID',
    description: 'Default chat ID for notifications',
    type: 'string',
  },

  // iOS mobile companion settings
  {
    key: 'ios.enabled',
    defaultValue: 'false',
    encrypted: false,
    category: 'ios',
    label: 'Enable Mobile Connection',
    description: 'Connect to relay for iOS companion app',
    type: 'boolean',
  },
  {
    key: 'ios.instanceId',
    defaultValue: '',
    encrypted: false,
    category: 'ios',
    label: 'Instance ID',
    description: 'Unique ID for your desktop instance (auto-generated)',
    type: 'string',
  },
  {
    key: 'ios.relayUrl',
    defaultValue: 'wss://pocket-agent-relay.buzzbeamaustralia.workers.dev',
    encrypted: false,
    category: 'ios',
    label: 'Relay URL',
    description: 'WebSocket relay server URL',
    type: 'string',
  },
  {
    key: 'ios.port',
    defaultValue: '7888',
    encrypted: false,
    category: 'ios',
    label: 'Local Port',
    description: 'WebSocket server port for local connections (set relay URL to "local" to use)',
    type: 'string',
  },
  {
    key: 'ios.pairedDevices',
    defaultValue: '[]',
    encrypted: true,
    category: 'ios',
    label: 'Paired Devices',
    description: 'Auth tokens for paired iOS devices',
    type: 'string',
  },

  // Memory settings
  {
    key: 'memory.embeddingProvider',
    defaultValue: 'openai',
    encrypted: false,
    category: 'memory',
    label: 'Embedding Provider',
    description: 'Provider for semantic embeddings (openai)',
    type: 'string',
  },
  // Browser settings
  {
    key: 'browser.enabled',
    defaultValue: 'true',
    encrypted: false,
    category: 'browser',
    label: 'Enable Browser',
    description: 'Enable browser automation tools',
    type: 'boolean',
  },
  {
    key: 'browser.cdpUrl',
    defaultValue: 'http://localhost:9222',
    encrypted: false,
    category: 'browser',
    label: 'CDP URL',
    description: 'Chrome DevTools Protocol URL',
    type: 'string',
  },
  {
    key: 'browser.useMyBrowser',
    defaultValue: 'false',
    encrypted: false,
    category: 'browser',
    label: 'Use My Browser',
    description: 'Always use your browser instead of headless mode',
    type: 'boolean',
  },

  // Scheduler settings
  {
    key: 'scheduler.enabled',
    defaultValue: 'true',
    encrypted: false,
    category: 'scheduler',
    label: 'Enable Scheduler',
    description: 'Enable cron job scheduler',
    type: 'boolean',
  },

  // Notification settings
  {
    key: 'notifications.soundEnabled',
    defaultValue: 'true',
    encrypted: false,
    category: 'notifications',
    label: 'Response Sound',
    description: 'Play a sound when responses complete',
    type: 'boolean',
  },

  // Window state settings
  {
    key: 'window.chatBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Chat Window Bounds',
    description: 'Saved position and size of chat window (JSON)',
    type: 'string',
  },
  {
    key: 'window.cronBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Cron Window Bounds',
    description: 'Saved position and size of cron window (JSON)',
    type: 'string',
  },
  {
    key: 'window.settingsBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Settings Window Bounds',
    description: 'Saved position and size of settings window (JSON)',
    type: 'string',
  },
  {
    key: 'window.customizeBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Customize Window Bounds',
    description: 'Saved position and size of customize window (JSON)',
    type: 'string',
  },
  {
    key: 'window.factsBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Facts Window Bounds',
    description: 'Saved position and size of facts window (JSON)',
    type: 'string',
  },
  // Appearance settings
  {
    key: 'ui.skin',
    defaultValue: 'dracula',
    encrypted: false,
    category: 'appearance',
    label: 'UI Skin',
    description:
      'Visual theme for the app (dracula, light, dawn, midnight, nord, mocha, rosepine, gruvbox, solarized, onedark)',
    type: 'string',
  },

  // Chat settings
  {
    key: 'chat.username',
    defaultValue: '',
    encrypted: false,
    category: 'chat',
    label: 'Chat Username',
    description: 'Your username for global chat',
    type: 'string',
  },
  {
    key: 'chat.adminKey',
    defaultValue: '',
    encrypted: true,
    category: 'chat',
    label: 'Admin Key',
    description: 'Admin authentication key (leave blank if not admin)',
    type: 'string',
  },

  // Personalize settings (General mode identity + personality)
  {
    key: 'personalize.agentName',
    defaultValue: 'Frankie',
    encrypted: false,
    category: 'personalize',
    label: 'Agent Name',
    description: "Your agent's name",
    type: 'string',
  },
  {
    key: 'personalize.description',
    defaultValue:
      'You are a personal AI assistant who lives inside Pocket Agent. You help with whatever the user needs, remember everything, and keep things fun along the way.',
    encrypted: false,
    category: 'personalize',
    label: 'Agent Description',
    description: 'A brief description of who the agent is',
    type: 'textarea',
  },
  {
    key: 'personalize.personality',
    defaultValue: `## Vibe

Talk like texting a close friend. Chill, casual, real.

- Lowercase always (except proper nouns, acronyms, or emphasis)
- Skip periods at end of messages
- Emojis sparingly
- Direct and concise - no fluff, no corporate speak
- Joke around, be a little sarcastic, keep it fun
- If something's unclear, ask instead of guessing
- Reference past convos naturally

## Don't

- Don't be cringe or try too hard
- Don't over-explain or hedge
- Don't be fake positive
- Don't start every message the same way`,
    encrypted: false,
    category: 'personalize',
    label: 'Personality',
    description: 'How the agent acts and communicates',
    type: 'textarea',
  },
  {
    key: 'personalize.goals',
    defaultValue: '',
    encrypted: false,
    category: 'personalize',
    label: 'Goals',
    description: "What you're working toward",
    type: 'textarea',
  },
  {
    key: 'personalize.struggles',
    defaultValue: '',
    encrypted: false,
    category: 'personalize',
    label: 'Struggles',
    description: "What you're dealing with",
    type: 'textarea',
  },
  {
    key: 'personalize.funFacts',
    defaultValue: '',
    encrypted: false,
    category: 'personalize',
    label: 'Fun Facts',
    description: 'Interests, hobbies, people in your life',
    type: 'textarea',
  },
  {
    key: 'personalize._migrated',
    defaultValue: '',
    encrypted: false,
    category: 'personalize',
    label: 'Migration Flag',
    description: 'Internal flag for identity.md migration',
    type: 'string',
  },

  // Onboarding settings
  {
    key: 'onboarding.completed',
    defaultValue: '',
    encrypted: false,
    category: 'onboarding',
    label: 'Onboarding Completed',
    description: 'Whether the onboarding wizard has been completed',
    type: 'boolean',
  },

  // User Profile settings
  {
    key: 'profile.name',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Your Name',
    description: 'Your name for the agent to use',
    type: 'string',
  },
  {
    key: 'profile.location',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Location',
    description: 'Your city/region for context',
    type: 'string',
  },
  {
    key: 'profile.timezone',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Timezone',
    description: 'Your timezone (e.g., America/New_York)',
    type: 'string',
  },
  {
    key: 'profile.occupation',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Occupation',
    description: 'Your job or role',
    type: 'string',
  },
  {
    key: 'profile.birthday',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Birthday',
    description: 'Your birthday (e.g., March 15)',
    type: 'string',
  },
];
