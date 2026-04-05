/* Return to chat view — dismiss all panels and exit global chat */
function returnToChatView() {
  _dismissOtherPanels(null);
  const chatView = document.getElementById('chat-view');
  if (chatView) chatView.classList.remove('hidden');
  // Exit global chat if active
  if (typeof globalChatMode !== 'undefined' && globalChatMode) {
    toggleGlobalChat();
  }
}

/* Shared panel helper — dismiss other panels */
function _dismissOtherPanels(keepId) {
  const panels = {
    'settings-view': 'sidebar-settings-btn',
    'brain-view': 'sidebar-brain-btn',
    'routines-view': 'sidebar-routines-btn',
    'personalize-view': 'sidebar-personalize-btn',
  };
  for (const [viewId, btnId] of Object.entries(panels)) {
    if (viewId === keepId) continue;
    const v = document.getElementById(viewId);
    if (v && v.classList.contains('active')) {
      v.classList.remove('active');
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.remove('active');
    }
  }
}

/* Settings Panel — embedded in chat.html */

let _stgInitialized = false;
let _stgSettings = {};
let _stgNotyf = null;
let _stgUpdateStatusCleanup = null;
let _stgPocketCliInstalledVersion = null;
let _stgCurrentSkinId = 'default';
let _stgThemesCache = null;

const _stgRoot = () => document.getElementById('settings-view');

// ---- Show / Hide ----

function showSettingsPanel(tab) {
  const chatView = document.getElementById('chat-view');
  const settingsView = document.getElementById('settings-view');
  const brainView = document.getElementById('brain-view');
  if (!settingsView) return;

  // Hide other panels if open
  _dismissOtherPanels('settings-view');

  chatView.classList.add('hidden');
  settingsView.classList.add('active');

  // Mark sidebar button active
  const sidebarBtn = document.getElementById('sidebar-settings-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_stgInitialized) {
    _initSettingsPanel();
    _stgInitialized = true;
  }

  if (tab) _stgNavigateToSection(tab);
}

function hideSettingsPanel() {
  const chatView = document.getElementById('chat-view');
  const settingsView = document.getElementById('settings-view');
  if (!settingsView) return;

  settingsView.classList.remove('active');
  chatView.classList.remove('hidden');

  // Unmark sidebar button
  const sidebarBtn = document.getElementById('sidebar-settings-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleSettingsPanel() {
  const settingsView = document.getElementById('settings-view');
  if (settingsView && settingsView.classList.contains('active')) {
    hideSettingsPanel();
  } else {
    showSettingsPanel();
  }
}

// ---- Toast ----

function _stgShowToast(message, type) {
  if (!_stgNotyf) {
    _stgNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _stgNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- Initialization ----

function _initSettingsPanel() {
  const root = _stgRoot();
  if (!root) return;

  // Handle external links
  root.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (link && link.href && (link.target === '_blank' || link.href.startsWith('http'))) {
      e.preventDefault();
      window.pocketAgent.app.openExternal(link.href);
    }
  });

  _stgLoadSettings().then(() => {
    _stgLoadAppVersion();
    _stgSetupNavigation();
    _stgSetupAutoSave();
    _stgRefreshModelDropdown();
    _stgInitializeBrowserSection();
    _stgInitPocketCli();
    _stgInitSkinPicker();
    _stgInitializeUpdates();
  });

  // Listen for auth expiry events from the main process
  window.pocketAgent.auth.onExpired(() => {
    _stgLoadSettings();
  });
}

async function _stgLoadAppVersion() {
  try {
    const version = await window.pocketAgent.app.getVersion();
    const el = document.getElementById('current-version');
    if (el) el.textContent = `v${version}`;
  } catch (err) {
    console.error('[Settings] Failed to load app version:', err);
  }
}

async function _stgLoadSettings() {
  try {
    _stgSettings = await window.pocketAgent.settings.getAll();
    _stgPopulateFields();
    _stgUpdateToggles();
    _stgUpdateAuthStatus();
    _stgUpdateOpenAIAuthStatus();
    _stgUpdateDeleteButtons();
  } catch (err) {
    console.error('[Settings] Failed to load settings:', err);
    _stgShowToast('Hmm, couldn\'t grab settings', 'error');
  }
}

async function _stgRefreshModelDropdown() {
  try {
    const models = await window.pocketAgent.settings.getAvailableModels();
    const dropdown = document.getElementById('agent.model');
    if (!dropdown) return;
    const savedModel = _stgSettings['agent.model'] || await window.pocketAgent.settings.get('agent.model');

    dropdown.innerHTML = '';

    if (models.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Add API key to enable models';
      option.disabled = true;
      dropdown.appendChild(option);
      return;
    }

    const groups = { anthropic: 'Anthropic', moonshot: 'Kimi (Moonshot)', glm: 'GLM (Z.AI)' };
    for (const [provider, label] of Object.entries(groups)) {
      const providerModels = models.filter(m => m.provider === provider);
      if (providerModels.length > 0) {
        const group = document.createElement('optgroup');
        group.label = label;
        for (const model of providerModels) {
          const option = document.createElement('option');
          option.value = model.id;
          option.textContent = model.name;
          group.appendChild(option);
        }
        dropdown.appendChild(group);
      }
    }

    const isValidSelection = models.some(m => m.id === savedModel);
    if (isValidSelection) {
      dropdown.value = savedModel;
    } else if (models.length > 0) {
      dropdown.value = models[0].id;
      await window.pocketAgent.settings.set('agent.model', models[0].id);
    }
  } catch (err) {
    console.error('[Settings] Failed to refresh model dropdown:', err);
  }
}

function _stgPopulateFields() {
  const root = _stgRoot();
  if (!root) return;
  const inputs = root.querySelectorAll('input, select');
  for (const input of inputs) {
    const key = input.id;
    if (_stgSettings[key] !== undefined) {
      if (input.type === 'checkbox') {
        input.checked = _stgSettings[key] === 'true';
      } else {
        let value = _stgSettings[key];
        if (value === '[]') value = '';
        if (input.type === 'password' && value === '••••••••') {
          input.placeholder = '••••••••  (key saved)';
          continue;
        }
        input.value = value;
      }
    }
  }
}

function _stgUpdateToggles() {
  const toggleMap = {
    'agentHome.enabled': { toggle: 'agentHome.enabled-toggle', config: 'agent-home-config' },
    'telegram.enabled': { toggle: 'telegram.enabled-toggle', config: 'telegram-config' },
    'ios.enabled': { toggle: 'ios.enabled-toggle', config: 'ios-config' },
    'browser.enabled': { toggle: 'browser.enabled-toggle', config: 'browser-config' },
    'browser.useMyBrowser': { toggle: 'browser.useMyBrowser-toggle' },
    'pocketCli.autoCheck': { toggle: 'pocketCli.autoCheck-toggle', defaultTrue: true },
    'updates.autoCheck': { toggle: 'updates.autoCheck-toggle', defaultTrue: true },
  };

  for (const [key, cfg] of Object.entries(toggleMap)) {
    const toggleEl = document.getElementById(cfg.toggle);
    if (!toggleEl) continue;
    const enabled = cfg.defaultTrue
      ? _stgSettings[key] !== 'false'
      : _stgSettings[key] === 'true';
    toggleEl.classList.toggle('active', enabled);
    if (cfg.config) {
      const configEl = document.getElementById(cfg.config);
      if (configEl) configEl.classList.toggle('disabled-section', !enabled);
    }
  }
}

function _stgSetupNavigation() {
  const root = _stgRoot();
  if (!root) return;
  const navItems = root.querySelectorAll('.settings-nav-item');
  const sections = root.querySelectorAll('.settings-section');

  navItems.forEach((item, index) => {
    item.classList.toggle('active', index === 0);
  });
  sections.forEach((section, index) => {
    section.classList.toggle('active', index === 0);
  });

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      _stgNavigateToSection(item.dataset.section);
    });
  });

  if (window.pocketAgent?.events?.onModelChanged) {
    window.pocketAgent.events.onModelChanged(() => _stgRefreshModelDropdown());
  }
}

