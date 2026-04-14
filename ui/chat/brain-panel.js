/* Brain Panel — embedded in chat.html */

let _brainInitialized = false;
let _brainNotyf = null;

// ---- Show / Hide ----

function showBrainPanel(tab) {
  const chatView = document.getElementById('chat-view');
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;

  _dismissOtherPanels('brain-view');

  chatView.classList.add('hidden');
  brainView.classList.add('active');

  // Mark sidebar button active
  const sidebarBtn = document.getElementById('sidebar-brain-btn');
  if (sidebarBtn) sidebarBtn.classList.add('active');

  if (!_brainInitialized) {
    _initBrainPanel();
    _brainInitialized = true;
  }

  if (tab) {
    _brainSwitchTab(tab);
  }

  // Reload data for the active tab
  _brainRefreshActiveTab();
}

function hideBrainPanel() {
  const chatView = document.getElementById('chat-view');
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;

  brainView.classList.remove('active');
  chatView.classList.remove('hidden');

  // Unmark sidebar button
  const sidebarBtn = document.getElementById('sidebar-brain-btn');
  if (sidebarBtn) sidebarBtn.classList.remove('active');
}

function toggleBrainPanel() {
  const brainView = document.getElementById('brain-view');
  if (brainView && brainView.classList.contains('active')) {
    hideBrainPanel();
  } else {
    showBrainPanel();
  }
}

// ---- Toast ----

function _brainShowToast(message, type) {
  if (!_brainNotyf) {
    _brainNotyf = new Notyf({
      duration: 3000, position: { x: 'right', y: 'bottom' },
      dismissible: true,
      types: [
        { type: 'success', background: '#4ade80' },
        { type: 'error', background: '#f87171' }
      ]
    });
  }
  _brainNotyf[type === 'error' ? 'error' : 'success'](message);
}

// ---- Init ----

function _initBrainPanel() {
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;

  // Tab click handlers
  brainView.querySelectorAll('.brain-nav-item').forEach(tab => {
    tab.addEventListener('click', () => {
      playNormalClick();
      _brainSwitchTab(tab.dataset.tab);
    });
  });
}

function _brainSwitchTab(tabId) {
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;

  brainView.querySelectorAll('.brain-nav-item').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabId);
  });
  brainView.querySelectorAll('.brain-section').forEach(s => {
    s.classList.toggle('active', s.id === 'brain-' + tabId);
  });

  _brainRefreshActiveTab();
}

function _brainRefreshActiveTab() {
  const brainView = document.getElementById('brain-view');
  if (!brainView) return;
  const activeTab = brainView.querySelector('.brain-nav-item.active');
  if (!activeTab) return;

  const tabId = activeTab.dataset.tab;
  if (tabId === 'facts') _brainLoadFacts();
  else if (tabId === 'soul') _brainLoadSoul();
  else if (tabId === 'logs') _brainLoadLogs();
}

// ---- Helpers ----

