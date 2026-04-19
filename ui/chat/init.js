/**
 * Full chat initialization — runs either immediately on load (no onboarding)
 * or after onboarding completes (called by obFinishSetup).
 */
async function initializeChat() {
  // Load current model
  await updateModelBadge();

  // Refresh model badge when window gains focus (in case user changed it in settings)
  window.addEventListener('focus', updateModelBadge);

  // Only pause animations when the window is actually hidden (minimized/
  // occluded). Do NOT pause on blur — a blurred-but-visible window (multi-monitor,
  // user glancing back before refocusing) would freeze entrance animations,
  // leaving newly sent user messages stuck at opacity: 0.
  //
  // Do NOT reload history on visibility restore: loadHistory wipes #messages
  // and re-renders from DB. If a send/stream is in flight when the user
  // minimizes, the in-DOM user bubble or streaming reply may not yet be
  // persisted — the reload would erase them. Push events (scheduler, Telegram,
  // iOS) keep the UI in sync without a reload.
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('animations-paused', document.hidden);
  });


  // Load user/agent profile for placeholder and empty state
  await loadUserProfile();

  // Refresh profile when window regains focus (in case user changed it in Personalize)
  window.addEventListener('focus', loadUserProfile);

  // Load sessions first (sets currentSessionId), then init mode for correct session
  await loadSessions();
  await initAgentMode();
  ensureStatusListener(currentSessionId);
  await loadHistory();
  updateStats();
  input.focus();

  // Initialize notification sound
  initNotificationSound();

  // Connect to global chat server (stay online while app is open)
  await getOrCreateChatUsername();
  connectChatWs();

  // Listen for chat username changes from settings window
  window.pocketAgent.chat.onUsernameChanged((newUsername) => {
    console.log('[Chat] Username changed via settings:', newUsername);
    globalChatUsername = newUsername;
    // Clear any pending reconnect timer and reconnect with new username
    clearTimeout(chatWsReconnectTimer);
    if (chatWs) {
      chatWs.onclose = null; // Prevent auto-reconnect with old handler
      chatWs.close();
      chatWs = null;
    }
    connectChatWs();
    // Update header badge if in chat mode
    if (globalChatMode) updateHeaderTierBadge();
  });

  // Listen for cron test run start (insert user message bubble before execution)
  window.pocketAgent.events.onCronTesting((data) => {
    handleCronTestingStart(data);
  });

  // Listen for scheduler messages
  window.pocketAgent.events.onSchedulerMessage((data) => {
    console.log('[Chat] Received scheduler message:', data.jobName, 'sessionId:', data.sessionId, 'currentSession:', currentSessionId);
    handleSchedulerMessage(data);
  });

  // Listen for Telegram messages (cross-channel sync)
  window.pocketAgent.events.onTelegramMessage((data) => {
    handleTelegramMessage(data);
  });

  // Listen for iOS messages (cross-channel sync)
  window.pocketAgent.events.onIOSMessage((data) => {
    console.log('[Chat] Received iOS message:', data);
    handleIOSMessage(data);
  });

  // Listen for session clears from iOS
  window.pocketAgent.sessions.onCleared((sessionId) => {
    console.log('[Chat] Session cleared from iOS:', sessionId);
    if (sessionId === currentSessionId) {
      disableAutoAnimate(); messagesDiv.innerHTML = ''; enableAutoAnimate();
      showEmptyState();
      updateStats();
    }
  });

  // Listen for session changes (e.g., Telegram link/unlink)
  window.pocketAgent.sessions.onChanged(() => {
    console.log('[Chat] Sessions changed, reloading...');
    loadSessions();
  });

  // Listen for model changes (e.g., changed via Telegram)
  window.pocketAgent.events.onModelChanged((model) => {
    console.log('[Chat] Model changed to:', model);
    updateModelBadge();
  });
}

/**
 * Called by onboarding.js after setup completes and the transition animation finishes.
 */
// eslint-disable-next-line no-unused-vars
async function initializeChatAfterOnboarding() {
  await initializeChat();
}

window.addEventListener('DOMContentLoaded', async () => {
  // Show app version in titlebar
  try {
    const version = await window.pocketAgent.app.getVersion();
    document.title = `Pocket Agent v${version}`;
  } catch (err) {
    console.error('Failed to load app version:', err);
  }

  // Check if onboarding is needed
  const onboardingActive = await checkAndShowOnboarding();

  // Now that we know the state, reveal the UI (prevents sidebar flash)
  document.body.classList.add('app-ready');

  if (onboardingActive) {
    // Onboarding is showing — chat init will happen after it completes
    return;
  }

  // No onboarding needed — initialize chat immediately
  await initializeChat();
});