function _stgNavigateToSection(sectionId) {
  const root = _stgRoot();
  if (!root) return;
  const navItems = root.querySelectorAll('.settings-nav-item');
  const sections = root.querySelectorAll('.settings-section');
  const targetNav = root.querySelector(`.settings-nav-item[data-section="${sectionId}"]`);
  const targetSection = document.getElementById(sectionId);

  if (targetNav && targetSection) {
    navItems.forEach(n => n.classList.remove('active'));
    targetNav.classList.add('active');
    sections.forEach(s => s.classList.remove('active'));
    targetSection.classList.add('active');
  }

  if (sectionId === 'agent_home') {
    _stgInitAgentHome();
  }

  if (sectionId === 'ios') {
    _stgRefreshIOSInfo();
    _stgRefreshPairingCode();
    _stgRefreshConnectedDevices();
  }
}

function _stgSetupAutoSave() {
  const root = _stgRoot();
  if (!root) return;
  const excludedIds = [
    'anthropic.apiKey', 'openai.apiKey', 'moonshot.apiKey', 'glm.apiKey',
    'auth-api-key', 'oauth-code',
    'telegram.botToken', 'telegram.allowedUserIds', 'telegram.defaultChatId',
    'chat.adminKey',
    'agentHome.token'
  ];

  const inputs = root.querySelectorAll('input, select');

  inputs.forEach(input => {
    if (excludedIds.includes(input.id)) return;

    input.addEventListener('change', async () => {
      const key = input.id;
      const value = input.type === 'checkbox' ? input.checked.toString() : input.value;
      const oldValue = _stgSettings[key];
      _stgSettings[key] = value;

      try {
        await window.pocketAgent.settings.set(key, value);
        _stgShowToast('Got it!', 'success');
        const rebootSettings = ['agent.model', 'telegram.allowedUserIds', 'telegram.botToken'];
        if (rebootSettings.includes(key)) _stgActivateReboot();
      } catch (err) {
        _stgSettings[key] = oldValue;
        console.error('[Settings] Failed to save setting:', err);
        _stgShowToast('Oops, couldn\'t save that', 'error');
      }
    });
  });
}

// ---- Key Validation ----

const _stgKeyValidators = {
  'anthropic.apiKey': { pattern: /^sk-ant-[A-Za-z0-9_-]{90,}$/, hint: 'Anthropic keys start with "sk-ant-"' },
  'openai.apiKey': { pattern: /^sk-[A-Za-z0-9_-]{40,}$/, hint: 'OpenAI keys start with "sk-"' },
  'moonshot.apiKey': { pattern: /^sk-[A-Za-z0-9_-]{40,}$/, hint: 'Moonshot keys start with "sk-"' },
  'glm.apiKey': { pattern: /^.{10,}$/, hint: 'Enter your Z.AI API key' },
  'xiaomi.apiKey': { pattern: /^.{10,}$/, hint: 'Enter your Xiaomi API key' },
  'minimax.apiKey': { pattern: /^.{10,}$/, hint: 'Enter your MiniMax API key' },
  'telegram.botToken': { pattern: /^\d{6,}:[A-Za-z0-9_-]{30,}$/, hint: 'Telegram tokens are in format "123456789:ABC..."' }
};

function _stgValidateKeyFormat(inputId, key) {
  const validator = _stgKeyValidators[inputId];
  if (!validator) return { valid: true };
  if (!validator.pattern.test(key)) return { valid: false, error: validator.hint };
  return { valid: true };
}

// These functions are called from inline onclick handlers in the HTML
// They must be global

async function stgSaveKey(inputId) {
  const input = document.getElementById(inputId);
  const key = input.value.trim();
  if (!key) { _stgShowToast('Need a key first!', 'error'); return; }
  const validation = _stgValidateKeyFormat(inputId, key);
  if (!validation.valid) { _stgShowToast(validation.error, 'error'); return; }
  try {
    await window.pocketAgent.settings.set(inputId, key);
    _stgSettings[inputId] = key;
    _stgShowToast('Got it!', 'success');
    const deleteBtn = document.getElementById(`${inputId}-delete`);
    if (deleteBtn) deleteBtn.classList.add('visible');
    const rebootKeys = ['anthropic.apiKey', 'telegram.botToken'];
    if (rebootKeys.includes(inputId)) _stgActivateReboot();
  } catch (err) {
    console.error('[Settings] Failed to save key:', err);
    _stgShowToast('Save hiccup, try again?', 'error');
  }
}

function _stgUpdateDeleteButtons() {
  const keyIds = ['anthropic.apiKey', 'openai.apiKey', 'moonshot.apiKey', 'glm.apiKey', 'xiaomi.apiKey', 'minimax.apiKey', 'telegram.botToken'];
  for (const keyId of keyIds) {
    const deleteBtn = document.getElementById(`${keyId}-delete`);
    if (deleteBtn) {
      const hasKey = _stgSettings[keyId] && _stgSettings[keyId].trim() !== '';
      deleteBtn.classList.toggle('visible', hasKey);
    }
  }
  const authDeleteBtn = document.getElementById('auth-api-key-delete');
  if (authDeleteBtn) {
    const hasKey = _stgSettings['anthropic.apiKey'] && _stgSettings['anthropic.apiKey'].trim() !== '';
    authDeleteBtn.classList.toggle('visible', hasKey);
  }
}

async function stgDeleteKey(keyId, inputId) {
  const actualInputId = inputId || keyId;
  try {
    await window.pocketAgent.settings.set(keyId, '');
    _stgSettings[keyId] = '';
    const input = document.getElementById(actualInputId);
    if (input) input.value = '';
    const deleteBtn = document.getElementById(`${actualInputId}-delete`);
    if (deleteBtn) deleteBtn.classList.remove('visible');
    _stgShowToast('Key removed!', 'success');
    _stgActivateReboot();
    if (keyId === 'anthropic.apiKey') _stgUpdateAuthStatus();
  } catch (err) {
    console.error('[Settings] Failed to delete key:', err);
    _stgShowToast('Oops, couldn\'t delete that', 'error');
  }
}

