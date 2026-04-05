import { contextBridge, ipcRenderer } from 'electron';

// Expose API to renderer process — organized by domain
contextBridge.exposeInMainWorld('pocketAgent', {
  // ─── Agent ───────────────────────────────────────────────────────────
  agent: {
    send: (
      message: string,
      sessionId?: string,
      images?: Array<{ type: 'base64'; mediaType: string; data: string }>
    ) => ipcRenderer.invoke('agent:send', message, sessionId, images),
    stop: (sessionId?: string) => ipcRenderer.invoke('agent:stop', sessionId),
    setMode: (mode: string) => ipcRenderer.invoke('agent:setMode', mode),
    getMode: () => ipcRenderer.invoke('agent:getMode'),
    getSessionMode: (sessionId: string) => ipcRenderer.invoke('agent:getSessionMode', sessionId),
    setSessionMode: (sessionId: string, mode: string) =>
      ipcRenderer.invoke('agent:setSessionMode', sessionId, mode),
    onModeChanged: (callback: (mode: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, mode: string) => callback(mode);
      ipcRenderer.on('agent:modeChanged', listener);
      return () => ipcRenderer.removeListener('agent:modeChanged', listener);
    },
    onSessionModeChanged: (callback: (sessionId: string, mode: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string, mode: string) =>
        callback(sessionId, mode);
      ipcRenderer.on('agent:sessionModeChanged', listener);
      return () => ipcRenderer.removeListener('agent:sessionModeChanged', listener);
    },
    onStatus: (
      callback: (status: {
        type: string;
        toolName?: string;
        toolInput?: string;
        message?: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: { type: string; toolName?: string; toolInput?: string; message?: string }
      ) => callback(status);
      ipcRenderer.on('agent:status', listener);
      return () => ipcRenderer.removeListener('agent:status', listener);
    },
    getHistory: (limit?: number, sessionId?: string) =>
      ipcRenderer.invoke('agent:history', limit, sessionId),
    getStats: (sessionId?: string) => ipcRenderer.invoke('agent:stats', sessionId),
    clearConversation: (sessionId?: string) => ipcRenderer.invoke('agent:clear', sessionId),
    readMedia: (filePath: string) => ipcRenderer.invoke('agent:readMedia', filePath),
    restart: () => ipcRenderer.invoke('agent:restart'),
  },

  // ─── Attachments ─────────────────────────────────────────────────────
  attachments: {
    save: (name: string, dataUrl: string) => ipcRenderer.invoke('attachment:save', name, dataUrl),
    extractText: (filePath: string) => ipcRenderer.invoke('attachment:extract-text', filePath),
  },

  // ─── Sessions ────────────────────────────────────────────────────────
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: (name: string) => ipcRenderer.invoke('sessions:create', name),
    rename: (id: string, name: string) => ipcRenderer.invoke('sessions:rename', id, name),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    onChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('sessions:changed', listener);
      return () => ipcRenderer.removeListener('sessions:changed', listener);
    },
    onCleared: (callback: (sessionId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string) =>
        callback(sessionId);
      ipcRenderer.on('session:cleared', listener);
      return () => ipcRenderer.removeListener('session:cleared', listener);
    },
  },

  // ─── Facts ───────────────────────────────────────────────────────────
  facts: {
    list: () => ipcRenderer.invoke('facts:list'),
    search: (query: string) => ipcRenderer.invoke('facts:search', query),
    getCategories: () => ipcRenderer.invoke('facts:categories'),
    delete: (id: number) => ipcRenderer.invoke('facts:delete', id),
  },

  // ─── Soul (Self-Knowledge) ──────────────────────────────────────────
  soul: {
    listAspects: () => ipcRenderer.invoke('soul:list'),
    getAspect: (aspect: string) => ipcRenderer.invoke('soul:get', aspect),
    deleteAspect: (id: number) => ipcRenderer.invoke('soul:delete', id),
  },

  // ─── Daily Logs ──────────────────────────────────────────────────────
  dailyLogs: {
    list: () => ipcRenderer.invoke('dailyLogs:list'),
    delete: (id: number) => ipcRenderer.invoke('dailyLogs:delete', id),
  },

  // ─── App (Windows, Navigation, Info) ─────────────────────────────────
  app: {
    openFacts: () => ipcRenderer.invoke('app:openFacts'),
    openDailyLogs: () => ipcRenderer.invoke('app:openDailyLogs'),
    openSoul: () => ipcRenderer.invoke('app:openSoul'),
    openCustomize: () => ipcRenderer.invoke('app:openCustomize'),
    openRoutines: () => ipcRenderer.invoke('app:openRoutines'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    openPath: (filePath: string) => ipcRenderer.invoke('app:openPath', filePath),
    openImage: (src: string) => ipcRenderer.invoke('app:openImage', src),
    openSettings: (tab?: string) => ipcRenderer.invoke('app:openSettings', tab),
    openChat: () => ipcRenderer.invoke('app:openChat'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => process.platform,
    onNavigateTab: (callback: (tab: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, tab: string) => callback(tab);
      ipcRenderer.on('navigate-tab', listener);
      return () => ipcRenderer.removeListener('navigate-tab', listener);
    },
    onOpenSettings: (callback: (tab?: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, tab?: string) => callback(tab);
      ipcRenderer.on('open-settings', listener);
      return () => ipcRenderer.removeListener('open-settings', listener);
    },
  },

  // ─── Customize ───────────────────────────────────────────────────────
  customize: {
    getSystemPrompt: () => ipcRenderer.invoke('customize:getSystemPrompt'),
    getAgentModes: () => ipcRenderer.invoke('customize:getAgentModes'),
  },

  // ─── Location & Timezone ─────────────────────────────────────────────
  location: {
    lookup: (query: string) => ipcRenderer.invoke('location:lookup', query),
    getTimezones: () => ipcRenderer.invoke('timezone:list'),
  },

  // ─── Cron / Routines ────────────────────────────────────────────────
  cron: {
    list: () => ipcRenderer.invoke('cron:list'),
    create: (name: string, schedule: string, prompt: string, channel: string, sessionId: string) =>
      ipcRenderer.invoke('cron:create', name, schedule, prompt, channel, sessionId),
    delete: (name: string) => ipcRenderer.invoke('cron:delete', name),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke('cron:toggle', name, enabled),
    run: (name: string) => ipcRenderer.invoke('cron:run', name),
    getHistory: (limit?: number) => ipcRenderer.invoke('cron:history', limit),
  },

  // ─── Settings ────────────────────────────────────────────────────────
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('settings:delete', key),
    getSchema: (category?: string) => ipcRenderer.invoke('settings:schema', category),
    isFirstRun: () => ipcRenderer.invoke('settings:isFirstRun'),
    resetOnboarding: () => ipcRenderer.invoke('settings:resetOnboarding'),
    initializeKeychain: () => ipcRenderer.invoke('settings:initializeKeychain'),
    getAvailableModels: () => ipcRenderer.invoke('settings:getAvailableModels'),
  },

  // ─── Validation ──────────────────────────────────────────────────────
  validate: {
    anthropicKey: (key: string) => ipcRenderer.invoke('settings:validateAnthropic', key),
    openAIKey: (key: string) => ipcRenderer.invoke('settings:validateOpenAI', key),
    moonshotKey: (key: string) => ipcRenderer.invoke('settings:validateMoonshot', key),
    glmKey: (key: string) => ipcRenderer.invoke('settings:validateGlm', key),
    xiaomiKey: (key: string) => ipcRenderer.invoke('settings:validateXiaomi', key),
    minimaxKey: (key: string) => ipcRenderer.invoke('settings:validateMiniMax', key),
    telegramToken: (token: string) => ipcRenderer.invoke('settings:validateTelegram', token),
    storedKey: (provider: string) => ipcRenderer.invoke('settings:validateStoredKey', provider),
  },

  // ─── Auth (OAuth) ───────────────────────────────────────────────────
  auth: {
    startOAuth: () => ipcRenderer.invoke('auth:startOAuth'),
    completeOAuth: (code: string) => ipcRenderer.invoke('auth:completeOAuth', code),
    cancelOAuth: () => ipcRenderer.invoke('auth:cancelOAuth'),
    isOAuthPending: () => ipcRenderer.invoke('auth:isOAuthPending'),
    validateOAuth: () => ipcRenderer.invoke('auth:validateOAuth'),
    onExpired: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('auth:expired', listener);
      return () => ipcRenderer.removeListener('auth:expired', listener);
    },
  },

  // ─── OpenAI OAuth ──────────────────────────────────────────────────
  openaiAuth: {
    startOAuth: () => ipcRenderer.invoke('openai:startOAuth'),
    completeOAuth: () => ipcRenderer.invoke('openai:completeOAuth'),
    validateOAuth: () => ipcRenderer.invoke('openai:validateOAuth'),
    logoutOAuth: () => ipcRenderer.invoke('openai:logoutOAuth'),
  },

  // ─── Themes ──────────────────────────────────────────────────────────
  themes: {
    list: () => ipcRenderer.invoke('settings:getThemes'),
    getSkin: () => ipcRenderer.invoke('settings:getSkin'),
    onSkinChanged: (callback: (skinId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, skinId: string) => callback(skinId);
      ipcRenderer.on('skin:changed', listener);
      return () => ipcRenderer.removeListener('skin:changed', listener);
    },
  },

  // ─── Chat Events ────────────────────────────────────────────────────
  chat: {
    onUsernameChanged: (callback: (username: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, username: string) => callback(username);
      ipcRenderer.on('chat:usernameChanged', listener);
      return () => ipcRenderer.removeListener('chat:usernameChanged', listener);
    },
  },

  // ─── Commands (Workflows) ───────────────────────────────────────────
  commands: {
    list: (sessionId?: string) => ipcRenderer.invoke('commands:list', sessionId),
  },

  // ─── Updater ─────────────────────────────────────────────────────────
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    download: () => ipcRenderer.invoke('updater:downloadUpdate'),
    install: () => ipcRenderer.invoke('updater:installUpdate'),
    getStatus: () => ipcRenderer.invoke('updater:getStatus'),
    onStatus: (
      callback: (status: {
        status: string;
        info?: unknown;
        progress?: { percent: number };
        error?: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: { status: string; info?: unknown; progress?: { percent: number }; error?: string }
      ) => callback(status);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    },
  },

  // ─── Browser Control ────────────────────────────────────────────────
  browser: {
    detectInstalled: () => ipcRenderer.invoke('browser:detectInstalled'),
    launch: (browserId: string, port?: number) =>
      ipcRenderer.invoke('browser:launch', browserId, port),
    testConnection: (cdpUrl?: string) => ipcRenderer.invoke('browser:testConnection', cdpUrl),
  },

  // ─── iOS Mobile Companion ──────────────────────────────────────────
  ios: {
    getPairingCode: (regenerate?: boolean) => ipcRenderer.invoke('ios:pairing-code', regenerate),
    getDevices: () => ipcRenderer.invoke('ios:devices'),
    getInfo: () => ipcRenderer.invoke('ios:info'),
    toggle: (enabled: boolean) => ipcRenderer.invoke('ios:toggle', enabled),
  },

  // ─── Agent Home ────────────────────────────────────────────────────
  agentHome: {
    toggle: (enabled: boolean) => ipcRenderer.invoke('agentHome:toggle', enabled),
    getStatus: () => ipcRenderer.invoke('agentHome:status'),
  },

  // ─── Shell ───────────────────────────────────────────────────────────
  shell: {
    runCommand: (command: string) => ipcRenderer.invoke('shell:runCommand', command),
  },

  // ─── Permissions (macOS) ─────────────────────────────────────────────
  permissions: {
    isMacOS: () => ipcRenderer.invoke('permissions:isMacOS'),
    check: (types: string[]) => ipcRenderer.invoke('permissions:checkStatus', types),
    openSettings: (type: string) => ipcRenderer.invoke('permissions:openSettings', type),
  },

  // ─── External Events ────────────────────────────────────────────────
  events: {
    onSchedulerMessage: (
      callback: (data: {
        jobName: string;
        prompt: string;
        response: string;
        sessionId: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { jobName: string; prompt: string; response: string; sessionId: string }
      ) => callback(data);
      ipcRenderer.on('scheduler:message', listener);
      return () => ipcRenderer.removeListener('scheduler:message', listener);
    },
    onCronTesting: (
      callback: (data: { name: string; sessionId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { name: string; sessionId: string }
      ) => callback(data);
      ipcRenderer.on('cron:testing', listener);
      return () => ipcRenderer.removeListener('cron:testing', listener);
    },
    onTelegramMessage: (
      callback: (data: {
        userMessage: string;
        response: string;
        chatId: number;
        sessionId: string;
        hasAttachment?: boolean;
        attachmentType?: 'photo' | 'voice' | 'audio';
        wasCompacted?: boolean;
        media?: Array<{ type: string; filePath: string; mimeType: string }>;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          userMessage: string;
          response: string;
          chatId: number;
          sessionId: string;
          hasAttachment?: boolean;
          attachmentType?: 'photo' | 'voice' | 'audio';
          wasCompacted?: boolean;
          media?: Array<{ type: string; filePath: string; mimeType: string }>;
        }
      ) => callback(data);
      ipcRenderer.on('telegram:message', listener);
      return () => ipcRenderer.removeListener('telegram:message', listener);
    },
    onIOSMessage: (
      callback: (data: {
        userMessage: string;
        response: string;
        sessionId: string;
        deviceId: string;
        media?: Array<{ type: string; filePath: string; mimeType: string }>;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          userMessage: string;
          response: string;
          sessionId: string;
          deviceId: string;
          media?: Array<{ type: string; filePath: string; mimeType: string }>;
        }
      ) => callback(data);
      ipcRenderer.on('ios:message', listener);
      return () => ipcRenderer.removeListener('ios:message', listener);
    },
    onModelChanged: (callback: (model: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, model: string) => callback(model);
      ipcRenderer.on('model:changed', listener);
      return () => ipcRenderer.removeListener('model:changed', listener);
    },
  },
});

// Session type
interface Session {
  id: string;
  name: string;
  mode?: 'general' | 'coder';
  working_directory?: string | null;
  created_at: string;
  updated_at: string;
  telegram_linked?: boolean;
  telegram_group_name?: string | null;
}

// Type declarations for renderer
declare global {
  interface Window {
    pocketAgent: {
      agent: {
        send: (
          message: string,
          sessionId?: string,
          images?: Array<{ type: 'base64'; mediaType: string; data: string }>
        ) => Promise<{
          success: boolean;
          response?: string;
          error?: string;
          tokensUsed?: number;
          suggestedPrompt?: string;
          media?: Array<{ type: string; filePath: string; mimeType: string }>;
        }>;
        stop: (sessionId?: string) => Promise<{ success: boolean }>;
        setMode: (mode: string) => Promise<{ success: boolean; error?: string }>;
        getMode: () => Promise<string>;
        getSessionMode: (sessionId: string) => Promise<string>;
        setSessionMode: (
          sessionId: string,
          mode: string
        ) => Promise<{ success: boolean; error?: string }>;
        onModeChanged: (callback: (mode: string) => void) => () => void;
        onSessionModeChanged: (callback: (sessionId: string, mode: string) => void) => () => void;
        onStatus: (
          callback: (status: {
            type: string;
            toolName?: string;
            toolInput?: string;
            message?: string;
          }) => void
        ) => () => void;
        getHistory: (
          limit?: number,
          sessionId?: string
        ) => Promise<
          Array<{
            role: string;
            content: string;
            timestamp: string;
            metadata?: { source?: string; jobName?: string };
          }>
        >;
        getStats: (sessionId?: string) => Promise<{
          messageCount: number;
          factCount: number;
          estimatedTokens: number;
          sessionCount?: number;
          contextTokens?: number;
          contextWindow?: number;
        } | null>;
        clearConversation: (sessionId?: string) => Promise<{ success: boolean }>;
        readMedia: (filePath: string) => Promise<string | null>;
        restart: () => Promise<{ success: boolean }>;
      };

      attachments: {
        save: (name: string, dataUrl: string) => Promise<string>;
        extractText: (filePath: string) => Promise<string>;
      };

      sessions: {
        list: () => Promise<Session[]>;
        create: (name: string) => Promise<{ success: boolean; session?: Session; error?: string }>;
        rename: (id: string, name: string) => Promise<{ success: boolean; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean }>;
        onChanged: (callback: () => void) => () => void;
        onCleared: (callback: (sessionId: string) => void) => () => void;
      };

      facts: {
        list: () => Promise<
          Array<{ id: number; category: string; subject: string; content: string }>
        >;
        search: (
          query: string
        ) => Promise<Array<{ category: string; subject: string; content: string }>>;
        getCategories: () => Promise<string[]>;
        delete: (id: number) => Promise<{ success: boolean }>;
      };

      soul: {
        listAspects: () => Promise<
          Array<{
            id: number;
            aspect: string;
            content: string;
            created_at: string;
            updated_at: string;
          }>
        >;
        getAspect: (aspect: string) => Promise<{
          id: number;
          aspect: string;
          content: string;
          created_at: string;
          updated_at: string;
        } | null>;
        deleteAspect: (id: number) => Promise<{ success: boolean }>;
      };

      dailyLogs: {
        list: () => Promise<
          Array<{ id: number; date: string; content: string; updated_at: string }>
        >;
        delete: (id: number) => Promise<{ success: boolean }>;
      };

      app: {
        openFacts: () => Promise<void>;
        openDailyLogs: () => Promise<void>;
        openSoul: () => Promise<void>;
        openCustomize: () => Promise<void>;
        openRoutines: () => Promise<void>;
        openExternal: (url: string) => Promise<void>;
        openPath: (filePath: string) => Promise<void>;
        openImage: (src: string) => Promise<void>;
        openSettings: (tab?: string) => Promise<void>;
        openChat: () => Promise<void>;
        getVersion: () => Promise<string>;
        getPlatform: () => string;
        onNavigateTab: (callback: (tab: string) => void) => () => void;
        onOpenSettings: (callback: (tab?: string) => void) => () => void;
      };

      customize: {
        getSystemPrompt: () => Promise<string>;
        getAgentModes: () => Promise<
          Array<{
            id: string;
            name: string;
            icon: string;
            systemPrompt: string;
            description: string;
          }>
        >;
      };

      location: {
        lookup: (query: string) => Promise<
          Array<{
            city: string;
            country: string;
            province: string;
            timezone: string;
            display: string;
          }>
        >;
        getTimezones: () => Promise<string[]>;
      };

      cron: {
        list: () => Promise<
          Array<{
            id: number;
            name: string;
            schedule_type?: string;
            schedule: string | null;
            run_at?: string | null;
            interval_ms?: number | null;
            prompt: string;
            channel: string;
            enabled: boolean;
            session_id?: string | null;
            job_type?: 'routine' | 'reminder';
          }>
        >;
        create: (
          name: string,
          schedule: string,
          prompt: string,
          channel: string,
          sessionId: string
        ) => Promise<{ success: boolean }>;
        delete: (name: string) => Promise<{ success: boolean }>;
        toggle: (name: string, enabled: boolean) => Promise<{ success: boolean }>;
        run: (name: string) => Promise<{
          jobName: string;
          response: string;
          success: boolean;
          error?: string;
        } | null>;
        getHistory: (
          limit?: number
        ) => Promise<
          Array<{ jobName: string; response: string; success: boolean; timestamp: string }>
        >;
      };

      settings: {
        getAll: () => Promise<Record<string, string>>;
        get: (key: string) => Promise<string>;
        set: (key: string, value: string) => Promise<{ success: boolean }>;
        delete: (key: string) => Promise<{ success: boolean }>;
        getSchema: (category?: string) => Promise<
          Array<{
            key: string;
            defaultValue: string;
            encrypted: boolean;
            category: string;
            label: string;
            description?: string;
            type: string;
          }>
        >;
        isFirstRun: () => Promise<boolean>;
        resetOnboarding: () => Promise<{ success: boolean }>;
        initializeKeychain: () => Promise<{ available: boolean; error?: string }>;
        getAvailableModels: () => Promise<Array<{ id: string; name: string; provider: string }>>;
      };

      validate: {
        anthropicKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        openAIKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        moonshotKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        glmKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        telegramToken: (
          token: string
        ) => Promise<{ valid: boolean; error?: string; botInfo?: unknown }>;
        storedKey: (provider: string) => Promise<{ valid: boolean; error?: string }>;
      };

      auth: {
        startOAuth: () => Promise<{ success: boolean; error?: string }>;
        completeOAuth: (code: string) => Promise<{ success: boolean; error?: string }>;
        cancelOAuth: () => Promise<{ success: boolean }>;
        isOAuthPending: () => Promise<boolean>;
        validateOAuth: () => Promise<{ valid: boolean; error?: string }>;
        onExpired: (callback: () => void) => () => void;
      };

      openaiAuth: {
        startOAuth: () => Promise<{ success: boolean; error?: string }>;
        completeOAuth: () => Promise<{ success: boolean; error?: string }>;
        validateOAuth: () => Promise<{ valid: boolean; error?: string }>;
        logoutOAuth: () => Promise<{ success: boolean }>;
      };

      themes: {
        list: () => Promise<
          Record<string, { id: string; name: string; palette: Record<string, string> | null }>
        >;
        getSkin: () => Promise<string>;
        onSkinChanged: (callback: (skinId: string) => void) => () => void;
      };

      chat: {
        onUsernameChanged: (callback: (username: string) => void) => () => void;
      };

      commands: {
        list: (
          sessionId?: string
        ) => Promise<
          Array<{ name: string; description: string; filename: string; content: string }>
        >;
      };

      updater: {
        checkForUpdates: () => Promise<{
          status: string;
          info?: { version: string };
          error?: string;
        }>;
        download: () => Promise<{ success: boolean; error?: string }>;
        install: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{
          status: string;
          info?: { version: string };
          progress?: { percent: number };
          error?: string;
        }>;
        onStatus: (
          callback: (status: {
            status: string;
            info?: { version: string };
            progress?: { percent: number };
            error?: string;
          }) => void
        ) => () => void;
      };

      browser: {
        detectInstalled: () => Promise<
          Array<{
            id: string;
            name: string;
            path: string;
            processName: string;
            installed: boolean;
          }>
        >;
        launch: (
          browserId: string,
          port?: number
        ) => Promise<{ success: boolean; error?: string; alreadyRunning?: boolean }>;
        testConnection: (
          cdpUrl?: string
        ) => Promise<{ connected: boolean; error?: string; browserInfo?: unknown }>;
      };

      ios: {
        getPairingCode: (
          regenerate?: boolean
        ) => Promise<{ code: string; expiresAt: string } | null>;
        getDevices: () => Promise<Array<{ id: string; name: string; lastSeen: string }>>;
        getInfo: () => Promise<{ enabled: boolean; port: number }>;
        toggle: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
      };

      agentHome: {
        toggle: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{ connected: boolean; agentName: string }>;
      };

      shell: {
        runCommand: (command: string) => Promise<string>;
      };

      permissions: {
        isMacOS: () => Promise<boolean>;
        check: (types: string[]) => Promise<
          Array<{
            type: string;
            granted: boolean;
            canRequest: boolean;
            label: string;
            description: string;
            settingsUrl: string;
          }>
        >;
        openSettings: (type: string) => Promise<void>;
      };

      events: {
        onSchedulerMessage: (
          callback: (data: {
            jobName: string;
            prompt: string;
            response: string;
            sessionId: string;
          }) => void
        ) => () => void;
        onTelegramMessage: (
          callback: (data: {
            userMessage: string;
            response: string;
            chatId: number;
            sessionId: string;
            hasAttachment?: boolean;
            attachmentType?: 'photo' | 'voice' | 'audio';
            wasCompacted?: boolean;
            media?: Array<{ type: string; filePath: string; mimeType: string }>;
          }) => void
        ) => () => void;
        onIOSMessage: (
          callback: (data: {
            userMessage: string;
            response: string;
            sessionId: string;
            deviceId: string;
            media?: Array<{ type: string; filePath: string; mimeType: string }>;
          }) => void
        ) => () => void;
        onModelChanged: (callback: (model: string) => void) => () => void;
      };
    };
  }
}
