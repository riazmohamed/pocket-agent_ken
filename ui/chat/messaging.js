function handleSendClick() {
  playSendClick();
  if (globalChatMode) {
    sendGlobalChatMessage();
    return;
  }
  if (isLoadingBySession.get(currentSessionId)) {
    stopQuery();
  } else {
    sendMessage();
  }
}

function setButtonState(loading) {
  if (globalChatMode) return;
  const sendIcon = sendBtn.querySelector('.send-icon');
  const stopIcon = sendBtn.querySelector('.stop-icon');

  if (loading) {
    sendBtn.classList.add('stop-btn');
    sendBtn.title = 'Stop it!';
    sendIcon.classList.add('hidden');
    stopIcon.classList.remove('hidden');
    sendBtn.disabled = false;
  } else {
    sendBtn.classList.remove('stop-btn');
    sendBtn.title = 'Send it!';
    sendIcon.classList.remove('hidden');
    stopIcon.classList.add('hidden');
  }
}

async function stopQuery() {
  const sessionId = currentSessionId;
  try {
    await window.pocketAgent.agent.stop(sessionId);
  } catch (err) {
    console.error('Failed to stop query:', err);
  } finally {
    // Always clean up UI state, even if stop() threw

    // Clean up status listener for this session
    const statusCleanup = statusCleanupBySession.get(sessionId);
    if (statusCleanup) {
      statusCleanup();
      statusCleanupBySession.delete(sessionId);
    }

    // Disable AutoAnimate so removals are instant (no slide-out)
    disableAutoAnimate();

    // Remove status indicator for this session
    const statusEl = statusElBySession.get(sessionId);
    if (statusEl) {
      statusEl.remove();
      statusElBySession.delete(sessionId);
    }
    toolCountBySession.delete(sessionId);

    // Remove streaming bubble if present
    const streamBubble = streamingBubbleBySession.get(sessionId);
    if (streamBubble) {
      streamBubble.remove();
      streamingBubbleBySession.delete(sessionId);
    }
    streamingTextBySession.delete(sessionId);
    const pendingRaf = streamingRafBySession.get(sessionId);
    if (pendingRaf) {
      cancelAnimationFrame(pendingRaf);
      streamingRafBySession.delete(sessionId);
    }

    // Remove 'queued' class from any queued messages and clear tracking
    const queuedMsgs = messagesDiv.querySelectorAll('.message.queued');
    queuedMsgs.forEach(msg => msg.classList.remove('queued'));
    queuedMessageElements.clear();

    addMessage('system', 'query stopped', true, [], null, false);
    requestAnimationFrame(() => enableAutoAnimate());

    isLoadingBySession.set(sessionId, false);
    renderTabs(); // Update tab loading indicator
    setButtonState(false);
    scrollToBottom();
    input.focus();
  }
}