async function stgToggleSetting(key) {
  const currentValue = _stgSettings[key] === 'true';
  const newValue = (!currentValue).toString();
  try {
    await window.pocketAgent.settings.set(key, newValue);
    _stgSettings[key] = newValue;
    _stgUpdateToggles();
    _stgShowToast('Got it!', 'success');
  } catch (err) {
    console.error('[Settings] Failed to toggle setting:', err);
    _stgShowToast('Oops, couldn\'t save that', 'error');
  }
}

async function stgValidateKey(provider) {
  const inputId = provider === 'telegram' ? 'telegram.botToken' : `${provider}.apiKey`;
  const input = document.getElementById(inputId);
  const button = input.parentElement.querySelector('button:not(.delete-btn)');
  const key = input.value.trim();

  // If input is empty but a key is already saved, validate via backend
  if (!key && _stgSettings[inputId] === '••••••••') {
    button.classList.add('validating');
    button.textContent = 'Testing...';
    try {
      const result = await window.pocketAgent.validate.storedKey(provider);
      if (result.valid) {
        _stgShowToast('All good!', 'success');
      } else {
        _stgShowToast(result.error || 'That key didn\'t work', 'error');
      }
    } catch (err) {
      _stgShowToast('Validation failed: ' + err.message, 'error');
    }
    button.classList.remove('validating');
    button.textContent = 'Test';
    return;
  }

  if (!key) { _stgShowToast('Key please!', 'error'); return; }
  const formatValidation = _stgValidateKeyFormat(inputId, key);
  if (!formatValidation.valid) { _stgShowToast(formatValidation.error, 'error'); return; }

  button.classList.add('validating');
  button.textContent = 'Testing...';

  try {
    let result;
    if (provider === 'anthropic') result = await window.pocketAgent.validate.anthropicKey(key);
    else if (provider === 'openai') result = await window.pocketAgent.validate.openAIKey(key);
    else if (provider === 'moonshot') result = await window.pocketAgent.validate.moonshotKey(key);
    else if (provider === 'glm') result = await window.pocketAgent.validate.glmKey(key);
    else if (provider === 'xiaomi') result = await window.pocketAgent.validate.xiaomiKey(key);
    else if (provider === 'minimax') result = await window.pocketAgent.validate.minimaxKey(key);
    else if (provider === 'telegram') result = await window.pocketAgent.validate.telegramToken(key);

    if (result.valid) {
      await window.pocketAgent.settings.set(inputId, key);
      _stgSettings[inputId] = key;
      _stgShowToast(result.botInfo ? `Valid! Bot: @${result.botInfo.username}` : 'All good!', 'success');
      const deleteBtn = document.getElementById(`${inputId}-delete`);
      if (deleteBtn) deleteBtn.classList.add('visible');
      if (['anthropic', 'telegram'].includes(provider)) _stgActivateReboot();
    } else {
      _stgShowToast(result.error || 'That key didn\'t work', 'error');
    }
  } catch (err) {
    _stgShowToast('Validation failed: ' + err.message, 'error');
  }

  button.classList.remove('validating');
  button.textContent = 'Test';
}

// ---- Reboot ----

function _stgActivateReboot() {
  const btn = document.getElementById('reboot-btn');
  if (btn) { btn.disabled = false; btn.classList.add('active'); }
}

function _stgDeactivateReboot() {
  const btn = document.getElementById('reboot-btn');
  if (btn) { btn.disabled = true; btn.classList.remove('active'); }
}

async function stgRestartAgent() {
  const btn = document.getElementById('reboot-btn');
  if (btn && btn.disabled) return;
  try {
    _stgShowToast('Waking up...', 'success');
    await window.pocketAgent.agent.restart();
    _stgDeactivateReboot();
    _stgShowToast('I\'m back!', 'success');
  } catch (err) {
    _stgShowToast('Failed to restart: ' + err.message, 'error');
  }
}

// ---- Telegram ----

async function stgSaveTelegramSetting(inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  try {
    await window.pocketAgent.settings.set(inputId, value);
    _stgSettings[inputId] = value;
    _stgShowToast('Saved!', 'success');
    _stgActivateReboot();
  } catch (err) {
    console.error('[Settings] Failed to save telegram setting:', err);
    _stgShowToast('Save failed, try again?', 'error');
  }
}

// ---- iOS ----