function _brainEscapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _brainFormatAspectName(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _brainFormatDate(dateStr) {
  if (!dateStr) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(dateStr);
  return `${months[d.getMonth()]} ${d.getDate()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function _brainFormatLogDate(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yd = new Date(now); yd.setDate(yd.getDate() - 1);
  const yesterday = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`;
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const _trashSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="m19.5 5.5l-.62 10.025c-.158 2.561-.237 3.842-.88 4.763a4 4 0 0 1-1.2 1.128c-.957.584-2.24.584-4.806.584c-2.57 0-3.855 0-4.814-.585a4 4 0 0 1-1.2-1.13c-.642-.922-.72-2.205-.874-4.77L4.5 5.5M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5"/></svg>';

// ---- Capacity Bar Helper ----

function _brainUpdateCapacityBar(prefix, usage) {
  const fillEl = document.getElementById(`${prefix}-capacity-fill`);
  const textEl = document.getElementById(`${prefix}-capacity-text`);
  if (!fillEl || !textEl) return;

  const pct = Math.min(usage.pct, 100);
  fillEl.style.width = `${pct}%`;

  // Color coding
  fillEl.classList.remove('warning', 'critical');
  if (pct >= 90) fillEl.classList.add('critical');
  else if (pct >= 70) fillEl.classList.add('warning');

  textEl.textContent = `${pct}% — ${usage.usedChars.toLocaleString()} / ${usage.budgetChars.toLocaleString()} chars`;
}

// ---- Facts ----

async function _brainLoadFacts() {
  const tbody = document.getElementById('brain-facts-tbody');
  const countEl = document.getElementById('brain-facts-count');
  const emptyEl = document.getElementById('brain-facts-empty');
  const tableEl = document.getElementById('brain-facts-table');
  if (!tbody) return;

  try {
    const [facts, usage] = await Promise.all([
      window.pocketAgent.facts.list(),
      window.pocketAgent.facts.memoryUsage(),
    ]);
    if (countEl) countEl.textContent = `(${facts.length})`;
    _brainUpdateCapacityBar('brain-facts', usage);

    if (facts.length === 0) {
      if (tableEl) tableEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (tableEl) tableEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    tbody.innerHTML = facts.map(f => `
      <tr>
        <td class="fact-category">${_brainEscapeHtml(f.category)}</td>
        <td class="fact-subject">${_brainEscapeHtml(f.subject)}</td>
        <td class="fact-content">${_brainEscapeHtml(f.content)}</td>
        <td class="fact-actions"><button class="fact-delete-btn" onclick="playNormalClick(); brainDeleteFact(${f.id})" title="Delete">${_trashSvg}</button></td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('[Brain] Failed to load facts:', err);
    _brainShowToast('Failed to load facts', 'error');
  }
}

async function brainDeleteFact(id) {
  if (!confirm('Delete this fact?')) return;
  try {
    await window.pocketAgent.facts.delete(id);
    _brainShowToast('Fact deleted', 'success');
    _brainLoadFacts();
  } catch (err) {
    console.error('[Brain] Failed to delete fact:', err);
    _brainShowToast('Failed to delete', 'error');
  }
}

// ---- Soul ----

async function _brainLoadSoul() {
  const container = document.getElementById('brain-soul-cards');
  const countEl = document.getElementById('brain-soul-count');
  const emptyEl = document.getElementById('brain-soul-empty');
  if (!container) return;

  try {
    const [aspects, usage] = await Promise.all([
      window.pocketAgent.soul.listAspects(),
      window.pocketAgent.soul.memoryUsage(),
    ]);
    if (countEl) countEl.textContent = `(${aspects.length})`;
    _brainUpdateCapacityBar('brain-soul', usage);

    if (aspects.length === 0) {
      container.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    container.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    container.innerHTML = aspects.map(a => `
      <div class="soul-card">
        <div class="soul-card-name">${_brainEscapeHtml(_brainFormatAspectName(a.aspect))}</div>
        <div class="soul-card-content">${_brainEscapeHtml(a.content)}</div>
        <div class="soul-card-meta">Updated ${_brainFormatDate(a.updated_at)}</div>
        <button class="soul-delete-btn" onclick="playNormalClick(); brainDeleteSoul(${a.id})" title="Delete">${_trashSvg}</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('[Brain] Failed to load soul:', err);
    _brainShowToast('Failed to load approach', 'error');
  }
}

async function brainDeleteSoul(id) {
  if (!confirm('Delete this approach note?')) return;
  try {
    await window.pocketAgent.soul.deleteAspect(id);
    _brainShowToast('Deleted', 'success');
    _brainLoadSoul();
  } catch (err) {
    console.error('[Brain] Failed to delete soul:', err);
    _brainShowToast('Failed to delete', 'error');
  }
}

// ---- Daily Logs ----

async function _brainLoadLogs() {
  const tbody = document.getElementById('brain-logs-tbody');
  const countEl = document.getElementById('brain-logs-count');
  const emptyEl = document.getElementById('brain-logs-empty');
  const tableEl = document.getElementById('brain-logs-table');
  if (!tbody) return;

  try {
    const [logs, usage] = await Promise.all([
      window.pocketAgent.dailyLogs.list(),
      window.pocketAgent.dailyLogs.memoryUsage(),
    ]);
    if (countEl) countEl.textContent = `(${logs.length})`;
    _brainUpdateCapacityBar('brain-logs', usage);

    if (logs.length === 0) {
      if (tableEl) tableEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (tableEl) tableEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    const today = new Date().toISOString().split('T')[0];
    tbody.innerHTML = logs.map(l => {
      const dateLabel = _brainFormatLogDate(l.date);
      const isToday = l.date === today;
      return `
        <tr>
          <td class="log-date">${_brainEscapeHtml(dateLabel)}${isToday ? '<span class="now-badge">now</span>' : ''}</td>
          <td class="log-content">${_brainEscapeHtml(l.content)}</td>
          <td class="log-actions"><button class="log-delete-btn" onclick="playNormalClick(); brainDeleteLog(${l.id})" title="Delete">${_trashSvg}</button></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('[Brain] Failed to load logs:', err);
    _brainShowToast('Failed to load logs', 'error');
  }
}

async function brainDeleteLog(id) {
  if (!confirm('Delete this daily log?')) return;
  try {
    await window.pocketAgent.dailyLogs.delete(id);
    _brainShowToast('Log deleted', 'success');
    _brainLoadLogs();
  } catch (err) {
    console.error('[Brain] Failed to delete log:', err);
    _brainShowToast('Failed to delete', 'error');
  }
}

// ---- Refresh button ----

function brainRefresh() {
  _brainRefreshActiveTab();
  _brainShowToast('Refreshed!', 'success');
}
