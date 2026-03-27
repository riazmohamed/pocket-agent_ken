function handleSchedulerMessage(data) {
  console.log(`[Chat] handleSchedulerMessage called - data.sessionId: ${data.sessionId}, currentSessionId: ${currentSessionId}`);
  // Only show message if it's for the current session
  if (data.sessionId && data.sessionId !== currentSessionId) {
    console.log(`[Chat] SKIPPING - session mismatch`);
    return;
  }
  console.log(`[Chat] DISPLAYING - session matches or no sessionId`);

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Routine prompts are hidden from the UI - the user only sees the agent's response
  // The prompt is still processed by the agent and saved to the database for history

  // Add the agent's response
  addMessage('assistant', data.response);

  // Update stats and scroll
  updateStats();
  scrollToBottom();

  // Focus window
  window.focus();
}

function handleTelegramMessage(data) {
  // Only show message if it's for the current session
  // (messages are already saved to SQLite for the correct session)
  if (data.sessionId && data.sessionId !== currentSessionId) {
    console.log(`[Chat] Telegram message for session ${data.sessionId}, current is ${currentSessionId} - skipping display`);
    return;
  }

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Add user message
  addMessage('user', data.userMessage);

  // Add the agent's response (with media if present)
  addMessage('assistant', data.response, true, [], null, true, data.media);

  // Show compaction notice if conversation was compacted
  if (data.wasCompacted) {
    addMessage('system', 'your chat has been compacted', true, [], null, false);
  }

  // Update stats and scroll
  updateStats();
  scrollToBottom();
}


function handleIOSMessage(data) {
  // Only show message if it's for the current session
  if (data.sessionId && data.sessionId !== currentSessionId) {
    console.log(`[Chat] iOS message for session ${data.sessionId}, current is ${currentSessionId} - skipping display`);
    return;
  }

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Add user message (strip workflow content for display)
  let iosDisplayMsg = data.userMessage;
  if (iosDisplayMsg && iosDisplayMsg.startsWith('[Workflow: ')) {
    const eb = iosDisplayMsg.indexOf(']');
    const em = iosDisplayMsg.indexOf('[/Workflow]');
    if (eb !== -1 && em !== -1) {
      const wfName = iosDisplayMsg.substring(11, eb);
      const userText = iosDisplayMsg.substring(em + 11).replace(/^\n\n/, '').trim();
      iosDisplayMsg = wfName + (userText ? ' ' + userText : '');
    }
  }
  addMessage('user', iosDisplayMsg);

  // Add the agent's response (with media if present) — skip empty (aborted)
  if (data.response) {
    addMessage('assistant', data.response, true, [], null, true, data.media);
  }

  // Update stats and scroll
  updateStats();
  scrollToBottom();
}



