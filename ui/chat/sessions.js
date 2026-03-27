// ============ SESSION MANAGEMENT ============

async function loadSessions() {
  try {
    sessions = await window.pocketAgent.sessions.list();
    // Restore last selected session from localStorage, or default to first session
    // Must be set BEFORE renderTabs() so the correct tab is highlighted
    if (sessions.length > 0) {
      const savedSessionId = localStorage.getItem('currentSessionId');
      const sessionExists = savedSessionId && sessions.some(s => s.id === savedSessionId);
      currentSessionId = sessionExists ? savedSessionId : sessions[0].id;
      // Save in case we defaulted to first session
      localStorage.setItem('currentSessionId', currentSessionId);
    }
    renderTabs();
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

let draggedTab = null;
let draggedSessionId = null;

function renderTabs() {
  // Clear existing session items
  const existingTabs = tabsContainer.querySelectorAll('.sidebar-session');
  existingTabs.forEach(tab => tab.remove());

  sessions.forEach((session, index) => {
    const tab = document.createElement('div');
    const isActive = session.id === currentSessionId;
    const isLoading = isLoadingBySession.get(session.id);
    tab.className = 'sidebar-session' + (isActive ? ' active' : '') + (isLoading ? ' loading' : '');
    tab.dataset.sessionId = session.id;
    tab.dataset.index = index;
    tab.draggable = true;

    tab.onclick = (e) => {
      if (!e.target.closest('.sidebar-session-close') && !e.target.closest('.tab-name-input')) {
        playNormalClick();
        returnToChatView();
        switchSession(session.id);
      }
    };
    tab.ondblclick = () => startRenameSession(session.id);

    // Drag events (vertical)
    tab.ondragstart = (e) => {
      draggedTab = tab;
      draggedSessionId = session.id;
      setTimeout(() => tab.classList.add('dragging'), 0);
      e.dataTransfer.effectAllowed = 'move';
    };

    tab.ondragend = () => {
      if (draggedTab) {
        draggedTab.classList.remove('dragging');
      }
      draggedTab = null;
      draggedSessionId = null;
    };

    tab.ondragover = (e) => {
      e.preventDefault();
      if (!draggedTab || draggedSessionId === session.id) return;

      const targetTab = tab;
      const rect = targetTab.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (e.clientY < midpoint) {
        if (targetTab.previousElementSibling !== draggedTab) {
          tabsContainer.insertBefore(draggedTab, targetTab);
          updateSessionsOrder();
        }
      } else {
        if (targetTab.nextElementSibling !== draggedTab) {
          tabsContainer.insertBefore(draggedTab, targetTab.nextElementSibling);
          updateSessionsOrder();
        }
      }
    };

    // Chat icon
    const icon = document.createElement('span');
    icon.className = 'sidebar-session-icon';
    icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7.5 8.5h9m-9 4H13m-11-2c0-.77.013-1.523.04-2.25c.083-2.373.125-3.56 1.09-4.533c.965-.972 2.186-1.024 4.626-1.129A100 100 0 0 1 12 2.5c1.48 0 2.905.03 4.244.088c2.44.105 3.66.157 4.626 1.13c.965.972 1.007 2.159 1.09 4.532a64 64 0 0 1 0 4.5c-.083 2.373-.125 3.56-1.09 4.533c-.965.972-2.186 1.024-4.626 1.129q-1.102.047-2.275.07c-.74.014-1.111.02-1.437.145s-.6.358-1.148.828l-2.179 1.87A.73.73 0 0 1 8 20.77v-2.348l-.244-.01c-2.44-.105-3.66-.157-4.626-1.13c-.965-.972-1.007-2.159-1.09-4.532A64 64 0 0 1 2 10.5"/></svg>';
    tab.appendChild(icon);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'sidebar-session-name';
    nameSpan.textContent = session.name;
    tab.appendChild(nameSpan);

    // Show Telegram icon if session is linked to a Telegram group
    if (session.telegram_linked) {
      const telegramIcon = document.createElement('span');
      telegramIcon.className = 'sidebar-session-telegram';
      telegramIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';
      telegramIcon.title = session.telegram_group_name || 'Linked to Telegram';
      tab.appendChild(telegramIcon);
    }

    // Close button (don't show for default if it's the only session)
    if (session.id !== 'default' || sessions.length > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'sidebar-session-close';
      closeBtn.innerHTML = '×';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        playNormalClick();
        confirmDeleteSession(session.id, session.name);
      };
      tab.appendChild(closeBtn);
    }

    tabsContainer.appendChild(tab);
  });

  // Hide new chat button in sidebar when at max
  const newChatBtn = document.getElementById('sidebar-new-chat');
  if (newChatBtn) newChatBtn.classList.toggle('hidden', sessions.length >= MAX_TABS);
}

function updateSessionsOrder() {
  // Update sessions array to match current DOM order
  const tabs = tabsContainer.querySelectorAll('.sidebar-session');
  const newOrder = [];
  tabs.forEach(tab => {
    const sessionId = tab.dataset.sessionId;
    const session = sessions.find(s => s.id === sessionId);
    if (session) newOrder.push(session);
  });
  sessions = newOrder;
}

function confirmDeleteSession(sessionId, sessionName) {
  if (sessions.length <= 1) return;

  if (confirm(`Delete "${sessionName}"? This will remove all messages in this chat.`)) {
    deleteSession(sessionId);
  }
}

async function switchSession(sessionId) {
  if (sessionId === currentSessionId) return;

  // Clear input when switching sessions
  input.value = '';
  input.style.height = 'auto';

  // Save search state for current session
  const searchArea = document.getElementById('search-area');
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchTextBySession.set(currentSessionId, searchInput.value);
  if (searchArea) searchOpenBySession.set(currentSessionId, searchArea.classList.contains('searching'));

  // Clear search UI (will restore for new session after load)
  if (searchArea) searchArea.classList.remove('searching');
  if (searchInput) searchInput.value = '';
  clearSearchHighlights();
  searchMatches = [];
  currentSearchIndex = 0;

  // Switch to new session
  currentSessionId = sessionId;
  localStorage.setItem('currentSessionId', currentSessionId);
  ensureStatusListener(sessionId);
  renderTabs();

  // Update mode toggle for this session
  updateModeUIForSession(sessionId);

  disableAutoAnimate(); messagesDiv.innerHTML = ''; enableAutoAnimate();
  // Clear stale streaming bubble reference — the DOM element was just destroyed.
  // A fresh bubble will be created when partial_text events arrive for this session.
  streamingBubbleBySession.delete(sessionId);
  updateBackgroundTasksUI();
  await loadHistory();

  // Restore pending user messages that haven't been saved to history yet
  const pendingMsgs = pendingUserMessagesBySession.get(sessionId);
  const isLoading = isLoadingBySession.get(sessionId) || false;

  // Remove empty state if we have pending messages or an active query
  if ((pendingMsgs && pendingMsgs.size > 0) || isLoading) {
    const emptyState = messagesDiv.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
  }

  if (pendingMsgs && pendingMsgs.size > 0) {
    pendingMsgs.forEach((msgData, msgId) => {
      const userMsgEl = addMessage('user', msgData.content, true, msgData.attachments);
      userMsgEl.dataset.messageId = msgId;
      // Check if this was a queued message
      const queuedIds = queuedMessageIdsBySession.get(sessionId) || new Set();
      if (queuedIds.has(msgId)) {
        userMsgEl.classList.add('queued');
        queuedMessageElements.set(msgId, userMsgEl);
      }
    });
  }

  updateStats();


  // Restore ghost suggestion for this session
  const savedSuggestion = getCurrentSuggestion();
  if (savedSuggestion) {
    ghostSuggestion.innerHTML = escapeHtml(savedSuggestion) + '<span class="tab-hint">Tab to accept</span>';
    ghostSuggestion.classList.remove('hidden');
  } else {
    ghostSuggestion.innerHTML = '';
    ghostSuggestion.classList.add('hidden');
  }

  // Restore search state for this session
  const savedSearchText = searchTextBySession.get(sessionId) || '';
  const wasSearchOpen = searchOpenBySession.get(sessionId) || false;
  if (wasSearchOpen || savedSearchText) {
    if (searchInput) searchInput.value = savedSearchText;
    if (wasSearchOpen && searchArea) {
      searchArea.classList.add('searching');
      // Re-run search to highlight matches in new session's messages
      if (savedSearchText) {
        performSearch(savedSearchText);
      }
    }
  }

  // Restore attachment previews for this session
  renderAttachmentPreviews();

  // Update button state based on whether THIS session is loading
  setButtonState(isLoading);

  // Restore status indicator if this session has an active query
  if (isLoading) {
    // Create a new status indicator for this session
    const existingStatusEl = statusElBySession.get(sessionId);
    if (!existingStatusEl || !messagesDiv.contains(existingStatusEl)) {
      const statusEl = addStatusIndicator('*stretches paws* thinking...');
      statusElBySession.set(sessionId, statusEl);
    }

    // Restore streaming bubble with accumulated partial text
    const savedText = streamingTextBySession.get(sessionId);
    if (savedText) {
      const bubble = document.createElement('div');
      bubble.className = 'message assistant streaming-bubble';
      const currentStatusEl = statusElBySession.get(sessionId);
      if (currentStatusEl && currentStatusEl.parentNode) {
        currentStatusEl.parentNode.insertBefore(bubble, currentStatusEl);
      } else {
        messagesDiv.appendChild(bubble);
      }
      streamingBubbleBySession.set(sessionId, bubble);
      const contentDiv = document.createElement('div');
      contentDiv.innerHTML = formatContent(savedText);
      while (contentDiv.firstChild) {
        bubble.appendChild(contentDiv.firstChild);
      }
      scrollToBottom();
    }
  }

  input.focus();
}

function getNextSessionName() {
  const names = new Set(sessions.map(s => s.name));
  if (!names.has('New')) return 'New';
  for (let i = 2; i <= 99; i++) {
    if (!names.has(`New${i}`)) return `New${i}`;
  }
  return `New${Date.now() % 10000}`;
}

async function createNewSession() {
  // Check tab limit
  if (sessions.length >= MAX_TABS) {
    return;
  }
  returnToChatView();

  try {
    const result = await window.pocketAgent.sessions.create(getNextSessionName());
    if (!result.success || !result.session) {
      addMessage('system', result.error || 'Failed to create session');
      return;
    }
    sessions.push(result.session); // Add to end (right side)
    currentSessionId = result.session.id;
    renderTabs();
    disableAutoAnimate(); messagesDiv.innerHTML = ''; enableAutoAnimate();
    showEmptyState();
    updateStats();

    // New session: update mode toggle (unlocked, shows session's mode)
    updateModeUIForSession(result.session.id);

    input.focus();
    // Start rename immediately
    setTimeout(() => startRenameSession(result.session.id), 100);
  } catch (err) {
    console.error('Failed to create session:', err);
  }
}

function startRenameSession(sessionId) {
  const tab = tabsContainer.querySelector(`[data-session-id="${sessionId}"]`);
  if (!tab) return;

  const nameSpan = tab.querySelector('.sidebar-session-name');
  const currentName = nameSpan.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-name-input';
  input.value = currentName;
  input.maxLength = 10;

  // Sanitize input: single word only (no spaces), max 10 chars
  input.oninput = () => {
    // Remove spaces and limit to 10 chars
    input.value = input.value.replace(/\s/g, '').slice(0, 10);
  };

  input.onblur = () => finishRename(sessionId, input.value);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = currentName;
      input.blur();
    } else if (e.key === ' ') {
      // Prevent space key
      e.preventDefault();
    }
  };

  nameSpan.replaceWith(input);
  input.focus();
  input.select();
}

