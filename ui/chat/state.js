const messagesDiv = document.getElementById('messages');
const input = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const statsDiv = document.getElementById('stats');
const fileInput = document.getElementById('file-input');

// User/agent profile (loaded in init.js)
let userName = '';
let agentName = '';

let aaController = null;
let aaReady = false;
window.addEventListener('autoAnimateReady', () => {
  if (window._autoAnimate && messagesDiv) {
    aaController = window._autoAnimate(messagesDiv, { duration: 250 });
    if (!aaReady) aaController.disable();
  }
});
function disableAutoAnimate() { if (aaController) aaController.disable(); }
function enableAutoAnimate() { aaReady = true; requestAnimationFrame(() => { if (aaController) aaController.enable(); }); }

let isLoadingBySession = new Map(); // Track loading state per session
let pendingAttachmentsBySession = new Map(); // Track attachments per session
let statusCleanupBySession = new Map(); // Track status listeners per session

// Ensure a status listener exists for a session (called on session load + send)
function ensureStatusListener(sessionId) {
  if (!statusCleanupBySession.has(sessionId)) {
    const statusCleanup = window.pocketAgent.agent.onStatus((status) => {
      updateStatusIndicator(status, sessionId);
    });
    statusCleanupBySession.set(sessionId, statusCleanup);
  }
}
let statusElBySession = new Map(); // Track status elements per session
let streamingBubbleBySession = new Map(); // Track live-updating assistant bubble per session
let streamingTextBySession = new Map(); // Persist accumulated partial text across session switches
let streamingRafBySession = new Map(); // Track pending rAF for streaming render throttle
let streamingDirtyBySession = new Map(); // Track whether streaming text needs re-render
let toolCountBySession = new Map(); // Track tool call count per session
let suggestionBySession = new Map(); // Track ghost suggestions per session
let inputTextBySession = new Map(); // Track input text per session
let searchTextBySession = new Map(); // Track search input text per session
let searchOpenBySession = new Map(); // Track search open state per session
let queuedMessageIdsBySession = new Map(); // Track queued message IDs per session
let pendingUserMessagesBySession = new Map(); // Track pending user message content per session
const ghostSuggestion = document.getElementById('ghost-suggestion');
let queuedMessageElements = new Map(); // Track queued message DOM elements by a unique ID

// Helper to get current session's pending attachments
function getPendingAttachments() {
  return pendingAttachmentsBySession.get(currentSessionId) || [];
}
function setPendingAttachments(attachments) {
  pendingAttachmentsBySession.set(currentSessionId, attachments);
}
// Helper to get current session's suggestion
function getCurrentSuggestion() {
  return suggestionBySession.get(currentSessionId) || null;
}
function setCurrentSuggestion(suggestion) {
  suggestionBySession.set(currentSessionId, suggestion);
}

// Notification sound
let notificationSound = null;
let soundEnabled = true; // Will be loaded from settings

// Initialize notification sound
async function initNotificationSound() {
  try {
    soundEnabled = (await window.pocketAgent.settings.get('notifications.soundEnabled')) !== 'false';
    notificationSound = new Audio('../assets/pop.mp3');
    notificationSound.volume = 0.5;
  } catch (e) {
    console.warn('Failed to initialize notification sound:', e);
  }
}

// Play notification sound when response completes
function playNotificationSound() {
  if (soundEnabled && notificationSound) {
    notificationSound.currentTime = 0;
    notificationSound.play().catch(() => {});
  }
}

// Click sounds
const clickSound = document.getElementById('click-sound');
const normalClickSound = document.getElementById('normal-click-sound');

function playSendClick() {
  if (soundEnabled && clickSound) {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {});
  }
}

function playNormalClick() {
  if (soundEnabled && normalClickSound) {
    normalClickSound.currentTime = 0;
    normalClickSound.play().catch(() => {});
  }
}

const replySound = document.getElementById('reply-sound');
function playReplySound() {
  if (soundEnabled && replySound) {
    replySound.currentTime = 0;
    replySound.play().catch(() => {});
  }
}

// Session state
const MAX_TABS = 10;
const SESSION_NAME_MAX = 40; // Long enough to be descriptive; CSS truncates with ellipsis
let sessions = [];
let currentSessionId = 'default';
const tabsContainer = document.getElementById('sidebar-sessions');

// Global chat state
let globalChatMode = false;
let globalChatUsername = '';
let globalChatMessages = [];
let chatWs = null;
let chatWsReconnectTimer = null;
let chatWsReconnectDelay = 1000; // start at 1s, exponential backoff
const CHAT_WS_MAX_RECONNECT_DELAY = 30000;
let chatAdminKey = '';
let chatIsAdmin = false;
let globalChatSelfTier = 0;
let chatUnreadCount = 0;
const userMinTierMap = new Map(); // username -> minTier
let gchatReplyTo = null; // { username, text, element }
let mentionActive = false;
let mentionQuery = '';
let mentionStartPos = -1;
let mentionSelectedIndex = 0;
const chatTypingUsers = new Map(); // username → timeoutId
let chatTypingThrottleUntil = 0;

const TIER_CONFIG = [
  { name: '', threshold: 0, badge: '', cssClass: '' },
  { name: 'Spark', threshold: 10, badge: '\u26A1', cssClass: 'tier-spark' },
  { name: 'Blaze', threshold: 25, badge: '\uD83D\uDD25', cssClass: 'tier-blaze' },
  { name: 'Storm', threshold: 50, badge: '\u26C8\uFE0F', cssClass: 'tier-storm' },
  { name: 'Frost', threshold: 80, badge: '\u2744\uFE0F', cssClass: 'tier-frost' },
  { name: 'Solar', threshold: 120, badge: '\u2600\uFE0F', cssClass: 'tier-solar' },
  { name: 'Mystic', threshold: 175, badge: '\uD83D\uDD2E', cssClass: 'tier-mystic' },
  { name: 'Inferno', threshold: 250, badge: '\uD83D\uDC80', cssClass: 'tier-inferno' },
  { name: 'Cosmic', threshold: 350, badge: '\uD83C\uDF0C', cssClass: 'tier-cosmic' },
  { name: 'Legendary', threshold: 500, badge: '\u2694\uFE0F', cssClass: 'tier-legendary' },
  { name: 'Mythic', threshold: 750, badge: '\uD83D\uDC51', cssClass: 'tier-mythic' },
];
const CHAT_WS_URL = 'wss://pocket-agent-chat-production.up.railway.app';
const CHAT_API_URL = 'https://pocket-agent-chat-production.up.railway.app';
const GCHAT_REACTIONS = ['🔥', '👍', '😂', '💀'];

// Allowed file types
const ALLOWED_EXTENSIONS = new Set([
  // Text/Code
  'txt', 'md', 'json', 'csv', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'jsx', 'tsx',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'conf', 'log', 'sql', 'graphql',
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
  // Documents
  'pdf', 'docx', 'doc', 'rtf', 'odt', 'pages',
  'xlsx', 'xls', 'ods', 'numbers',
  'pptx', 'ppt', 'odp', 'keynote',
  'epub', 'zip', 'tar', 'gz'
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const EXTRACTABLE_EXTENSIONS = new Set([
  'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf'
]);
const BINARY_EXTENSIONS = new Set([
  'pdf', 'doc', 'pages',
  'xls', 'numbers',
  'ppt', 'keynote',
  'epub', 'zip', 'tar', 'gz'
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Initialize