async function stgToggleiOS() {
  const currentValue = _stgSettings['ios.enabled'] === 'true';
  const newValue = !currentValue;
  try {
    await window.pocketAgent.settings.set('ios.enabled', newValue.toString());
    _stgSettings['ios.enabled'] = newValue.toString();
    _stgUpdateToggles();
    const result = await window.pocketAgent.ios.toggle(newValue);
    if (result.success) {
      _stgShowToast(newValue ? 'Mobile connection started!' : 'Mobile connection stopped', 'success');
      if (newValue) setTimeout(() => { _stgRefreshIOSInfo(); _stgRefreshPairingCode(); _stgRefreshConnectedDevices(); }, 500);
    } else {
      _stgShowToast('Failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    console.error('[Settings] Failed to toggle iOS:', err);
    _stgShowToast('Failed to toggle mobile connection', 'error');
  }
}

async function stgCopyPairingCode() {
  const codeEl = document.getElementById('ios-pairing-code');
  const code = codeEl.textContent;
  if (!code || code === '------') return;
  try {
    await navigator.clipboard.writeText(code);
    codeEl.style.transform = 'scale(1.05)';
    codeEl.style.color = 'var(--success)';
    setTimeout(() => { codeEl.style.transform = 'scale(1)'; codeEl.style.color = 'var(--accent)'; }, 500);
    _stgShowToast('Pairing code copied');
  } catch (err) { _stgShowToast('Failed to copy', 'error'); }
}

async function stgCopyInstanceId() {
  const el = document.getElementById('ios-instance-id');
  const id = el.textContent;
  if (!id || id === '--------') return;
  try {
    await navigator.clipboard.writeText(id);
    el.style.transform = 'scale(1.05)';
    el.style.color = 'var(--success)';
    setTimeout(() => { el.style.transform = 'scale(1)'; el.style.color = 'var(--text-primary)'; }, 500);
    _stgShowToast('Instance ID copied');
  } catch (err) { _stgShowToast('Failed to copy', 'error'); }
}

async function _stgRefreshPairingCode(regenerate) {
  try {
    const result = await window.pocketAgent.ios.getPairingCode(!!regenerate);
    if (result && result.code) {
      document.getElementById('ios-pairing-code').textContent = result.code;
      if (result.instanceId) document.getElementById('ios-instance-id').textContent = result.instanceId;
    } else {
      document.getElementById('ios-pairing-code').textContent = '------';
    }
  } catch (err) {
    console.error('[Settings] Failed to get pairing code:', err);
    const el = document.getElementById('ios-pairing-code');
    if (el) el.textContent = '------';
  }
}

async function stgRefreshPairingCode(regenerate) { _stgRefreshPairingCode(regenerate); }

async function _stgRefreshIOSInfo() {
  try {
    const info = await window.pocketAgent.ios.getInfo();
    if (info && info.instanceId) document.getElementById('ios-instance-id').textContent = info.instanceId;
  } catch (err) { console.error('[Settings] Failed to get iOS info:', err); }
}

function _stgEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function _stgRefreshConnectedDevices() {
  try {
    const devices = await window.pocketAgent.ios.getDevices();
    const container = document.getElementById('ios-devices');
    if (!container) return;
    if (devices && devices.length > 0) {
      container.innerHTML = devices.map(d =>
        '<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border);">' +
        '<span style="color: var(--text-primary); font-size: 13px;">' + _stgEscapeHtml(d.deviceName || 'Unknown Device') + '</span>' +
        '<span style="color: var(--text-muted); font-size: 12px;">' + _stgEscapeHtml(d.sessionId || 'default') + '</span>' +
        '</div>'
      ).join('');
    } else {
      container.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; text-align: center;">No devices connected</p>';
    }
  } catch (err) { /* iOS channel not running */ }
}

// ---- Chat Settings ----

const _STG_CHAT_API_URL = 'https://pocket-agent-chat-production.up.railway.app';
const _STG_CHAT_USERNAME_REGEX = /^[a-z0-9-]{1,15}$/;

async function stgSaveChatUsername() {
  const input = document.getElementById('chat.username');
  const raw = input.value.trim().toLowerCase();
  if (!raw) { _stgShowToast('Enter a username', 'error'); return; }
  if (!_STG_CHAT_USERNAME_REGEX.test(raw)) { _stgShowToast('Letters, numbers, dashes only (max 15)', 'error'); return; }

  const oldUsername = _stgSettings['chat.username'] || '';
  const adminKey = document.getElementById('chat.adminKey').value.trim() || _stgSettings['chat.adminKey'] || '';

  if (raw === oldUsername.toLowerCase()) { _stgShowToast('Username unchanged', 'success'); return; }

  try {
    const checkParams = new URLSearchParams({ name: raw });
    if (adminKey) checkParams.set('adminKey', adminKey);
    const checkRes = await fetch(`${_STG_CHAT_API_URL}/api/check-username?${checkParams}`);
    if (!checkRes.ok) { _stgShowToast('Chat server error, try again later', 'error'); return; }
    const checkData = await checkRes.json();
    if (!checkData.available) { _stgShowToast('Username taken, try another', 'error'); return; }

    const regRes = await fetch(`${_STG_CHAT_API_URL}/api/register-username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: raw, oldUsername, adminKey }),
    });
    if (!regRes.ok) { _stgShowToast('Chat server error, try again later', 'error'); return; }
    const regData = await regRes.json();
    if (regData.error) { _stgShowToast(regData.error === 'taken' ? 'Username taken, try another' : regData.error, 'error'); return; }

    input.value = raw;
    await window.pocketAgent.settings.set('chat.username', raw);
    _stgSettings['chat.username'] = raw;
    _stgShowToast('Username saved!', 'success');
  } catch (err) {
    console.error('[Settings] Failed to save username:', err);
    _stgShowToast('Could not reach chat server', 'error');
  }
}

async function stgSaveChatAdminKey() {
  try {
    const adminKey = document.getElementById('chat.adminKey').value.trim();
    await window.pocketAgent.settings.set('chat.adminKey', adminKey);
    _stgSettings['chat.adminKey'] = adminKey;
    _stgShowToast('Admin key saved!', 'success');
    _stgActivateReboot();
  } catch (err) {
    console.error('[Settings] Failed to save admin key:', err);
    _stgShowToast('Save failed, try again?', 'error');
  }
}

// ---- Auth ----

async function _stgUpdateAuthStatus() {
  const statusBadge = document.getElementById('auth-status');
  const authBtn = document.getElementById('oauth-btn');
  const oauthCodeSection = document.getElementById('oauth-code-section');
  const authMethod = _stgSettings['auth.method'];
  const hasOAuth = _stgSettings['auth.oauthToken'];
  const hasApiKey = _stgSettings['anthropic.apiKey'];
  const hasMoonshotKey = _stgSettings['moonshot.apiKey'];
  const hasGlmKey = _stgSettings['glm.apiKey'];
  const anthropicKeyRow = document.getElementById('anthropic-key-row');
  const authApiKeySection = document.getElementById('auth-api-key-section');

  if (!statusBadge || !authBtn) return;

  if (oauthCodeSection) oauthCodeSection.classList.add('hidden');

  if (authMethod === 'oauth' && hasOAuth) {
    statusBadge.className = 'auth-badge loading';
    statusBadge.textContent = 'checking...';
    authBtn.textContent = 'Sign Out';
    authBtn.className = 'logout-btn';
    if (anthropicKeyRow) anthropicKeyRow.classList.add('hidden');
    if (authApiKeySection) { authApiKeySection.classList.add('disabled-section'); authApiKeySection.style.pointerEvents = 'none'; }

    try {
      const result = await window.pocketAgent.auth.validateOAuth();
      if (result.valid) { statusBadge.className = 'auth-badge oauth'; statusBadge.textContent = 'Connected'; }
      else { statusBadge.className = 'auth-badge none'; statusBadge.textContent = 'Session expired'; authBtn.textContent = 'Sign In'; authBtn.className = 'oauth-btn'; }
    } catch {
      statusBadge.className = 'auth-badge none'; statusBadge.textContent = 'Could not verify'; authBtn.textContent = 'Sign In'; authBtn.className = 'oauth-btn';
    }
  } else {
    statusBadge.className = 'auth-badge none hidden';
    statusBadge.textContent = '';
    authBtn.textContent = 'Sign In';
    authBtn.className = 'oauth-btn';
    if (anthropicKeyRow) anthropicKeyRow.classList.remove('hidden');
    if (authApiKeySection) { authApiKeySection.classList.remove('disabled-section'); authApiKeySection.style.pointerEvents = 'auto'; }
  }
}

async function stgHandleAuthAction() {
  const authBtn = document.getElementById('oauth-btn');
  if (authBtn.classList.contains('logout-btn')) { await stgLogout(); } else { await stgStartOAuth(); }
}

async function stgStartOAuth() {
  const btn = document.getElementById('oauth-btn');
  btn.disabled = true;
  btn.textContent = 'Opening...';
  try {
    const result = await window.pocketAgent.auth.startOAuth();
    if (result.success) {
      document.getElementById('oauth-code-section').classList.remove('hidden');
      document.getElementById('oauth-code').focus();
    } else { _stgShowToast(result.error || 'Failed to start OAuth', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'OAuth failed', 'error'); }
  btn.disabled = false;
  btn.textContent = 'Sign In';
}

async function stgCompleteOAuth() {
  const code = document.getElementById('oauth-code').value.trim();
  const submitBtn = document.querySelector('#oauth-code-section button');
  if (!code) { _stgShowToast('Paste the code!', 'error'); return; }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying...';
  try {
    const result = await window.pocketAgent.auth.completeOAuth(code);
    if (result.success) {
      _stgShowToast('Connected!', 'success');
      document.getElementById('oauth-code-section').classList.add('hidden');
      document.getElementById('oauth-code').value = '';
      await _stgLoadSettings();
      _stgUpdateAuthStatus();
      await _stgRefreshModelDropdown();
    } else { _stgShowToast(result.error || 'That code didn\'t work', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'Verification failed', 'error'); }
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit';
}

async function stgSaveApiKey() {
  const input = document.getElementById('auth-api-key');
  const button = input.parentElement.querySelector('button:not(.delete-btn)');
  const key = input.value.trim();
  if (!key) { _stgShowToast('Need your API key!', 'error'); return; }
  const formatValidation = _stgValidateKeyFormat('anthropic.apiKey', key);
  if (!formatValidation.valid) { _stgShowToast(formatValidation.error, 'error'); return; }
  button.disabled = true;
  button.textContent = 'Validating...';
  try {
    const result = await window.pocketAgent.validate.anthropicKey(key);
    if (result.valid) {
      await window.pocketAgent.settings.set('anthropic.apiKey', key);
      await window.pocketAgent.settings.set('auth.method', 'api_key');
      _stgShowToast('Key saved!', 'success');
      _stgActivateReboot();
      const deleteBtn = document.getElementById('auth-api-key-delete');
      if (deleteBtn) deleteBtn.classList.add('visible');
      await _stgLoadSettings();
      _stgUpdateAuthStatus();
      await _stgRefreshModelDropdown();
    } else { _stgShowToast(result.error || 'Invalid key', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'Validation failed', 'error'); }
  button.disabled = false;
  button.textContent = 'Save';
}

async function stgLogout() {
  if (!confirm('Are you sure you want to sign out? You will need to re-authenticate.')) return;
  try {
    await window.pocketAgent.settings.set('auth.method', '');
    await window.pocketAgent.settings.set('auth.oauthToken', '');
    await window.pocketAgent.settings.set('auth.refreshToken', '');
    await window.pocketAgent.settings.set('auth.tokenExpiresAt', '');
    await window.pocketAgent.settings.set('anthropic.apiKey', '');
    _stgShowToast('See ya!', 'success');
    await _stgLoadSettings();
    _stgUpdateAuthStatus();
  } catch (err) { _stgShowToast('Failed to sign out: ' + err.message, 'error'); }
}

// ---- OpenAI OAuth ----

async function _stgUpdateOpenAIAuthStatus() {
  const statusBadge = document.getElementById('openai-auth-status');
  const authBtn = document.getElementById('openai-oauth-btn');

  if (!statusBadge || !authBtn) return;

  const authMethod = _stgSettings['openai.auth.method'];
  const isOAuth = authMethod === 'oauth';

  if (isOAuth) {
    statusBadge.className = 'auth-badge loading';
    statusBadge.textContent = 'checking...';
    authBtn.textContent = 'Sign Out';
    authBtn.className = 'logout-btn';

    try {
      const result = await window.pocketAgent.openaiAuth.validateOAuth();
      if (result.valid) {
        statusBadge.className = 'auth-badge oauth';
        statusBadge.textContent = 'Connected';
      } else {
        statusBadge.className = 'auth-badge none';
        statusBadge.textContent = 'Session expired';
        authBtn.textContent = 'Sign In';
        authBtn.className = 'oauth-btn';
      }
    } catch {
      statusBadge.className = 'auth-badge none';
      statusBadge.textContent = 'Could not verify';
      authBtn.textContent = 'Sign In';
      authBtn.className = 'oauth-btn';
    }
  } else {
    statusBadge.className = 'auth-badge none hidden';
    statusBadge.textContent = '';
    authBtn.textContent = 'Sign In';
    authBtn.className = 'oauth-btn';
  }
}

async function stgHandleOpenAIAuth() {
  const authBtn = document.getElementById('openai-oauth-btn');
  if (authBtn.classList.contains('logout-btn')) {
    if (!confirm('Sign out of OpenAI? You will need to re-authenticate.')) return;
    try {
      await window.pocketAgent.openaiAuth.logoutOAuth();
      await _stgLoadSettings();
      _stgUpdateOpenAIAuthStatus();
      await _stgRefreshModelDropdown();
      _stgShowToast('Signed out.', 'success');
    } catch (err) { _stgShowToast('Failed: ' + err.message, 'error'); }
  } else {
    await stgStartOpenAIOAuth();
  }
}

async function stgStartOpenAIOAuth() {
  const btn = document.getElementById('openai-oauth-btn');
  btn.disabled = true;
  btn.textContent = 'Opening...';
  try {
    const result = await window.pocketAgent.openaiAuth.startOAuth();
    if (result.success) {
      await _stgLoadSettings();
      _stgUpdateOpenAIAuthStatus();
      await _stgRefreshModelDropdown();
      _stgShowToast('Connected!', 'success');
    } else { _stgShowToast(result.error || 'Failed to start OAuth', 'error'); }
  } catch (err) { _stgShowToast(err.message || 'OAuth failed', 'error'); }
  btn.disabled = false;
  btn.textContent = 'Sign In';
}

// ---- Pocket CLI ----

const _STG_CLI_IS_WINDOWS = typeof window.pocketAgent?.app?.getPlatform === 'function' && window.pocketAgent.app.getPlatform() === 'win32';

const _stgCliCommands = {
  which: _STG_CLI_IS_WINDOWS ? '(Get-Command pocket -ErrorAction SilentlyContinue).Source' : 'which pocket',
  version: (pocketPath) => _STG_CLI_IS_WINDOWS ? null : `strings "${pocketPath}" | grep -E '^v[0-9]+\\.[0-9]+\\.[0-9]+$' | head -1`,
  fetchLatest: _STG_CLI_IS_WINDOWS
    ? 'Invoke-RestMethod https://api.github.com/repos/KenKaiii/pocket-agent-cli/releases/latest | ConvertTo-Json -Depth 10'
    : 'curl -fsSL https://api.github.com/repos/KenKaiii/pocket-agent-cli/releases/latest',
  install: _STG_CLI_IS_WINDOWS
    ? [
        '$installDir = Join-Path $env:LOCALAPPDATA "pocket-agent-cli"',
        'New-Item -ItemType Directory -Force -Path $installDir | Out-Null',
        '$release = Invoke-RestMethod "https://api.github.com/repos/KenKaiii/pocket-agent-cli/releases/latest"',
        '$asset = $release.assets | Where-Object { $_.name -like "*windows*amd64*" } | Select-Object -First 1',
        'if (-not $asset) { throw "No Windows release asset found" }',
        '$zipPath = Join-Path $env:TEMP "pocket_cli.zip"',
        'Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath',
        'Expand-Archive -Path $zipPath -DestinationPath $installDir -Force',
        'Remove-Item $zipPath -Force',
        '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
        'if ($userPath -notlike "*$installDir*") { [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User") }',
        'Write-Output "Installed to $installDir"',
      ].join('; ')
    : 'curl -fsSL https://raw.githubusercontent.com/KenKaiii/pocket-agent-cli/main/scripts/install.sh -o /tmp/pocket-cli-install.sh && sed -i "" "s/^.*exec .*$//" /tmp/pocket-cli-install.sh && bash /tmp/pocket-cli-install.sh && rm -f /tmp/pocket-cli-install.sh',
};

async function _stgInitPocketCli() {
  const versionEl = document.getElementById('pocket-cli-version');
  const statusEl = document.getElementById('pocket-cli-status');
  const checkBtn = document.getElementById('pocket-cli-check-btn');
  const installBtn = document.getElementById('pocket-cli-install-btn');
  if (!versionEl || !statusEl) return;

  try {
    const result = await window.pocketAgent.shell.runCommand(_stgCliCommands.which);
    if (result && result.trim()) {
      const versionCmd = _stgCliCommands.version(result.trim());
      if (versionCmd) {
        try {
          const versionResult = await window.pocketAgent.shell.runCommand(versionCmd);
          if (versionResult && versionResult.trim()) {
            _stgPocketCliInstalledVersion = versionResult.trim().replace(/^v/, '');
            versionEl.textContent = `v${_stgPocketCliInstalledVersion}`;
          } else { versionEl.textContent = 'Installed'; }
        } catch (e) { versionEl.textContent = 'Installed'; }
      } else { versionEl.textContent = 'Installed'; }
      statusEl.className = 'status success';
      statusEl.textContent = 'Installed';
      if (installBtn) installBtn.classList.add('hidden');
      if (checkBtn) checkBtn.classList.remove('hidden');
    } else {
      statusEl.className = 'status warning'; statusEl.textContent = 'Not installed';
      if (installBtn) { installBtn.classList.remove('hidden'); installBtn.textContent = 'Install'; }
      if (checkBtn) checkBtn.classList.add('hidden');
      versionEl.textContent = '—';
    }
  } catch (err) {
    statusEl.className = 'status warning'; statusEl.textContent = 'Not installed';
    if (installBtn) { installBtn.classList.remove('hidden'); installBtn.textContent = 'Install'; }
    if (checkBtn) checkBtn.classList.add('hidden');
    versionEl.textContent = '—';
  }

  const autoCheck = _stgSettings['pocketCli.autoCheck'] !== 'false';
  if (autoCheck && _stgPocketCliInstalledVersion) stgCheckPocketCliUpdates();
}

async function stgCheckPocketCliUpdates() {
  const statusEl = document.getElementById('pocket-cli-status');
  const checkBtn = document.getElementById('pocket-cli-check-btn');
  const updateBtn = document.getElementById('pocket-cli-update-btn');
  const installBtn = document.getElementById('pocket-cli-install-btn');
  const infoBox = document.getElementById('pocket-cli-info');
  const infoText = document.getElementById('pocket-cli-info-text');
  if (!statusEl || !checkBtn) return;

  checkBtn.disabled = true; checkBtn.textContent = 'Checking...';
  statusEl.className = 'status info'; statusEl.textContent = 'Checking...';
  try {
    const latestJson = await window.pocketAgent.shell.runCommand(_stgCliCommands.fetchLatest);
    if (latestJson) {
      const release = JSON.parse(latestJson);
      const latestVersion = (release.tag_name || '').replace(/^v/, '');
      if (!_stgPocketCliInstalledVersion) {
        statusEl.className = 'status warning'; statusEl.textContent = 'Not installed';
        if (installBtn) { installBtn.classList.remove('hidden'); installBtn.textContent = 'Install'; }
        if (checkBtn) checkBtn.classList.add('hidden');
      } else if (latestVersion && latestVersion !== _stgPocketCliInstalledVersion) {
        statusEl.className = 'status info'; statusEl.textContent = 'Update available';
        if (updateBtn) { updateBtn.classList.remove('hidden'); updateBtn.textContent = `Update to v${latestVersion}`; }
        if (infoBox) infoBox.classList.remove('hidden');
        if (infoText) infoText.textContent = `v${latestVersion} is available. You are on v${_stgPocketCliInstalledVersion}.`;
      } else {
        statusEl.className = 'status success'; statusEl.textContent = 'Up to date';
        if (updateBtn) updateBtn.classList.add('hidden');
        if (infoBox) infoBox.classList.add('hidden');
      }
    }
  } catch (e) { statusEl.className = 'status warning'; statusEl.textContent = 'Unable to check'; }
  finally { checkBtn.disabled = false; checkBtn.textContent = 'Check Now'; }
}

async function stgInstallPocketCli() {
  const statusEl = document.getElementById('pocket-cli-status');
  const installBtn = document.getElementById('pocket-cli-install-btn');
  try {
    installBtn.disabled = true; installBtn.textContent = 'Installing...';
    statusEl.className = 'status info'; statusEl.textContent = 'Installing...';
    await window.pocketAgent.shell.runCommand(_stgCliCommands.install);
    await _stgInitPocketCli();
    if (document.getElementById('pocket-cli-status').classList.contains('success')) {
      _stgShowToast('Pocket CLI installed successfully!' + (_STG_CLI_IS_WINDOWS ? ' Restart your terminal to use it.' : ''), 'success');
    }
  } catch (err) {
    statusEl.className = 'status error'; statusEl.textContent = 'Install failed';
    _stgShowToast('Failed to install Pocket CLI: ' + err.message, 'error');
  } finally { installBtn.disabled = false; await _stgInitPocketCli(); }
}

async function stgUpdatePocketCli() {
  const statusEl = document.getElementById('pocket-cli-status');
  const updateBtn = document.getElementById('pocket-cli-update-btn');
  const infoBox = document.getElementById('pocket-cli-info');
  const infoText = document.getElementById('pocket-cli-info-text');
  try {
    updateBtn.disabled = true; updateBtn.textContent = 'Updating...';
    statusEl.className = 'status info'; statusEl.textContent = 'Updating...';
    if (infoBox) infoBox.classList.remove('hidden');
    if (infoText) infoText.textContent = 'Downloading and installing latest version...';
    await window.pocketAgent.shell.runCommand(_stgCliCommands.install);
    await _stgInitPocketCli();
    if (document.getElementById('pocket-cli-status').classList.contains('success')) {
      _stgShowToast('Pocket CLI updated successfully!', 'success');
    }
  } catch (err) {
    statusEl.className = 'status error'; statusEl.textContent = 'Update failed';
    _stgShowToast('Failed to update Pocket CLI: ' + err.message, 'error');
  } finally { updateBtn.disabled = false; await _stgInitPocketCli(); }
}

// ---- Browser ----

async function _stgInitializeBrowserSection() {
  const selector = document.getElementById('browser-selector');
  const statusEl = document.getElementById('browser-status');
  if (!selector || !statusEl) return;
  try {
    const browsers = await window.pocketAgent.browser.detectInstalled();
    selector.innerHTML = '<option value="">Select browser...</option>';
    browsers.forEach(browser => {
      const option = document.createElement('option');
      option.value = browser.id;
      option.textContent = browser.name;
      selector.appendChild(option);
    });
    if (browsers.length === 1) selector.value = browsers[0].id;
    await stgTestBrowserConnection();
  } catch (err) {
    console.error('[Settings] Failed to initialize browser section:', err);
    statusEl.className = 'status error'; statusEl.textContent = 'Error loading';
  }
}

async function stgLaunchBrowserWithCdp() {
  const selector = document.getElementById('browser-selector');
  const statusEl = document.getElementById('browser-status');
  const launchBtn = document.getElementById('browser-launch-btn');
  const portInput = document.getElementById('browser-port');
  const browserId = selector.value;
  if (!browserId) { _stgShowToast('Please select a browser first', 'error'); return; }
  const port = parseInt(portInput.value) || 9222;
  launchBtn.disabled = true; launchBtn.textContent = 'Launching...';
  statusEl.className = 'status info'; statusEl.textContent = 'Launching...';
  try {
    const result = await window.pocketAgent.browser.launch(browserId, port);
    if (result.success) {
      statusEl.className = 'status success'; statusEl.textContent = 'Connected';
      _stgShowToast('Browser launched with remote debugging enabled!', 'success');
      const cdpInput = document.getElementById('browser.cdpUrl');
      cdpInput.value = `http://localhost:${port}`;
      await window.pocketAgent.settings.set('browser.cdpUrl', cdpInput.value);
    } else if (result.alreadyRunning) {
      statusEl.className = 'status warning'; statusEl.textContent = 'Browser running';
      _stgShowToast(result.error, 'error');
    } else {
      statusEl.className = 'status error'; statusEl.textContent = 'Launch failed';
      _stgShowToast(result.error || 'Failed to launch browser', 'error');
    }
  } catch (err) {
    statusEl.className = 'status error'; statusEl.textContent = 'Error';
    _stgShowToast('Error: ' + err.message, 'error');
  } finally { launchBtn.disabled = false; launchBtn.textContent = 'Launch Browser'; }
}

async function stgTestBrowserConnection() {
  const statusEl = document.getElementById('browser-status');
  const testBtn = document.getElementById('browser-test-btn');
  const cdpInput = document.getElementById('browser.cdpUrl');
  if (!statusEl || !testBtn) return;
  const cdpUrl = cdpInput ? (cdpInput.value || 'http://localhost:9222') : 'http://localhost:9222';
  testBtn.disabled = true; testBtn.textContent = 'Testing...';
  statusEl.className = 'status info'; statusEl.textContent = 'Testing...';
  try {
    const result = await window.pocketAgent.browser.testConnection(cdpUrl);
    if (result.connected) {
      statusEl.className = 'status success'; statusEl.textContent = 'Connected';
      if (result.browserInfo && result.browserInfo.Browser) {
        statusEl.textContent = `Connected (${result.browserInfo.Browser.split('/')[0]})`;
      }
    } else { statusEl.className = 'status error'; statusEl.textContent = 'Not connected'; }
  } catch (err) { statusEl.className = 'status error'; statusEl.textContent = 'Error'; }
  finally { testBtn.disabled = false; testBtn.textContent = 'Test Connection'; }
}

// ---- Updates ----

function _stgInitializeUpdates() {
  if (_stgUpdateStatusCleanup) _stgUpdateStatusCleanup();
  if (window.pocketAgent?.updater?.onStatus) {
    _stgUpdateStatusCleanup = window.pocketAgent.updater.onStatus(_stgHandleUpdateStatus);
  }
  if (window.pocketAgent?.updater?.getStatus) {
    window.pocketAgent.updater.getStatus().then(_stgHandleUpdateStatus).catch(() => {});
  }
}

function _stgHandleUpdateStatus(status) {
  const statusEl = document.getElementById('update-status');
  const progressRow = document.getElementById('update-progress-row');
  const progressBar = document.getElementById('update-progress-bar');
  const progressText = document.getElementById('update-progress-text');
  const checkBtn = document.getElementById('check-updates-btn');
  const downloadBtn = document.getElementById('download-update-btn');
  const installBtn = document.getElementById('install-update-btn');
  const infoBox = document.getElementById('update-info');
  const infoText = document.getElementById('update-info-text');
  if (!statusEl || !checkBtn) return;

  if (progressRow) progressRow.classList.add('hidden');
  if (downloadBtn) downloadBtn.classList.add('hidden');
  if (installBtn) installBtn.classList.add('hidden');
  if (infoBox) infoBox.classList.add('hidden');
  checkBtn.disabled = false; checkBtn.textContent = 'Check Now';

  switch (status.status) {
    case 'idle': statusEl.className = 'status info'; statusEl.textContent = 'Ready'; break;
    case 'dev-mode':
      statusEl.className = 'status warning'; statusEl.textContent = 'Dev mode';
      checkBtn.disabled = true; checkBtn.textContent = 'Dev mode';
      if (infoBox) infoBox.classList.remove('hidden');
      if (infoText) infoText.textContent = 'Auto-updates only work in the packaged app.';
      break;
    case 'checking': statusEl.className = 'status info'; statusEl.textContent = 'Checking...'; checkBtn.disabled = true; checkBtn.textContent = 'Checking...'; break;
    case 'available':
      statusEl.className = 'status success'; statusEl.textContent = 'Update available!';
      if (downloadBtn) downloadBtn.classList.remove('hidden');
      if (infoBox) infoBox.classList.remove('hidden');
      if (infoText) infoText.textContent = `Version ${status.info?.version || 'unknown'} is available for download.`;
      break;
    case 'not-available':
      statusEl.className = 'status success'; statusEl.textContent = 'Up to date';
      if (status.error && infoBox && infoText) { infoBox.classList.remove('hidden'); infoText.textContent = status.error; }
      break;
    case 'downloading':
      statusEl.className = 'status info'; statusEl.textContent = 'Downloading...';
      if (progressRow) progressRow.classList.remove('hidden');
      const percent = status.progress?.percent || 0;
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `${Math.round(percent)}%`;
      checkBtn.disabled = true;
      break;
    case 'downloaded':
      statusEl.className = 'status success'; statusEl.textContent = 'Ready to install';
      if (installBtn) installBtn.classList.remove('hidden');
      if (infoBox) infoBox.classList.remove('hidden');
      if (infoText) infoText.textContent = `Version ${status.info?.version || 'unknown'} is ready to install. Click "Install & Restart" to update.`;
      break;
    case 'error':
      statusEl.className = 'status error'; statusEl.textContent = 'Error';
      if (infoBox) infoBox.classList.remove('hidden');
      if (infoText) infoText.textContent = status.error || 'An error occurred while checking for updates.';
      break;
  }
}

async function stgCheckForUpdates() {
  const btn = document.getElementById('check-updates-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  try { await window.pocketAgent.updater.checkForUpdates(); }
  catch (err) { _stgShowToast('Failed to check for updates: ' + err.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Check Now'; } }
}

async function stgDownloadUpdate() {
  const btn = document.getElementById('download-update-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
  try { const result = await window.pocketAgent.updater.download(); if (!result.success) _stgShowToast(result.error || 'Download failed', 'error'); }
  catch (err) { _stgShowToast('Failed to download update: ' + err.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Download'; }
}

async function stgInstallUpdate() {
  const btn = document.getElementById('install-update-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Installing...'; }
  try { await window.pocketAgent.updater.install(); }
  catch (err) { _stgShowToast('Failed to install update: ' + err.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Install & Restart'; } }
}

// ---- Skin Picker ----

const _STG_SKIN_DESCRIPTIONS = {
  dracula: 'Classic Dracula', light: 'Clean & minimal', dawn: 'Rosé Pine Dawn',
  midnight: 'GitHub dark', nord: 'Scandinavian frost',
  mocha: 'Catppuccin Mocha', rosepine: 'Rosé Pine', gruvbox: 'Retro warm',
  solarized: 'Solarized Dark', onedark: 'Atom One Dark',
};

const _STG_SKIN_PREVIEWS = {
  dracula:   ['#282a36', '#21222c', '#bd93f9', '#ff79c6', '#f8f8f2'],
  light:     ['#ffffff', '#f9f9f9', '#007aff', '#5856d6', '#1c1c1e'],
  dawn:      ['#faf4ed', '#fffaf3', '#907aa9', '#56949f', '#575279'],
  midnight:  ['#0d1117', '#161b22', '#58a6ff', '#79c0ff', '#e6edf3'],
  nord:      ['#2e3440', '#3b4252', '#88c0d0', '#5e81ac', '#eceff4'],
  mocha:     ['#1e1e2e', '#181825', '#89b4fa', '#cba6f7', '#cdd6f4'],
  rosepine:  ['#191724', '#1f1d2e', '#c4a7e7', '#9ccfd8', '#e0def4'],
  gruvbox:   ['#282828', '#1d2021', '#fabd2f', '#fe8019', '#ebdbb2'],
  solarized: ['#002b36', '#073642', '#268bd2', '#2aa198', '#fdf6e3'],
  onedark:   ['#282c34', '#21252b', '#61afef', '#c678dd', '#abb2bf'],
};

async function _stgInitSkinPicker() {
  try {
    _stgThemesCache = await window.pocketAgent.themes.list();
    _stgCurrentSkinId = await window.pocketAgent.themes.getSkin();
    _stgRenderSkinGrid();
    window.pocketAgent.themes.onSkinChanged((skinId) => {
      _stgCurrentSkinId = skinId;
      _stgRenderSkinGrid();
      _stgApplyTheme(skinId);
    });
  } catch (err) { console.error('[Settings] Failed to init skin picker:', err); }
}

function _stgRenderSkinGrid() {
  const grid = document.getElementById('skin-grid');
  if (!grid || !_stgThemesCache) return;
  grid.innerHTML = '';
  for (const [id, theme] of Object.entries(_stgThemesCache)) {
    const card = document.createElement('div');
    card.className = 'skin-card' + (id === _stgCurrentSkinId ? ' active' : '');
    const colors = _STG_SKIN_PREVIEWS[id] || _STG_SKIN_PREVIEWS.default;
    card.innerHTML = `
      <div class="skin-preview">
        <div class="swatch" style="background:${colors[0]}"></div>
        <div class="swatch" style="background:${colors[1]}"></div>
        <div class="swatch" style="background:${colors[2]}"></div>
        <div class="swatch" style="background:${colors[3]}"></div>
        <div class="swatch" style="background:${colors[4]}"></div>
      </div>
      <div class="skin-name">${theme.name}</div>
      <div class="skin-desc">${_STG_SKIN_DESCRIPTIONS[id] || ''}</div>
    `;
    card.addEventListener('click', () => _stgSelectSkin(id));
    grid.appendChild(card);
  }
}

async function _stgSelectSkin(skinId) {
  if (skinId === _stgCurrentSkinId) return;
  _stgCurrentSkinId = skinId;
  _stgRenderSkinGrid();
  _stgApplyTheme(skinId);
  await window.pocketAgent.settings.set('ui.skin', skinId);
}

function _stgApplyTheme(skinId) {
  if (!_stgThemesCache) return;
  const theme = _stgThemesCache[skinId];
  const root = document.documentElement;
  if (!theme || !theme.palette) {
    const props = ['bg-primary','bg-secondary','bg-tertiary','border','text-primary','text-secondary','text-muted','accent','accent-secondary','accent-hover','error','success','warning','orange','user-bubble','user-bubble-solid','assistant-bubble'];
    for (const p of props) root.style.removeProperty('--' + p);
    return;
  }
  for (const [key, value] of Object.entries(theme.palette)) {
    root.style.setProperty('--' + key, value);
  }
}

// ─── Agent Home ─────────────────────────────────────────────────────

async function stgToggleAgentHome() {
  const currentValue = _stgSettings['agentHome.enabled'] === 'true';
  const newValue = !currentValue;
  try {
    await window.pocketAgent.settings.set('agentHome.enabled', newValue.toString());
    _stgSettings['agentHome.enabled'] = newValue.toString();
    _stgUpdateToggles();
    const result = await window.pocketAgent.agentHome.toggle(newValue);
    if (result.success) {
      _stgShowToast(newValue ? 'Agent Home connected!' : 'Agent Home disconnected', 'success');
      if (newValue) setTimeout(() => _stgInitAgentHome(), 500);
    } else {
      _stgShowToast('Failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    console.error('[Settings] Failed to toggle Agent Home:', err);
    _stgShowToast('Failed to toggle Agent Home', 'error');
  }
}

async function _stgInitAgentHome() {
  await stgTestAgentHome();
}

async function stgSaveAgentHomeSetting(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  try {
    await window.pocketAgent.settings.set(inputId, input.value);
    _stgSettings[inputId] = input.value;
    _stgShowToast('Saved!', 'success');

    if (inputId === 'agentHome.token') {
      if (input.value) {
        // Auto-connect when token is saved and non-empty
        if (_stgSettings['agentHome.enabled'] !== 'true') {
          await window.pocketAgent.settings.set('agentHome.enabled', 'true');
          _stgSettings['agentHome.enabled'] = 'true';
          _stgUpdateToggles();
        }
        await window.pocketAgent.agentHome.toggle(false);
        const result = await window.pocketAgent.agentHome.toggle(true);
        if (result.success) {
          _stgShowToast('Agent Home connected!', 'success');
          setTimeout(() => stgTestAgentHome(), 1000);
        } else {
          _stgShowToast('Failed to connect: ' + (result.error || 'Unknown error'), 'error');
        }
      } else {
        // Token cleared — disconnect and disable
        await window.pocketAgent.agentHome.toggle(false);
        await window.pocketAgent.settings.set('agentHome.enabled', 'false');
        _stgSettings['agentHome.enabled'] = 'false';
        _stgUpdateToggles();
        _stgShowToast('Agent Home disconnected', 'success');
        stgTestAgentHome();
      }
    }
  } catch (err) {
    console.error('[Settings] Failed to save Agent Home setting:', err);
    _stgShowToast('Failed to save', 'error');
  }
}

async function stgTestAgentHome() {
  const statusEl = document.getElementById('agent-home-status');
  if (!statusEl) return;
  try {
    const status = await window.pocketAgent.agentHome.getStatus();
    statusEl.className = 'auth-badge';
    if (status.connected) {
      statusEl.classList.add('oauth');
      statusEl.textContent = 'Connected';
    } else {
      statusEl.classList.add('none');
      statusEl.textContent = 'Disconnected';
    }
  } catch {
    statusEl.className = 'auth-badge none';
    statusEl.textContent = 'Error';
  }
}

// Listen for open-settings from main process (tray menu, etc.)
if (window.pocketAgent?.app?.onOpenSettings) {
  window.pocketAgent.app.onOpenSettings((tab) => {
    showSettingsPanel(tab);
  });
}