async function sendMessage() {
  const message = input.value.trim();
  const attachments = [...getPendingAttachments()];
  const sessionId = currentSessionId; // Capture session at start
  const workflow = activeWorkflow; // Capture active workflow

  if (!message && attachments.length === 0 && !workflow) return;

  // Clear empty state if present
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  // Check if already processing - if so, message will be queued
  const isQueued = isLoadingBySession.get(sessionId);
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Always clear input immediately for responsive UX
  input.value = '';
  input.style.height = 'auto';
  clearSuggestion();
  clearAttachments();
  if (workflow) clearWorkflow();

  // Show user message instantly (no AutoAnimate entrance animation)
  const displayMessage = workflow ? `${workflow.name}${message ? ' ' + message : ''}` : message;
  disableAutoAnimate();
  const userMsgEl = addMessage('user', displayMessage, true, attachments);
  userMsgEl.dataset.messageId = messageId;
  // Keep AutoAnimate disabled during the entire query to prevent
  // the user message from shifting when status/streaming elements appear.
  // It will be re-enabled after the response is finalized.

  // Track pending user message for session state restoration
  if (!pendingUserMessagesBySession.has(sessionId)) {
    pendingUserMessagesBySession.set(sessionId, new Map());
  }
  pendingUserMessagesBySession.get(sessionId).set(messageId, { content: displayMessage, attachments: attachments, workflowName: workflow?.name || null });

  if (isQueued) {
    userMsgEl.classList.add('queued');
    userMsgEl.dataset.messageId = messageId;
    queuedMessageElements.set(messageId, userMsgEl);
    // Track queued message ID for session state restoration
    if (!queuedMessageIdsBySession.has(sessionId)) {
      queuedMessageIdsBySession.set(sessionId, new Set());
    }
    queuedMessageIdsBySession.get(sessionId).add(messageId);
  }

  // If not already processing, show status indicator and set loading state
  if (!isQueued) {
    isLoadingBySession.set(sessionId, true);
    renderTabs();
    setButtonState(true);
    const statusEl = addStatusIndicator('*stretches paws* thinking...');
    statusElBySession.set(sessionId, statusEl);
  }

  // Lock mode toggle once a message is sent in this session
  const toggle = document.querySelector('.mode-toggle');
  if (toggle && sessionId === currentSessionId) {
    toggle.classList.add('locked');
  }

  scrollToBottom();

  // Build the full message with attachments and workflow
  const built = await buildMessageWithAttachments(message, attachments);
  let fullMessage = built.text;
  const visionImages = built.images;
  if (workflow) {
    const workflowPrefix = `[Workflow: ${workflow.name}]\n${workflow.content}\n[/Workflow]`;
    fullMessage = fullMessage ? `${workflowPrefix}\n\n${fullMessage}` : workflowPrefix;
  }

  // Set up status listener for this session (only if not already set up)
  ensureStatusListener(sessionId);

  try {
    // This will resolve when the message is actually processed (not when queued)
    const result = await window.pocketAgent.agent.send(
      fullMessage,
      sessionId,
      visionImages.length > 0 ? visionImages : undefined
    );

    // If this message was queued, remove the queued state
    if (queuedMessageElements.has(messageId)) {
      const msgEl = queuedMessageElements.get(messageId);
      if (msgEl) {
        msgEl.classList.remove('queued');
      }
      queuedMessageElements.delete(messageId);
      // Remove from session tracking
      const queuedIds = queuedMessageIdsBySession.get(sessionId);
      if (queuedIds) queuedIds.delete(messageId);
    }

    // Remove from pending user messages (message is now saved to history)
    const pendingMsgs = pendingUserMessagesBySession.get(sessionId);
    if (pendingMsgs) pendingMsgs.delete(messageId);

    // Clean up loading state regardless of which tab is active
    // (otherwise indicators persist if user switched tabs mid-query)
    const hasMoreQueued = queuedMessageElements.size > 0;

    if (!hasMoreQueued) {
      // Clean up status listener
      const cleanup = statusCleanupBySession.get(sessionId);
      if (cleanup) {
        cleanup();
        statusCleanupBySession.delete(sessionId);
      }

      // Remove status indicator
      const currentStatusEl = statusElBySession.get(sessionId);
      if (currentStatusEl) {
        currentStatusEl.remove();
        statusElBySession.delete(sessionId);
      }
      toolCountBySession.delete(sessionId);

      isLoadingBySession.set(sessionId, false);
      renderTabs();
      if (currentSessionId === sessionId) {
        setButtonState(false);
      }
    }

    // Always clean up streaming bubble reference (may be stale if user switched sessions)
    const streamBubble = streamingBubbleBySession.get(sessionId);
    streamingTextBySession.delete(sessionId);
    // Cancel any pending RAF to avoid stale renders after completion
    const pendingRaf = streamingRafBySession.get(sessionId);
    if (pendingRaf) {
      cancelAnimationFrame(pendingRaf);
      streamingRafBySession.delete(sessionId);
    }

    // Only update visible UI if still on same session
    if (currentSessionId === sessionId) {
      if (result.stopped) {
        // Query was stopped — remove streaming bubble if present
        if (streamBubble) {
          streamBubble.remove();
          streamingBubbleBySession.delete(sessionId);
        }
      } else if (result.success && (result.response || result.planPending)) {
        // Hide streaming bubble instantly, then add final message in its place
        if (streamBubble) {
          streamBubble.style.display = 'none';
        }
        addMessage('assistant', result.response, !streamBubble, [], null, true, result.media);
        if (streamBubble) {
          streamBubble.remove();
          streamingBubbleBySession.delete(sessionId);
        }

        if (result.planPending) {
          showPlanApproval(result.response, sessionId);
        }

        // Show compaction notice if conversation was compacted
        if (result.wasCompacted) {
          addMessage('system', 'your chat has been compacted', true, [], null, false);
        }

        // If there's a suggested prompt, show it as ghost text
        if (result.suggestedPrompt) {
          setSuggestion(result.suggestedPrompt);
        }
      } else {
        // Error or empty response — remove streaming bubble
        if (streamBubble) {
          streamBubble.remove();
          streamingBubbleBySession.delete(sessionId);
        }
        // Don't show stop/abort related errors - they're already handled
        const errorMsg = result.error || '';
        if (!errorMsg.includes('stopped') && !errorMsg.includes('aborted') && !errorMsg.includes('Aborted')) {
          addMessage('error', errorMsg);
        }
      }

      updateStats();
      scrollToBottom();
    } else {
      // Different session — just clean up the bubble
      if (streamBubble) {
        streamBubble.remove();
        streamingBubbleBySession.delete(sessionId);
      }
    }
  } catch (err) {
    // If this message was queued, remove the queued state
    if (queuedMessageElements.has(messageId)) {
      const msgEl = queuedMessageElements.get(messageId);
      if (msgEl) {
        msgEl.classList.remove('queued');
      }
      queuedMessageElements.delete(messageId);
      // Remove from session tracking
      const queuedIds = queuedMessageIdsBySession.get(sessionId);
      if (queuedIds) queuedIds.delete(messageId);
    }

    // Remove from pending user messages (message is now saved to history)
    const pendingMsgsErr = pendingUserMessagesBySession.get(sessionId);
    if (pendingMsgsErr) pendingMsgsErr.delete(messageId);

    // Check if there are more queued messages
    const hasMoreQueued = queuedMessageElements.size > 0;

    if (!hasMoreQueued) {
      // Clean up status listener
      const cleanup = statusCleanupBySession.get(sessionId);
      if (cleanup) {
        cleanup();
        statusCleanupBySession.delete(sessionId);
      }

      const currentStatusEl = statusElBySession.get(sessionId);
      if (currentStatusEl) {
        currentStatusEl.remove();
        statusElBySession.delete(sessionId);
      }
      toolCountBySession.delete(sessionId);

      isLoadingBySession.set(sessionId, false);
      renderTabs();
      setButtonState(false);
    }

    // Only show error if still on same session and not stopped/cleared/aborted
    if (currentSessionId === sessionId && !err.message?.includes('stopped') && !err.message?.includes('cleared') && !err.message?.includes('aborted') && !err.message?.includes('Aborted')) {
      addMessage('error', err.message || 'Something went wrong');
    }

    scrollToBottom();
  }

  // Re-enable AutoAnimate now that the query is complete
  enableAutoAnimate();
  input.focus();
}

