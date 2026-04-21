/**
 * Onboarding flow — embedded in chat.html
 *
 * Checks isFirstRun on load. If true, shows the onboarding wizard
 * inside the main-content container. On completion, animates to
 * reveal the full chat UI.
 */

/* eslint-disable no-unused-vars */
// These functions are called from onclick handlers in the onboarding HTML

let obSelectedAuth = null;
let obKeychainInitialized = false;
let obPermissionsShown = false;
let _obNotyf = null;

function _obToast(msg, type) {
  if (!_obNotyf) _obNotyf = new Notyf({ duration: 3500, position: { x: 'right', y: 'bottom' }, dismissible: true, types: [{ type: 'success', background: '#4ade80' }, { type: 'error', background: '#f87171' }] });
  _obNotyf[type === 'error' ? 'error' : 'success'](msg);
}

/**
 * Check if onboarding is needed and show it if so.
 * Returns true if onboarding is active (caller should defer chat init).
 */
async function checkAndShowOnboarding() {
  try {
    const isFirstRun = await window.pocketAgent.settings.isFirstRun();
    if (!isFirstRun) return false;
  } catch {
    return false;
  }

  // Show onboarding
  document.body.classList.add('onboarding-active');
  const container = document.getElementById('onboarding-container');
  if (container) container.classList.remove('hidden');

  // Apply platform-specific text
  const platform = window.pocketAgent.app.getPlatform();
  const platformText = getPlatformText(platform);
  const infoEl = document.getElementById('ob-keychain-info-text');
  if (infoEl) infoEl.textContent = platformText.storageInfo;

  return true;
}

function getPlatformText(platform) {
  if (platform === 'darwin') {
    return {
      storageInfo: "Pocket Agent uses your Mac's Keychain to securely store API keys. You may be prompted for your Mac password.",
      storageFallback: 'Could not access Keychain. Keys will be stored unencrypted.',
    };
  } else if (platform === 'win32') {
    return {
      storageInfo: 'Pocket Agent uses Windows Credential Store to securely store API keys.',
      storageFallback: 'Could not access Credential Store. Keys will be stored unencrypted.',
    };
  }
  return {
    storageInfo: 'Pocket Agent uses your system keyring to securely store API keys. You may be prompted for your keyring password.',
    storageFallback: 'Could not access system keyring. Keys will be stored unencrypted.',
  };
}

// SVG icons used across onboarding
const OB_ICONS = {
  check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 14.5s1.5 0 3.5 3.5c0 0 5.559-9.167 10.5-11"/></svg>',
  cross: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 6L6 18m12 0L6 6"/></svg>',
  arrow: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 6s6 4.419 6 6s-6 6-6 6"/></svg>',
  lock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10Z"/><path stroke-linecap="round" d="M12 13a2 2 0 1 0 0-4a2 2 0 0 0 0 4Zm0 0v3"/></g></svg>',
  shield: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18.709 3.495C16.817 2.554 14.5 2 12 2s-4.816.554-6.709 1.495c-.928.462-1.392.693-1.841 1.419S3 6.342 3 7.748v3.49c0 5.683 4.542 8.842 7.173 10.196c.734.377 1.1.566 1.827.566s1.093-.189 1.827-.566C16.457 20.08 21 16.92 21 11.237V7.748c0-1.406 0-2.108-.45-2.834s-.913-.957-1.841-1.419"/></svg>',
  refresh: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m15.167 1l.598 1.118c.404.755.606 1.133.472 1.295c-.133.162-.573.031-1.454-.23A9.8 9.8 0 0 0 12 2.78c-5.247 0-9.5 4.128-9.5 9.22a8.97 8.97 0 0 0 1.27 4.61M8.834 23l-.598-1.118c-.404-.756-.606-1.134-.472-1.295c.133-.162.573-.032 1.454.23c.88.261 1.815.402 2.783.402c5.247 0 9.5-4.128 9.5-9.22a8.97 8.97 0 0 0-1.27-4.609"/></svg>',
  signin: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M8 8c0-.575 0-.822.045-1.075A2.98 2.98 0 0 1 9.833 4.7c.24-.1.523-.165 1.09-.294l2.728-.623c3.39-.774 5.084-1.161 6.217-.27C21 4.405 21 6.126 21 9.568v4.864c0 3.442 0 5.164-1.132 6.055c-1.133.891-2.827.504-6.217-.27l-2.728-.623c-.567-.13-.85-.194-1.09-.294a2.98 2.98 0 0 1-1.788-2.225C8 16.822 8 16.575 8 16"/><path d="M13 9s3 2.21 3 3s-3 3-3 3m2.5-3H3"/></g></svg>',
  minus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 12H4"/></svg>',
  info: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" stroke-width="1.5"/><path stroke-width="1.5" d="M12 16v-4.5"/><path stroke-width="1.8" d="M12 8.012v-.01"/></g></svg>',
  chat: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7.5 8.5h9m-9 4H13m-11-2c0-.77.013-1.523.04-2.25c.083-2.373.125-3.56 1.09-4.533c.965-.972 2.186-1.024 4.626-1.129A100 100 0 0 1 12 2.5c1.48 0 2.905.03 4.244.088c2.44.105 3.66.157 4.626 1.13c.965.972 1.007 2.159 1.09 4.532a64 64 0 0 1 0 4.5c-.083 2.373-.125 3.56-1.09 4.533c-.965.972-2.186 1.024-4.626 1.129q-1.102.047-2.275.07c-.74.014-1.111.02-1.437.145s-.6.358-1.148.828l-2.179 1.87A.73.73 0 0 1 8 20.77v-2.348l-.244-.01c-2.44-.105-3.66-.157-4.626-1.13c-.965-.972-1.007-2.159-1.09-4.532A64 64 0 0 1 2 10.5"/></svg>',
};