async function finishRename(sessionId, newName) {
  // Sanitize: remove spaces, limit to 10 chars, fallback to 'Untitled'
  const sanitizedName = newName.replace(/\s/g, '').slice(0, 10) || 'Untitled';

  try {
    const result = await window.pocketAgent.sessions.rename(sessionId, sanitizedName);
    if (!result.success) {
      // Show error (likely duplicate name)
      addMessage('system', result.error || 'Failed to rename session');
      renderTabs(); // Revert UI
      return;
    }
    // Update local state
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      session.name = sanitizedName;
    }
    renderTabs();
  } catch (err) {
    console.error('Failed to rename session:', err);
    renderTabs(); // Revert UI
  }
}

async function deleteSession(sessionId) {
  if (sessions.length <= 1) {
    // Can't delete the last session
    return;
  }

  try {
    // Clean up status listener for this session
    const statusCleanup = statusCleanupBySession.get(sessionId);
    if (statusCleanup) {
      statusCleanup();
      statusCleanupBySession.delete(sessionId);
    }

    // Remove status indicator element
    const statusEl = statusElBySession.get(sessionId);
    if (statusEl) {
      statusEl.remove();
      statusElBySession.delete(sessionId);
    }
    toolCountBySession.delete(sessionId);

    // Clean up loading state
    isLoadingBySession.delete(sessionId);

    // Clean up queued message tracking for this session
    const queuedIds = queuedMessageIdsBySession.get(sessionId);
    if (queuedIds) {
      for (const msgId of queuedIds) {
        queuedMessageElements.delete(msgId);
      }
      queuedMessageIdsBySession.delete(sessionId);
    }

    // Clean up pending user messages
    pendingUserMessagesBySession.delete(sessionId);

    // Now delete the session (this also stops any running query)
    const result = await window.pocketAgent.sessions.delete(sessionId);

    if (!result.success) {
      console.error('Failed to delete session from database');
      // Refresh sessions from DB to ensure UI is in sync
      sessions = await window.pocketAgent.sessions.list();
      renderTabs();
      return;
    }

    sessions = sessions.filter(s => s.id !== sessionId);

    // If we deleted the current session, switch to another
    if (sessionId === currentSessionId) {
      currentSessionId = sessions[0]?.id || 'default';
      localStorage.setItem('currentSessionId', currentSessionId);
      disableAutoAnimate(); messagesDiv.innerHTML = ''; enableAutoAnimate();
      await loadHistory();
    }

    renderTabs();
    updateStats();
  } catch (err) {
    console.error('Failed to delete session:', err);
    // Refresh sessions from DB to ensure UI is in sync
    sessions = await window.pocketAgent.sessions.list();
    renderTabs();
  }
}

