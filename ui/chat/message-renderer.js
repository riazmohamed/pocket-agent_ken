function addMessage(role, content, animate = true, attachments = [], timestamp = null, showTimestamp = true, media = null) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (!animate) div.style.animation = 'none';

  // Add attachments display for user messages
  if (attachments && attachments.length > 0) {
    const attDiv = document.createElement('div');
    attDiv.className = 'message-attachments';

    for (const att of attachments) {
      const attItem = document.createElement('div');
      attItem.className = 'message-attachment';

      if (att.isImage && att.dataUrl) {
        const img = document.createElement('img');
        img.src = att.dataUrl;
        img.alt = att.name;
        attItem.appendChild(img);
      } else {
        attItem.innerHTML = `<span class="attachment-icon">${escapeHtml(att.ext)}</span> ${escapeHtml(att.name)}`;
      }

      attDiv.appendChild(attItem);
    }

    div.appendChild(attDiv);
  }

  // Add text content
  if (content) {
    const contentDiv = document.createElement('div');
    // Format error messages with structured layout
    if (role === 'error') {
      contentDiv.innerHTML = formatErrorContent(content);
    } else {
      contentDiv.innerHTML = formatContent(content);
    }
    // Append children directly to avoid nesting issues
    while (contentDiv.firstChild) {
      div.appendChild(contentDiv.firstChild);
    }
    // Intercept link and image clicks
    div.addEventListener('click', (e) => {
      // Open links in external browser
      const link = e.target.closest('a[href]');
      if (link) {
        e.preventDefault();
        const href = link.getAttribute('href');
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          window.pocketAgent.app.openExternal(href);
        }
        return;
      }
      // Open markdown-rendered images in default image viewer
      if (e.target.tagName === 'IMG' && !e.target.closest('.message-media')) {
        const src = e.target.getAttribute('src');
        if (src) {
          window.pocketAgent.app.openImage(src);
        }
        return;
      }
      // Open attached files from history
      const attEl = e.target.closest('.message-attachment[data-path]');
      if (attEl) {
        window.pocketAgent.app.openPath(attEl.dataset.path);
      }
    });
  }

  // Add response media images (from agent screenshots/tools)
  if (media && media.length > 0) {
    const mediaDiv = document.createElement('div');
    mediaDiv.className = 'message-media';

    for (const item of media) {
      if (item.type === 'image') {
        const img = document.createElement('img');
        img.alt = 'Agent image';
        img.loading = 'lazy';

        // If it's already a data URI, use directly; otherwise load via IPC
        if (item.dataUri) {
          img.src = item.dataUri;
        } else if (item.filePath) {
          // Load image via IPC to get data URI
          window.pocketAgent.agent.readMedia(item.filePath).then(dataUri => {
            if (dataUri) {
              img.src = dataUri;
            }
          });
        }

        // Click to open in default image viewer
        if (item.filePath) {
          img.title = 'Click to open';
          img.addEventListener('click', () => {
            window.pocketAgent.app.openImage(item.filePath);
          });
        }

        mediaDiv.appendChild(img);
      }
    }

    div.appendChild(mediaDiv);
  }

  // Add footer with copy button and timestamp
  // For user messages, footer goes outside the bubble as a sibling
  let externalFooter = null;
  if (showTimestamp) {
    const ts = timestamp ? parseSqliteTimestamp(timestamp) : new Date();
    const footerDiv = document.createElement('div');
    footerDiv.className = 'message-footer';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-copy-btn';
    copyBtn.title = 'Copy';
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M9 15c0-2.828 0-4.243.879-5.121C10.757 9 12.172 9 15 9h1c2.828 0 4.243 0 5.121.879C22 10.757 22 12.172 22 15v1c0 2.828 0 4.243-.879 5.121C20.243 22 18.828 22 16 22h-1c-2.828 0-4.243 0-5.121-.879C9 20.243 9 18.828 9 16z"/><path d="M17 9c-.003-2.957-.047-4.489-.908-5.538a4 4 0 0 0-.554-.554C14.43 2 12.788 2 9.5 2c-3.287 0-4.931 0-6.038.908a4 4 0 0 0-.554.554C2 4.57 2 6.212 2 9.5c0 3.287 0 4.931.908 6.038a4 4 0 0 0 .554.554c1.05.86 2.58.906 5.538.908"/></g></svg>`;
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      copyMessageText(div, copyBtn);
    };
    footerDiv.appendChild(copyBtn);

    // Timestamp
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-timestamp';
    timestampDiv.textContent = formatTimestamp(ts);
    footerDiv.appendChild(timestampDiv);

    if (role === 'user') {
      footerDiv.className = 'message-footer-external';
      externalFooter = footerDiv;
    } else {
      div.appendChild(footerDiv);
    }
  }

  // Insert before status indicator if one exists (keeps indicator at bottom)
  const statusIndicator = messagesDiv.querySelector('.status-indicator');
  if (statusIndicator) {
    messagesDiv.insertBefore(div, statusIndicator);
    if (externalFooter) messagesDiv.insertBefore(externalFooter, statusIndicator);
  } else {
    messagesDiv.appendChild(div);
    if (externalFooter) messagesDiv.appendChild(externalFooter);
  }
  return div;
}