function obShowStep(stepId) {
  document.querySelectorAll('.ob-step').forEach(s => s.classList.remove('active'));
  const step = document.getElementById(stepId);
  if (step) step.classList.add('active');

  // Reset step states on navigation
  if (stepId === 'ob-step-keychain') {
    const btn = document.getElementById('ob-keychain-btn');
    btn.disabled = false;
    if (obKeychainInitialized) {
      btn.textContent = 'Secured';
    } else {
      btn.textContent = 'Secure My Keys';
    }
  } else if (stepId === 'ob-step-permissions') {
    const btn = document.getElementById('ob-perm-refresh-btn');
    btn.disabled = false;
    btn.innerHTML = OB_ICONS.refresh + ' Refresh';
    obRefreshPermissions();
  } else if (stepId === 'ob-step-auth') {
    document.querySelectorAll('.ob-auth-option').forEach(el => el.classList.remove('selected'));
  } else if (stepId === 'ob-step-oauth') {
    const btn = document.getElementById('ob-oauth-btn');
    btn.disabled = false;
    btn.textContent = 'Sign in';
  } else if (stepId === 'ob-step-oauth-code') {
    document.getElementById('ob-oauth-code').value = '';
    const btn = document.getElementById('ob-oauth-complete-btn');
    btn.disabled = false;
    btn.textContent = 'Continue';
  } else if (stepId === 'ob-step-api') {
    const btn = document.getElementById('ob-api-btn');
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

async function obInitKeychain() {
  const btn = document.getElementById('ob-keychain-btn');

  btn.disabled = true;
  btn.innerHTML = '<span class="ob-spinner"></span> Initializing...';

  try {
    const result = await window.pocketAgent.settings.initializeKeychain();
    if (result.available) {
      obKeychainInitialized = true;
      _obToast('Secure storage enabled!', 'success');
      setTimeout(() => obCheckAndShowPermissions(), 800);
    } else {
      const platform = window.pocketAgent.app.getPlatform();
      _obToast(result.error || getPlatformText(platform).storageFallback, 'error');
      btn.disabled = false;
      btn.textContent = 'Try Again';
    }
  } catch (err) {
    _obToast(err.message || 'Failed to initialize secure storage', 'error');
    btn.disabled = false;
    btn.textContent = 'Try Again';
  }
}

function obSkipKeychain() {
  obCheckAndShowPermissions();
}

async function obCheckAndShowPermissions() {
  try {
    const mac = await window.pocketAgent.permissions.isMacOS();
    if (!mac) {
      obShowStep('ob-step-auth');
      return;
    }
    obPermissionsShown = true;
    obShowStep('ob-step-permissions');
    obRefreshPermissions();
  } catch {
    obShowStep('ob-step-auth');
  }
}

async function obRefreshPermissions() {
  const container = document.getElementById('ob-permissions-list');
  const btn = document.getElementById('ob-perm-refresh-btn');

  btn.disabled = true;
  btn.innerHTML = '<span class="ob-spinner"></span> Checking...';

  try {
    const statuses = await window.pocketAgent.permissions.check([
      'full-disk-access',
      'accessibility',
      'screen-recording',
    ]);
    container.innerHTML = statuses.map(s => {
      const iconClass = s.granted ? 'granted' : 'missing';
      const iconSvg = s.granted ? OB_ICONS.check : OB_ICONS.minus;
      const hint = (!s.granted && s.type === 'full-disk-access')
        ? '<p style="color: var(--text-muted); margin-top: 2px;">may show as missing even when granted. this is normal.</p>'
        : '';
      const actionHtml = s.granted
        ? ''
        : `<div class="ob-perm-action"><button class="ob-btn secondary" onclick="obOpenPermSettings('${s.type}')">Open Settings</button></div>`;
      return `
        <div class="ob-perm-item">
          <div class="ob-perm-icon ${iconClass}">${iconSvg}</div>
          <div class="ob-perm-text">
            <h4>${s.label}</h4>
            <p>${s.description}</p>
            ${hint}
          </div>
          ${actionHtml}
        </div>
      `;
    }).join('');
  } catch {
    container.innerHTML = `<div class="ob-status error">${OB_ICONS.cross} <span>Could not check permissions</span></div>`;
  }

  btn.disabled = false;
  btn.innerHTML = OB_ICONS.refresh + ' Refresh';
}

async function obOpenPermSettings(type) {
  try {
    await window.pocketAgent.permissions.openSettings(type);
  } catch (err) {
    console.error('Failed to open permission settings:', err);
  }
}

function obGoBackFromAuth() {
  if (obPermissionsShown) {
    obShowStep('ob-step-permissions');
  } else {
    obShowStep('ob-step-keychain');
  }
}

function obSelectAuth(method, el) {
  obSelectedAuth = method;
  document.querySelectorAll('.ob-auth-option').forEach(opt => opt.classList.remove('selected'));
  el.classList.add('selected');

  setTimeout(() => {
    if (method === 'oauth') {
      obShowStep('ob-step-oauth');
    } else {
      obShowStep('ob-step-api');
      document.getElementById('ob-anthropic-key').focus();
    }
  }, 200);
}

function obToggleOptional(header) {
  const content = header.nextElementSibling;
  header.classList.toggle('expanded');
  content.classList.toggle('show');
}

async function obStartOAuth() {
  const btn = document.getElementById('ob-oauth-btn');

  btn.disabled = true;
  btn.innerHTML = '<span class="ob-spinner"></span> Opening browser...';

  try {
    const result = await window.pocketAgent.auth.startOAuth();
    if (result.success) {
      obShowStep('ob-step-oauth-code');
      document.getElementById('ob-oauth-code').focus();
    } else {
      _obToast(result.error || 'Failed to open browser. Please try again.', 'error');
    }
  } catch (err) {
    _obToast(err.message || 'Connection failed', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Sign in';
}

async function obCompleteOAuth() {
  const code = document.getElementById('ob-oauth-code').value.trim();
  const btn = document.getElementById('ob-oauth-complete-btn');

  if (!code) {
    _obToast('Please paste the authorization code from your browser', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="ob-spinner"></span> Verifying...';

  try {
    const result = await window.pocketAgent.auth.completeOAuth(code);
    if (result.success) {
      // Save optional keys
      const kimiKey = document.getElementById('ob-kimi-key-oauth').value.trim();
      if (kimiKey) await window.pocketAgent.settings.set('moonshot.apiKey', kimiKey);
      const glmKey = document.getElementById('ob-glm-key-oauth').value.trim();
      if (glmKey) await window.pocketAgent.settings.set('glm.apiKey', glmKey);
      obShowStep('ob-step-name');
    } else {
      _obToast(result.error || 'Invalid code. Please try again.', 'error');
    }
  } catch (err) {
    _obToast(err.message || 'Verification failed', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Continue';
}

async function obCancelOAuth() {
  try {
    await window.pocketAgent.auth.cancelOAuth();
  } catch (err) {
    console.error('Failed to cancel OAuth:', err);
  }
  document.getElementById('ob-oauth-code').value = '';
  obShowStep('ob-step-auth');
}

async function obValidateAndSave() {
  const anthropicKey = document.getElementById('ob-anthropic-key').value.trim();
  const kimiKey = document.getElementById('ob-kimi-key-api').value.trim();
  const glmKey = document.getElementById('ob-glm-key-api').value.trim();
  const btn = document.getElementById('ob-api-btn');

  if (!anthropicKey && !kimiKey && !glmKey) {
    _obToast('Please enter at least one API key', 'error');
    return;
  }

  if (anthropicKey && !/^sk-ant-[A-Za-z0-9_-]{90,}$/.test(anthropicKey)) {
    _obToast('Anthropic keys start with "sk-ant-"', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="ob-spinner"></span> Validating...';

  try {
    if (anthropicKey) {
      const result = await window.pocketAgent.validate.anthropicKey(anthropicKey);
      if (!result.valid) {
        _obToast(result.error || 'Invalid Anthropic API key', 'error');
        btn.disabled = false;
        btn.textContent = 'Continue';
        return;
      }
    }

    await window.pocketAgent.settings.set('auth.method', 'api_key');
    if (anthropicKey) await window.pocketAgent.settings.set('anthropic.apiKey', anthropicKey);
    if (kimiKey) await window.pocketAgent.settings.set('moonshot.apiKey', kimiKey);
    if (glmKey) await window.pocketAgent.settings.set('glm.apiKey', glmKey);

    // Auto-select matching model if default doesn't match available keys
    const currentModel = await window.pocketAgent.settings.get('agent.model');
    const isAnthropicModel = !currentModel || currentModel.startsWith('claude-');
    if (isAnthropicModel && !anthropicKey) {
      if (kimiKey) {
        await window.pocketAgent.settings.set('agent.model', 'kimi-k2.6');
      } else if (glmKey) {
        await window.pocketAgent.settings.set('agent.model', 'glm-4.7');
      }
    }

    obShowStep('ob-step-name');
  } catch (err) {
    _obToast(err.message || 'Validation failed', 'error');
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}

async function obFinishSetup() {
  const btn = document.querySelector('#ob-step-success .ob-btn.primary');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="ob-spinner"></span> Setting up...';
  }

  try {
    // Mark onboarding as completed
    await window.pocketAgent.settings.set('onboarding.completed', 'true');
    // Restart agent with new settings
    await window.pocketAgent.agent.restart();
  } catch (err) {
    console.error('Failed to finish setup:', err);
  }

  // Animate transition: hide onboarding, reveal chat
  const container = document.getElementById('onboarding-container');
  container.classList.add('hiding');

  // After fade out, remove onboarding and reveal chat
  setTimeout(() => {
    document.body.classList.remove('onboarding-active');
    container.remove();

    // Now run the normal chat initialization
    if (typeof initializeChatAfterOnboarding === 'function') {
      initializeChatAfterOnboarding();
    }
  }, 500);
}

// ---- Progress indicator ----

const OB_STEP_ORDER = [
  'ob-step-welcome', 'ob-step-keychain', 'ob-step-permissions', 'ob-step-auth',
  'ob-step-oauth', 'ob-step-oauth-code', 'ob-step-api',
  'ob-step-name', 'ob-step-location', 'ob-step-occupation',
  'ob-step-birthday', 'ob-step-agent-name',
  'ob-step-goals', 'ob-step-struggles', 'ob-step-funfacts',
  'ob-step-cli', 'ob-step-success',
];

// Nav config: stepId → { back: stepId|fn|null, skip: stepId|fn|null }
const OB_NAV_CONFIG = {
  'ob-step-welcome': { back: null, skip: null },
  'ob-step-keychain': { back: null, skip: () => obSkipKeychain() },
  'ob-step-permissions': { back: 'ob-step-keychain', skip: 'ob-step-auth' },
  'ob-step-auth': { back: () => obGoBackFromAuth(), skip: null },
  'ob-step-oauth': { back: 'ob-step-auth', skip: null },
  'ob-step-oauth-code': { back: () => obCancelOAuth(), skip: null },
  'ob-step-api': { back: 'ob-step-auth', skip: null },
  'ob-step-name': { back: null, skip: 'ob-step-location' },
  'ob-step-location': { back: 'ob-step-name', skip: 'ob-step-occupation' },
  'ob-step-occupation': { back: 'ob-step-location', skip: 'ob-step-birthday' },
  'ob-step-birthday': { back: 'ob-step-occupation', skip: 'ob-step-agent-name' },
  'ob-step-agent-name': { back: 'ob-step-birthday', skip: 'ob-step-personality' },
  'ob-step-personality': { back: 'ob-step-agent-name', skip: 'ob-step-goals' },
  'ob-step-goals': { back: 'ob-step-personality', skip: 'ob-step-struggles' },
  'ob-step-struggles': { back: 'ob-step-goals', skip: 'ob-step-funfacts' },
  'ob-step-funfacts': { back: 'ob-step-struggles', skip: 'ob-step-cli' },
  'ob-step-cli': { back: 'ob-step-funfacts', skip: 'ob-step-success' },
  'ob-step-success': { back: null, skip: null },
};

function obUpdateUI(stepId) {
  // Show logo/title only on welcome step
  const isWelcome = stepId === 'ob-step-welcome';
  const logo = document.querySelector('.onboarding-container .ob-logo');
  const h1 = document.querySelector('.onboarding-container h1');
  const subtitle = document.querySelector('.onboarding-container .ob-subtitle');
  if (logo) logo.style.display = isWelcome ? '' : 'none';
  if (h1) h1.style.display = isWelcome ? '' : 'none';
  if (subtitle) subtitle.style.display = isWelcome ? '' : 'none';

  // Update progress bar
  const fill = document.getElementById('ob-progress-fill');
  const idx = OB_STEP_ORDER.indexOf(stepId);
  const total = OB_STEP_ORDER.length - 1; // -1 so success = 100%
  if (fill) fill.style.width = total > 0 ? `${(idx / total) * 100}%` : '0%';

  // Update top nav back/skip
  const nav = OB_NAV_CONFIG[stepId] || { back: null, skip: null };
  const backEl = document.getElementById('ob-nav-back');
  const skipEl = document.getElementById('ob-nav-skip');

  if (backEl) {
    if (nav.back) {
      backEl.classList.remove('hidden');
      backEl.onclick = typeof nav.back === 'function' ? nav.back : () => obShowStep(nav.back);
    } else {
      backEl.classList.add('hidden');
      backEl.onclick = null;
    }
  }

  if (skipEl) {
    if (nav.skip) {
      skipEl.classList.remove('hidden');
      skipEl.onclick = typeof nav.skip === 'function' ? nav.skip : () => obShowStep(nav.skip);
    } else {
      skipEl.classList.add('hidden');
      skipEl.onclick = null;
    }
  }
}

// Patch obShowStep to include progress + nav update
const _obShowStepOriginal = obShowStep;
// eslint-disable-next-line no-func-assign
obShowStep = function(stepId) {
  _obShowStepOriginal(stepId);
  obUpdateUI(stepId);

  // Auto-focus text inputs on personalization steps
  const focusMap = {
    'ob-step-name': 'ob-name-input',
    'ob-step-location': 'ob-location-input',
    'ob-step-occupation': 'ob-occupation-input',
    'ob-step-agent-name': 'ob-agent-name-input',
  };
  if (focusMap[stepId]) {
    setTimeout(() => {
      const el = document.getElementById(focusMap[stepId]);
      if (el) el.focus();
    }, 100);
  }
};

// ---- Personalization save functions ----

async function obSaveName() {
  const value = document.getElementById('ob-name-input').value.trim();
  if (value) await window.pocketAgent.settings.set('profile.name', value);
  obShowStep('ob-step-location');
}

async function obSaveLocation() {
  const value = document.getElementById('ob-location-input').value.trim();
  const timezone = document.getElementById('ob-timezone-value').value;
  if (value) await window.pocketAgent.settings.set('profile.location', value);
  if (timezone) await window.pocketAgent.settings.set('profile.timezone', timezone);
  obShowStep('ob-step-occupation');
}

async function obSaveOccupation() {
  const value = document.getElementById('ob-occupation-input').value.trim();
  if (value) await window.pocketAgent.settings.set('profile.occupation', value);
  obShowStep('ob-step-birthday');
}

async function obSaveBirthday() {
  const month = document.getElementById('ob-birthday-month').value;
  const day = document.getElementById('ob-birthday-day').value;
  if (month && day) await window.pocketAgent.settings.set('profile.birthday', `${month} ${day}`);
  obShowStep('ob-step-agent-name');
}

async function obSaveAgentName() {
  const value = document.getElementById('ob-agent-name-input').value.trim();
  if (value) await window.pocketAgent.settings.set('personalize.agentName', value);
  obShowStep('ob-step-goals');
}

async function obSaveGoals() {
  const value = document.getElementById('ob-goals-input').value.trim();
  if (value) await window.pocketAgent.settings.set('personalize.goals', value);
  obShowStep('ob-step-struggles');
}

async function obSaveStruggles() {
  const value = document.getElementById('ob-struggles-input').value.trim();
  if (value) await window.pocketAgent.settings.set('personalize.struggles', value);
  obShowStep('ob-step-funfacts');
}

async function obSaveFunFacts() {
  const value = document.getElementById('ob-funfacts-input').value.trim();
  if (value) await window.pocketAgent.settings.set('personalize.funFacts', value);
  obShowStep('ob-step-cli');
}

function obSkipToSuccess() {
  obShowStep('ob-step-success');
}

// ---- Location autocomplete ----

let _obLocationLookupTimeout = null;

function _obSetupLocationAutocomplete() {
  const input = document.getElementById('ob-location-input');
  const dropdown = document.getElementById('ob-location-dropdown');
  if (!input || !dropdown) return;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    if (_obLocationLookupTimeout) clearTimeout(_obLocationLookupTimeout);
    if (query.length < 2) { dropdown.classList.remove('show'); return; }

    _obLocationLookupTimeout = setTimeout(async () => {
      try {
        const results = await window.pocketAgent.location.lookup(query);
        if (results.length === 0) { dropdown.classList.remove('show'); return; }
        dropdown.innerHTML = results.map(r => `
          <div class="ob-autocomplete-item" data-display="${r.display}" data-timezone="${r.timezone}">
            <div class="city">${r.city}</div>
            <div class="details">${r.province ? r.province + ', ' : ''}${r.country} - ${r.timezone}</div>
          </div>
        `).join('');
        dropdown.querySelectorAll('.ob-autocomplete-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value = item.dataset.display;
            document.getElementById('ob-timezone-value').value = item.dataset.timezone;
            dropdown.classList.remove('show');
          });
        });
        dropdown.classList.add('show');
      } catch (e) { console.error('[Onboarding] Error looking up location:', e); }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.classList.remove('show');
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') dropdown.classList.remove('show'); });
}

// ---- Birthday day picker ----

function _obSetupBirthdayPicker() {
  const daySelect = document.getElementById('ob-birthday-day');
  if (!daySelect) return;
  for (let i = 1; i <= 31; i++) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = i;
    daySelect.appendChild(opt);
  }
}

// ---- CLI install ----

const _obCliIsWindows = typeof window.pocketAgent?.app?.getPlatform === 'function' && window.pocketAgent.app.getPlatform() === 'win32';

const _obCliCommands = {
  install: _obCliIsWindows
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

async function obInstallCli() {
  const btn = document.getElementById('ob-cli-install-btn');

  btn.disabled = true;
  btn.innerHTML = '<span class="ob-spinner"></span> Installing...';

  try {
    await window.pocketAgent.shell.runCommand(_obCliCommands.install);
    _obToast('Pocket CLI installed!', 'success');
    btn.innerHTML = OB_ICONS.check + ' Installed';
    setTimeout(() => obShowStep('ob-step-success'), 1500);
  } catch (err) {
    _obToast(err.message || 'Installation failed. You can install later from Settings.', 'error');
    btn.disabled = false;
    btn.innerHTML = 'Retry Install ' + OB_ICONS.arrow;
  }
}

// ---- Enter key handlers & init ----

document.addEventListener('DOMContentLoaded', () => {
  const anthropicInput = document.getElementById('ob-anthropic-key');
  if (anthropicInput) {
    anthropicInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') obValidateAndSave();
    });
  }
  const oauthCodeInput = document.getElementById('ob-oauth-code');
  if (oauthCodeInput) {
    oauthCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') obCompleteOAuth();
    });
  }

  // Enter key for personalization text inputs
  const enterKeyMap = {
    'ob-name-input': obSaveName,
    'ob-occupation-input': obSaveOccupation,
    'ob-agent-name-input': obSaveAgentName,
    'ob-location-input': obSaveLocation,
  };
  Object.entries(enterKeyMap).forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(); });
  });

  // Setup location autocomplete and birthday picker
  _obSetupLocationAutocomplete();
  _obSetupBirthdayPicker();
});