async function buildMessageWithAttachments(message, attachments) {
  if (attachments.length === 0) return { text: message, images: [] };

  const parts = [];
  const images = []; // Vision-capable image content blocks

  // Add text message if present
  if (message) {
    parts.push(message);
  }

  // Add attachments
  for (const att of attachments) {
    if (att.isImage && att.dataUrl) {
      // Extract base64 data and MIME type for vision
      try {
        const filePath = await window.pocketAgent.attachments.save(att.name, att.dataUrl);
        parts.push(`\n\n[Attached image: ${att.name}]\nFile saved at: ${filePath}`);

        // Extract base64 data from data URL for vision content block
        const mimeMatch = att.dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (mimeMatch) {
          const mediaType = mimeMatch[1];
          const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
          if (supportedTypes.includes(mediaType)) {
            images.push({
              type: 'base64',
              mediaType: mediaType,
              data: mimeMatch[2],
            });
          }
        }
      } catch (err) {
        parts.push(`\n\n[Image: ${att.name}] (failed to save: ${err.message})`);
      }
    } else if (EXTRACTABLE_EXTENSIONS.has(att.ext) && att.dataUrl) {
      // Save Office document, extract text, and include inline
      try {
        const filePath = await window.pocketAgent.attachments.save(att.name, att.dataUrl);
        try {
          const text = await window.pocketAgent.attachments.extractText(filePath);
          const content = text.length > 50000 ? text.slice(0, 50000) + '\n... (truncated)' : text;
          parts.push(`\n\n[Attached document: ${att.name}]\nFile saved at: ${filePath}\n\n\`\`\`\n${content}\n\`\`\``);
        } catch {
          parts.push(`\n\n[Attached document: ${att.name}]\nFile saved at: ${filePath}\nUse the Read tool to view this document.`);
        }
      } catch (err) {
        parts.push(`\n\n[Document: ${att.name}] (failed to save: ${err.message})`);
      }
    } else if (BINARY_EXTENSIONS.has(att.ext) && att.dataUrl) {
      // Save binary document to temp file and reference path
      try {
        const filePath = await window.pocketAgent.attachments.save(att.name, att.dataUrl);
        parts.push(`\n\n[Attached document: ${att.name}]\nFile saved at: ${filePath}\nUse the Read tool to view this document.`);
      } catch (err) {
        parts.push(`\n\n[Document: ${att.name}] (failed to save: ${err.message})`);
      }
    } else if (att.content) {
      // For text files, include content directly (truncate if very large)
      const content = att.content.length > 50000
        ? att.content.slice(0, 50000) + '\n... (truncated)'
        : att.content;
      parts.push(`\n\n[File: ${att.name}]\n\`\`\`${att.ext}\n${content}\n\`\`\``);
    }
  }

  return { text: parts.join(''), images };
}

async function clearChat() {
  if (!confirm('Start fresh? Don\'t worry - I\'ll keep everything I know about you!')) return;

  try {
    await window.pocketAgent.agent.clearConversation(currentSessionId);
    disableAutoAnimate(); messagesDiv.innerHTML = ''; enableAutoAnimate();
    showEmptyState();
    updateStats();
  } catch (err) {
    addMessage('error', err.message);
  }
}

function showFacts() {
  showBrainPanel('facts');
}

function showDailyLogs() {
  showBrainPanel('logs');
}

function showSoul() {
  showBrainPanel('soul');
}