// Parse SQLite timestamp consistently (SQLite stores UTC with 'Z' suffix)
function parseSqliteTimestamp(timestamp) {
  if (!timestamp) return new Date();

  // Check if timestamp has an explicit timezone indicator (Z, +HH:MM, -HH:MM, +HHMM, -HHMM)
  const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(timestamp);

  if (hasTimezone) {
    // Already has timezone info, parse directly
    return new Date(timestamp);
  }

  // Legacy fallback: old timestamps without timezone (assumed UTC)
  const normalized = timestamp.replace(' ', 'T');
  return new Date(normalized + 'Z');
}

function formatTimestamp(date) {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  if (isToday) {
    return `Today, ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  return `${dateStr}, ${timeStr}`;
}

function formatErrorContent(text) {
  const escaped = escapeHtml(text);
  // Strip report hint — badge is enough context
  const reportHint = 'If this keeps happening, send this error to the developer.';
  const mainText = escaped.replace(reportHint, '').trim();

  // Extract error code if present: [error_code]
  const codeMatch = mainText.match(/\[([a-z_]+)\]/);
  const errorCode = codeMatch ? codeMatch[1] : null;
  const body = codeMatch ? mainText.replace(/\s*\[[a-z_]+\]/, '').trim() : mainText;

  let html = `<div class="error-body">${body}</div>`;
  if (errorCode) {
    html += `<div class="error-code">${errorCode}</div>`;
  }
  return html;
}

function formatContent(text) {
  // Pre-process: convert attachment markers into styled chips before markdown
  // Handles: [Attached document: name], [Attached PDF: name], [Attached image: name], etc.
  // Also strips trailing extracted content code block if present
  text = text.replace(
    /\[Attached [^\]]*?: ([^\]]+)\]\nFile saved at: ([^\n]+)\n(?:Use the Read tool to view this [^\n]*\.)?(?:\n*```[\s\S]*?```)?/g,
    (_, name, filePath) => {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const safeExt = ext.replace(/[<>&"']/g, '');
      const safeName = name.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      const safePath = filePath.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      return `\n<div class="message-attachment" data-path="${safePath}" style="cursor:pointer" title="${safePath}"><span class="attachment-icon">${safeExt}</span> ${safeName}</div>\n`;
    }
  );
  // Handle legacy [File: name] format (old extracted documents stored without path)
  // Also strips the code block that follows
  text = text.replace(
    /\[File: ([^\]]+\.(?:docx|pptx|xlsx|odt|odp|ods|rtf))\]\n(?:```[\s\S]*?```)?/gi,
    (_, name) => {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const safeExt = ext.replace(/[<>&"']/g, '');
      const safeName = name.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      return `<div class="message-attachment"><span class="attachment-icon">${safeExt}</span> ${safeName}</div>\n`;
    }
  );

  // Use marked for full markdown rendering (only when DOMPurify is available to sanitize)
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    marked.setOptions({
      breaks: true, // Convert \n to <br>
      gfm: true, // GitHub flavored markdown
    });
    let html = marked.parse(text);
    // Wrap tables in scrollable container
    html = html.replace(/<table>/g, '<div class="table-wrapper"><table>');
    html = html.replace(/<\/table>/g, '</table></div>');
    // Sanitize to prevent XSS from untrusted message sources (Telegram, iOS, agent responses)
    html = DOMPurify.sanitize(html, {
      ADD_ATTR: ['data-path', 'target'],
    });
    return html;
  }
  // Fallback: escape HTML (when marked or DOMPurify isn't loaded)
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addTimestamp(date) {
  const div = document.createElement('div');
  div.className = 'timestamp';
  div.textContent = date;
  messagesDiv.appendChild(div);
}

function addTyping() {
  const div = document.createElement('div');
  div.className = 'typing';
  div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  messagesDiv.appendChild(div);
  return div;
}

function addStatusIndicator(initialMessage) {
  const div = document.createElement('div');
  div.className = 'status-indicator';
  div.innerHTML = `
    <div class="status-spinner"></div>
    <div class="status-content">
      <div class="status-action">${escapeHtml(initialMessage)}</div>
      <div class="status-detail"></div>
      <div class="status-preview"></div>
    </div>
    <div class="status-count hidden"></div>
  `;
  messagesDiv.appendChild(div);
  return div;
}

function updateStatusIndicator(status, sessionId) {
  // Use status.sessionId (from the event) as authoritative source, fall back to listener's sessionId, then currentSessionId
  const targetSession = status.sessionId || sessionId || currentSessionId;

  // GUARD: If the event has a sessionId, only the listener registered for that session should process it.
  // Without this, multiple session listeners all accumulate partial_text, causing duplicates.
  if (sessionId && status.sessionId && sessionId !== status.sessionId) return;

  // Allow notification sound for any session completing (even non-active)
  if (status.type === 'done' && targetSession !== currentSessionId) {
    playNotificationSound();
    return;
  }

  // GUARD: Never render status/streaming UI for a session that isn't currently displayed.
  // This prevents events from session A leaking into session B's UI when both are active
  // (e.g. general mode still processing while user switched to coder session).
  if (targetSession !== currentSessionId) return;

  // Handle background tasks before status element check — they use a separate UI area
  if (status.type === 'background_task_start') {
    if (status.backgroundTaskId) {
      addBackgroundTask(
        status.sessionId || targetSession,
        status.backgroundTaskId,
        status.toolName || 'task',
        status.backgroundTaskDescription || 'background task'
      );
    }
    return;
  } else if (status.type === 'background_task_output') {
    return;
  } else if (status.type === 'background_task_end') {
    if (status.backgroundTaskId) {
      removeBackgroundTask(status.sessionId || targetSession, status.backgroundTaskId);
    }
    return;
  }

  const statusEl = statusElBySession.get(targetSession);
  if (!statusEl) return;

  const actionEl = statusEl.querySelector('.status-action');
  const detailEl = statusEl.querySelector('.status-detail');
  const previewEl = statusEl.querySelector('.status-preview');
  const countEl = statusEl.querySelector('.status-count');

  // Clear preview when switching to a non-preview status
  if (status.type !== 'partial_text' && previewEl) {
    previewEl.textContent = '';
    previewEl.classList.add('hidden');
  }

  // Re-show the status indicator when switching away from streaming text
  if (status.type !== 'partial_text' && statusEl.style.display === 'none') {
    statusEl.style.display = '';
  }

  if (status.type === 'thinking') {
    // Don't overwrite blocked state
    if (!statusEl.classList.contains('tool-blocked')) {
      actionEl.textContent = status.message || '*stretches paws* thinking...';
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
      statusEl.classList.remove('subagent-active');
      statusEl.classList.remove('pocket-cli-active');
      statusEl.classList.remove('team-active');
      statusEl.classList.remove('plan-mode-active');
    }
  } else if (status.type === 'tool_start') {
    // Increment tool call counter
    const count = (toolCountBySession.get(targetSession) || 0) + 1;
    toolCountBySession.set(targetSession, count);
    if (countEl) {
      countEl.textContent = count === 1 ? '1 tool' : `${count} tools`;
      countEl.classList.remove('hidden');
    }

    actionEl.textContent = status.toolName || 'pouncing on it...';
    if (status.toolInput) {
      detailEl.textContent = status.toolInput;
      detailEl.title = status.toolInput;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('team-active');
    statusEl.classList.remove('plan-mode-active');
    statusEl.classList.remove('tool-blocked');
    if (status.isPocketCli) {
      statusEl.classList.add('pocket-cli-active');
    } else {
      statusEl.classList.remove('pocket-cli-active');
    }
  } else if (status.type === 'tool_end') {
    // Don't overwrite blocked state - keep showing the block message
    if (!statusEl.classList.contains('tool-blocked')) {
      actionEl.textContent = status.message || 'caught it! processing...';
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
      statusEl.classList.remove('subagent-active');
      statusEl.classList.remove('pocket-cli-active');
      statusEl.classList.remove('team-active');
      statusEl.classList.remove('plan-mode-active');
    }
  } else if (status.type === 'tool_blocked') {
    // Safety hook blocked a dangerous command
    statusEl.classList.add('tool-blocked');
    actionEl.textContent = status.message || '🙀 whoa! not allowed!';
    if (status.blockedReason) {
      detailEl.textContent = status.blockedReason;
      detailEl.title = status.blockedReason;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
  } else if (status.type === 'subagent_start') {
    // Subagent spawned - show special status
    statusEl.classList.add('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'summoning cat friends';
    if (status.toolInput) {
      const countBadge = status.agentCount > 1 ? ` (${status.agentCount} active)` : '';
      detailEl.textContent = status.toolInput + countBadge;
      detailEl.title = status.toolInput;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = status.agentCount > 1 ? `${status.agentCount} helpers active` : '';
      detailEl.classList.toggle('hidden', !(status.agentCount > 1));
    }
  } else if (status.type === 'subagent_update') {
    // Multiple subagents, one finished
    actionEl.textContent = status.message || `${status.agentCount} kitties on the job`;
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
  } else if (status.type === 'subagent_end') {
    // All subagents done
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
    actionEl.textContent = status.message || 'cat squad finished! ✨';
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
  } else if (status.type === 'teammate_start') {
    // Teammate spawned - show team status
    statusEl.classList.add('team-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'rallying the squad';
    if (status.teammateName) {
      detailEl.textContent = status.teammateName + (status.toolInput ? ': ' + status.toolInput : '');
      detailEl.title = detailEl.textContent;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
  } else if (status.type === 'teammate_message') {
    // Message sent between teammates
    statusEl.classList.add('team-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'passing a note';
    if (status.toolInput) {
      detailEl.textContent = status.toolInput;
      detailEl.title = status.toolInput;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
  } else if (status.type === 'teammate_idle') {
    // Teammate went idle
    statusEl.classList.add('team-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'teammate idle';
    if (status.teammateName) {
      detailEl.textContent = status.teammateName + ' finished their part';
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
  } else if (status.type === 'task_completed') {
    // Team task completed
    statusEl.classList.add('team-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    actionEl.textContent = status.message || 'task done!';
    if (status.taskSubject) {
      const by = status.teammateName ? ` (by ${status.teammateName})` : '';
      detailEl.textContent = status.taskSubject + by;
      detailEl.title = detailEl.textContent;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
  } else if (status.type === 'plan_mode_entered') {
    statusEl.classList.add('plan-mode-active');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
    actionEl.textContent = status.message || 'planning the pounce...';
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
  } else if (status.type === 'plan_mode_exited') {
    statusEl.classList.remove('plan-mode-active');
    actionEl.textContent = status.message || 'plan ready for review';
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
  } else if (status.type === 'partial_text') {
    // Show live-updating assistant bubble with composed text
    if (status.sessionId) {
      // partialReplace: full text from coder mode (replace entirely)
      // otherwise: delta from general mode (accumulate)
      const prev = streamingTextBySession.get(status.sessionId) || '';
      const accumulated = status.partialReplace
        ? (status.partialText || '')
        : prev + (status.partialText || '');
      streamingTextBySession.set(status.sessionId, accumulated);

      // Skip rendering if there's no content yet
      if (!accumulated) return;

      let bubble = streamingBubbleBySession.get(status.sessionId);
      if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'message assistant streaming-bubble';
        // Insert before the status indicator
        if (statusEl && statusEl.parentNode) {
          statusEl.parentNode.insertBefore(bubble, statusEl);
        } else {
          messagesDiv.appendChild(bubble);
        }
        streamingBubbleBySession.set(status.sessionId, bubble);
      }
      // Throttle DOM updates with RAF — skip if a render is already queued
      if (!streamingRafBySession.has(status.sessionId)) {
        const rafId = requestAnimationFrame(() => {
          streamingRafBySession.delete(status.sessionId);
          const currentBubble = streamingBubbleBySession.get(status.sessionId);
          if (!currentBubble) return;
          const text = streamingTextBySession.get(status.sessionId) || '';
          // Re-render all accumulated text
          const contentDiv = document.createElement('div');
          contentDiv.innerHTML = formatContent(text);
          currentBubble.innerHTML = '';
          while (contentDiv.firstChild) {
            currentBubble.appendChild(contentDiv.firstChild);
          }
          // Hide status indicator only after bubble has actual rendered content
          if (statusEl && text) {
            statusEl.style.display = 'none';
          }
          // Only scroll if user is near the bottom (within 120px)
          const distFromBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight;
          if (distFromBottom < 120) {
            scrollToBottom();
          }
        });
        streamingRafBySession.set(status.sessionId, rafId);
      }
    }
  } else if (status.type === 'responding') {
    actionEl.textContent = 'grooming my response... 🐈';
    detailEl.textContent = '';
    detailEl.classList.add('hidden');
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
  } else if (status.type === 'queued') {
    // Message was queued - show queue position
    actionEl.textContent = status.message || 'in the litter queue 📋';
    if (status.queuePosition) {
      detailEl.textContent = `Position #${status.queuePosition} in queue`;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');
  } else if (status.type === 'queue_processing') {
    // Now processing a queued message
    actionEl.textContent = status.message || 'digging it up now...';
    if (status.queuedMessage) {
      detailEl.textContent = status.queuedMessage;
      detailEl.title = status.queuedMessage;
      detailEl.classList.remove('hidden');
    } else {
      detailEl.textContent = '';
      detailEl.classList.add('hidden');
    }
    statusEl.classList.remove('subagent-active');
    statusEl.classList.remove('pocket-cli-active');
    statusEl.classList.remove('team-active');

    // Remove 'queued' class from the oldest queued message since it's now processing
    const queuedMsgs = messagesDiv.querySelectorAll('.message.queued');
    if (queuedMsgs.length > 0) {
      queuedMsgs[0].classList.remove('queued');
    }
  } else if (status.type === 'done') {
    // Response complete - play notification sound
    playNotificationSound();

    // Finalize streaming bubble: remove the blinking cursor class so it becomes
    // a normal message. For cron jobs the response handler (handleSchedulerMessage)
    // may replace this bubble entirely, but if it doesn't arrive (e.g. errors) or
    // arrives later, this prevents the cursor from blinking indefinitely.
    const doneBubble = streamingBubbleBySession.get(targetSession);
    if (doneBubble) {
      doneBubble.classList.remove('streaming-bubble');
    }

    // Safety net: clean up thinking indicator if still present (e.g. cron job errors
    // where the normal response handler never fires)
    const doneStatusEl = statusElBySession.get(targetSession);
    if (doneStatusEl) {
      doneStatusEl.remove();
      statusElBySession.delete(targetSession);
      toolCountBySession.delete(targetSession);
      isLoadingBySession.set(targetSession, false);
      renderTabs();
      setButtonState(false);
    }
  }

  scrollToBottom();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyMessageText(messageEl, copyBtn) {
  // Get text content, excluding footer (timestamp, copy button)
  const clone = messageEl.cloneNode(true);
  const footer = clone.querySelector('.message-footer');
  if (footer) footer.remove();
  const attachments = clone.querySelector('.message-attachments');
  if (attachments) attachments.remove();

  const text = clone.textContent.trim();

  navigator.clipboard.writeText(text).then(() => {
    // Show copied state
    copyBtn.classList.add('copied');
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 14.5s1.5 0 3.5 3.5c0 0 5.559-9.167 10.5-11"/></svg>`;

    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M9 15c0-2.828 0-4.243.879-5.121C10.757 9 12.172 9 15 9h1c2.828 0 4.243 0 5.121.879C22 10.757 22 12.172 22 15v1c0 2.828 0 4.243-.879 5.121C20.243 22 18.828 22 16 22h-1c-2.828 0-4.243 0-5.121-.879C9 20.243 9 18.828 9 16z"/><path d="M17 9c-.003-2.957-.047-4.489-.908-5.538a4 4 0 0 0-.554-.554C14.43 2 12.788 2 9.5 2c-3.287 0-4.931 0-6.038.908a4 4 0 0 0-.554.554C2 4.57 2 6.212 2 9.5c0 3.287 0 4.931.908 6.038a4 4 0 0 0 .554.554c1.05.86 2.58.906 5.538.908"/></g></svg>`;
    }, 1500);
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// Search functionality
let searchMatches = [];
let currentSearchIndex = -1;
let searchDebounceTimer = null;

// Workflow state
let activeWorkflow = null;

