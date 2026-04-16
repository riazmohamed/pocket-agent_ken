# Pocket Agent - Comprehensive Features & Systems Mapping

**Project**: Pocket Agent Desktop App  
**Version**: Latest  
**Description**: Personal AI assistant that remembers you, learns from your interactions, and automates tasks. Lives in your menu bar 24/7 with desktop, Telegram, and iOS interfaces.

---

## 📋 TABLE OF CONTENTS

1. [TOOLS & CAPABILITIES](#tools--capabilities)
2. [MCP SERVERS](#mcp-servers)
3. [MEMORY SYSTEM](#memory-system)
4. [SCHEDULING & AUTOMATION](#scheduling--automation)
5. [BROWSER AUTOMATION](#browser-automation)
6. [CHANNELS & INTEGRATIONS](#channels--integrations)
7. [SETTINGS & CONFIGURATION](#settings--configuration)
8. [AUTHENTICATION](#authentication)
9. [AGENT & CHAT ENGINE](#agent--chat-engine)
10. [USER INTERFACE](#user-interface)

---

## 🛠️ TOOLS & CAPABILITIES

### Location: `/src/tools/`

#### **Browser Tool** (`browser-tools.ts`)
- **Tool Name**: `browser`
- **Description**: Browser automation for JS rendering and authenticated sessions
- **Tier System**:
  - **Electron Tier** (default): Hidden window for screenshots & clicking
  - **CDP Tier**: Connects to user's Chrome with logged-in sessions
- **Actions** (14 total):
  1. `navigate` - Go to URL
  2. `screenshot` - Capture page as base64
  3. `click` - Click element by selector
  4. `type` - Type text in input
  5. `evaluate` - Run JavaScript
  6. `extract` - Get page data (text/html/links/tables/structured)
  7. `scroll` - Scroll page or element
  8. `hover` - Hover over element
  9. `download` - Download file
  10. `upload` - Upload file to input
  11. `tabs_list` - List open tabs (CDP only)
  12. `tabs_open` - Open new tab (CDP only)
  13. `tabs_close` - Close tab (CDP only)
  14. `tabs_focus` - Switch to tab (CDP only)
- **Parameters**:
  - `action` (required): Action type
  - `url` (optional): URL to navigate to
  - `selector` (optional): CSS selector for element
  - `text` (optional): Text to type
  - `script` (optional): JavaScript to evaluate
  - `extract_type` (optional): Type of data to extract
  - `scroll_direction` (optional): up/down/left/right
  - `scroll_amount` (optional): Pixels to scroll
  - `download_path` (optional): Path to save downloaded file
  - `file_path` (optional): Path to file to upload
  - `tier` (optional): Force specific tier (electron/cdp)
  - `requires_auth` (optional): Hint that auth is needed (uses CDP)
  - `wait_for` (optional): Selector or ms to wait for
  - `tab_id` (optional): Tab ID for tabs operations
- **Limitations**: 
  - Electron tier doesn't have access to logged-in sessions
  - CDP requires Chrome running with `--remote-debugging-port=9222`

---

#### **Memory Tools** (`memory-tools.ts`)
**Purpose**: Save and retrieve long-term memory about users and facts

1. **`remember`**
   - **Description**: Save a fact to long-term memory
   - **Parameters**:
     - `category` (required): user_info, preferences, projects, people, work, notes, decisions
     - `subject` (required): Specific key (e.g., partner_name, coffee_preference)
     - `content` (required): Fact to remember (max 25-30 words)
   - **Returns**: Success, id, category, subject

2. **`forget`**
   - **Description**: Remove a fact from memory
   - **Parameters**:
     - `id` (optional): Fact ID
     - `category` (optional): Category of fact
     - `subject` (optional): Subject of fact
   - **Note**: Provide either id OR category+subject
   - **Returns**: Success/failure message

3. **`list_facts`**
   - **Description**: List all known facts from memory
   - **Parameters**:
     - `category` (optional): Filter by category
   - **Returns**: Array of facts with id, category, subject, content

4. **`memory_search`**
   - **Description**: Semantic + keyword hybrid search through long-term memory
   - **Parameters**:
     - `query` (required): Natural language search query
   - **Returns**: Top 6 results with similarity scores
   - **Scoring**: Weighted blend of vector (0.7) + keyword (0.3) similarity

5. **`daily_log`**
   - **Description**: Add entries to today's daily log
   - **Parameters**:
     - `entry` (required): One concise line (auto-timestamped)
   - **Returns**: Success, date
   - **Use Cases**: Log completed tasks, decisions, mood, key events

---

#### **Soul Tools** (`soul-tools.ts`)
**Purpose**: Record what the agent learns about working with THIS user (relationship dynamics)

1. **`soul_set`**
   - **Description**: Record learned aspects about user dynamic
   - **Parameters**:
     - `aspect` (required): Name of aspect (e.g., communication_style, boundaries)
     - `content` (required): Description of this aspect
   - **Returns**: Success, id, aspect
   - **Use Cases**: Communication corrections, frustrations, boundaries, working style

2. **`soul_get`**
   - **Description**: Retrieve specific soul aspect
   - **Parameters**:
     - `aspect` (required): Name of aspect
   - **Returns**: aspect, content, updated_at

3. **`soul_list`**
   - **Description**: List all recorded soul aspects
   - **Returns**: Array of aspects with id, aspect, content, updated_at

4. **`soul_delete`**
   - **Description**: Delete soul aspect that's no longer relevant
   - **Parameters**:
     - `aspect` (required): Name of aspect
   - **Returns**: Success/failure message

---

#### **Scheduler Tools** (`scheduler-tools.ts`)
**Purpose**: Create scheduled tasks and reminders

1. **`create_routine`**
   - **Description**: Schedule a prompt for LLM to execute at specific time
   - **Parameters**:
     - `name` (required): Unique routine name (e.g., morning_weather)
     - `schedule` (required): When to run
       - One-shot: "30m", "2h", "in 10 minutes", "tomorrow 3pm"
       - Recurring: "every 30m", "every 2h", or cron "0 9 * * *"
     - `prompt` (required): Instruction sent to LLM (e.g., "Check weather in KL")
   - **Returns**: Success, name, type, schedule, next_run, one_time flag, channel, session_id
   - **Execution**: Runs as full agent with access to all tools

2. **`create_reminder`**
   - **Description**: Simple notification (NO LLM involvement)
   - **Parameters**:
     - `name` (required): Reminder name
     - `schedule` (required): When to trigger
     - `message` (required): Notification message
   - **Returns**: Success, reminder details
   - **Difference**: Fire-and-forget notification vs full agent execution

3. **`list_routines`**
   - **Description**: Get all scheduled routines/reminders
   - **Returns**: Array of routines with name, schedule, prompt, next_run, enabled status

4. **`delete_routine`**
   - **Description**: Delete a routine by name
   - **Parameters**:
     - `name` (required): Routine name
   - **Returns**: Success/failure message

---

#### **Calendar Tools** (`calendar-tools.ts`)
**Purpose**: Manage calendar events with reminders

1. **`calendar_add`**
   - **Description**: Add calendar event with optional reminder
   - **Parameters**:
     - `title` (required): Event title
     - `start_time` (required): Time format: "tomorrow 2pm", "in 1 hour", ISO
     - `end_time` (optional): End time
     - `location` (optional): Location
     - `description` (optional): Description
     - `reminder_minutes` (optional): Minutes before to remind (default: 15)
   - **Returns**: Success, id, title, start_time, reminder_minutes

2. **`calendar_list`**
   - **Description**: List calendar events with optional date filter
   - **Parameters**:
     - `date` (optional): "today", "tomorrow", or YYYY-MM-DD
   - **Returns**: count, events array

3. **`calendar_upcoming`**
   - **Description**: Get upcoming events within N hours
   - **Parameters**:
     - `hours` (optional): Hours to look ahead (default: 24)
   - **Returns**: count, events array with id, title, start, location

4. **`calendar_delete`**
   - **Description**: Delete calendar event by ID
   - **Parameters**:
     - `id` (required): Event ID
   - **Returns**: Success/failure message

---

#### **Task Tools** (`task-tools.ts`)
**Purpose**: Manage todo items with priorities and due dates

1. **`task_add`**
   - **Description**: Add todo item to task list
   - **Parameters**:
     - `title` (required): Task title
     - `description` (optional): Task description
     - `due` (optional): Due date (e.g., "tomorrow", "friday 5pm")
     - `priority` (optional): low/medium/high (default: medium)
     - `reminder_minutes` (optional): Minutes before to remind
   - **Returns**: Success, id, title, due, priority

2. **`task_list`**
   - **Description**: List todo items
   - **Parameters**:
     - `status` (optional): pending/completed/in_progress/all (default: pending)
   - **Returns**: count, tasks array (sorted by priority + due date)

3. **`task_complete`**
   - **Description**: Mark task as completed
   - **Parameters**:
     - `id` (required): Task ID
   - **Returns**: Success/failure message

4. **`task_delete`**
   - **Description**: Delete task by ID
   - **Parameters**:
     - `id` (required): Task ID
   - **Returns**: Success/failure message

5. **`task_due`**
   - **Description**: Filter tasks by due date
   - **Parameters**:
     - `date` (optional): Date to filter by
   - **Returns**: count, tasks array

---

#### **Project Tools** (`project-tools.ts`)
**Purpose**: Manage session-scoped working directories

1. **`set_project`**
   - **Description**: Set working directory for this session
   - **Parameters**:
     - `path` (required): Absolute path to project directory
   - **Validation**: Must exist, must be directory, prevents path traversal
   - **Returns**: Success, path, note about effect on next message

2. **`get_project`**
   - **Description**: Get currently active project directory
   - **Returns**: hasProject flag, path, exists flag, defaultWorkspace

3. **`clear_project`**
   - **Description**: Reset to default workspace
   - **Returns**: Success, path to default workspace

---

#### **macOS Tools** (`macos.ts`)
**Purpose**: Native system integrations

1. **`notify`**
   - **Description**: Send native desktop notification
   - **Parameters**:
     - `title` (required): Notification title
     - `body` (optional): Notification body text
     - `subtitle` (optional): Subtitle (macOS only)
     - `silent` (optional): Suppress sound (default: false)
     - `urgency` (optional): low/normal/critical (default: normal)
   - **Returns**: Success/failure, error if applicable
   - **Behavior**: Fire-and-forget (doesn't wait for user interaction)

---

#### **Diagnostic Tools** (`diagnostics.ts`)
**Purpose**: Monitor tool execution health

- **Features**:
  - Tool execution timing
  - Timeout detection (30s interval checks)
  - Stuck tool identification
  - Periodic status logging

---

## 🖥️ MCP SERVERS

### Location: `/src/mcp/`

#### **Browser MCP Server** (`browser-server.ts`)
- **Type**: Child process MCP server
- **Protocol**: JSON-RPC 2.0 over stdin/stdout
- **Tools Exposed**:
  1. `browser` - Browser automation (see Browser Tool above)
  2. `notify` - Desktop notifications
- **Purpose**: Standalone browser automation via puppeteer-core + Chrome DevTools Protocol
- **Note**: Primarily used as fallback; SDK MCP server is preferred

#### **Project MCP Server** (`project-server.ts`)
- **Type**: Child process MCP server
- **Tools Exposed**:
  1. `set_project` - Lock working directory to project
  2. `get_project` - Get active project directory
- **Storage**: SQLite settings table
- **Purpose**: Project management via MCP protocol

---

## 🧠 MEMORY SYSTEM

### Location: `/src/memory/index.ts`

#### **MemoryManager Class**
Core persistent memory system using SQLite with embedding-based semantic search.

#### **Core Tables**:

1. **`sessions`** - Conversation threads
   - `id` (PK): Unique session ID
   - `name`: Display name
   - `mode`: 'general' or 'coder'
   - `working_directory`: Active project path
   - `telegram_linked`: Boolean
   - `telegram_group_name`: Group name if linked
   - `created_at`, `updated_at`: Timestamps

2. **`messages`** - Conversation history
   - `id` (PK), `role`, `content`
   - `timestamp`, `token_count`
   - `session_id` (FK): References sessions
   - `metadata`: JSON metadata

3. **`facts`** - Long-term memory (extracted knowledge)
   - `id` (PK), `category`, `subject`, `content`
   - `created_at`, `updated_at`
   - **Index**: Full-text search on content

4. **`chunks`** - Embedding vectors for semantic search
   - Links facts to embeddings
   - Supports semantic similarity queries

5. **`daily_logs`** - Daily journaling
   - `id` (PK), `date` (UNIQUE), `content`
   - Append-only per day

6. **`soul_aspects`** - Relationship dynamics
   - `id` (PK), `aspect` (UNIQUE), `content`
   - Records about working dynamic (not user facts)

7. **`summaries`** - Rolling message summaries
   - Used for context compaction
   - Tracks summarized message ranges

#### **Core Methods**:

**Session Management**:
- `createSession(name, mode)` - Create isolated conversation
- `getSession(id)`, `getSessionByName(name)`
- `getSessions()` - List all sessions
- `renameSession(id, name, workingDirectory)`
- `deleteSession(id)`
- `touchSession(id)` - Update last-accessed timestamp
- `getSessionMode(id)`, `setSessionMode(id, mode)` - Switch general/coder
- `getSessionWorkingDirectory(id)` - Get active project path
- `setSessionWorkingDirectory(id, path)` - Switch project

**Message Persistence**:
- `saveMessage(role, content, sessionId)` - Add to conversation
- `getRecentMessages(limit, sessionId)` - Fetch recent messages
- `getMessageCount(sessionId)` - Count messages
- `embedMessage(messageId)` - Create embedding for semantic search
- `embedRecentMessages(sessionId, limit)` - Bulk embed recent messages

**Smart Context** (context compaction):
- `getSmartContext(options)` - Build optimized context
  - Recent messages (recency)
  - Rolling summary of older messages
  - Semantically relevant messages
  - Daily logs for continuity
- **Options**:
  - `recentMessageLimit`: Number of recent messages
  - `rollingSummaryInterval`: Create summaries every N messages
  - `semanticRetrievalCount`: Top K semantically relevant
  - `currentQuery`: Search query for semantic relevance
- **Returns**: Blended context with stats

**Long-Term Memory**:
- `saveFact(category, subject, content)` - Save fact
- `getAllFacts()` - Get all facts
- `getFactsByCategory(category)` - Filter by category
- `deleteFact(id)`, `deleteFactBySubject(category, subject)`
- `searchFacts(query, category)` - Keyword search
- `searchFactsHybrid(query)` - Vector + keyword search (async)
- `getFactsForContext()` - All facts as formatted string
- `getFactsGraphData()` - Fact relationships for visualization

**Soul (Relationship Dynamics)**:
- `setSoulAspect(aspect, content)` - Record relationship learning
- `getSoulAspect(aspect)` - Get specific aspect
- `getAllSoulAspects()` - List all
- `deleteSoulAspect(aspect)`, `deleteSoulAspectById(id)`
- `getSoulContext()` - All soul aspects as formatted string

**Daily Logs**:
- `getDailyLog(date)` - Get log for specific date
- `appendToDailyLog(entry)` - Add line to today
- `getDailyLogsSince(days)` - Last N days
- `getDailyLogsContext(days)` - Formatted string of logs

**Scheduled Jobs**:
- `saveCronJob(name, schedule, prompt, ...)` - Save routine
- `getCronJobs(enabledOnly)` - List routines
- `setCronJobEnabled(name, enabled)` - Toggle routine
- `deleteCronJob(name)` - Delete routine

**Telegram Integration**:
- `linkTelegramChat(chatId, sessionId, groupName)` - Link chat to session
- `unlinkTelegramChat(chatId)` - Unlink chat
- `getSessionForChat(chatId)` - Get session for chat
- `getChatForSession(sessionId)` - Get chat for session
- `getAllTelegramChatSessions()` - List all links

#### **Embeddings System**:
- **Provider**: OpenAI embeddings API (text-embedding-3-small)
- **Storage**: Stored in SQLite as serialized float arrays
- **Similarity**: Cosine similarity with weighted hybrid search
- **Weights**: 70% vector + 30% keyword
- **Auto-embedding**: Triggered on fact save and message save (async)

#### **Context Compaction Strategy**:
- Keeps recent messages in full
- Summarizes older messages into rolling summaries
- Includes semantically relevant historical messages
- Maintains daily logs for continuity
- Reduces total tokens while preserving context

---

## ⏰ SCHEDULING & AUTOMATION

### Location: `/src/scheduler/index.ts`

#### **CronScheduler Class**
Manages scheduled jobs from SQLite database and executes them with agent.

#### **Schedule Types**:

1. **Cron Expression** - Standard cron format
   - Format: `0 9 * * *` (minute hour day month weekday)
   - Example: `0 9 * * MON` (every Monday at 9am)
   - Recurring

2. **"at" Schedule** - One-time execution
   - Formats:
     - "tomorrow 3pm"
     - "friday 2pm"
     - "in 10 minutes"
     - ISO datetime
   - Auto-deleted after run
   - `delete_after_run` = 1

3. **"every" Schedule** - Recurring intervals
   - Format: `every 30m`, `every 2h`, `every 1d`
   - Examples: `every 30 minutes`, `every 2 hours`, `every 1 day`
   - Recurring

4. **Bare Duration** - Shorthand for one-shot
   - "30m", "2h", "1d" treated as "in 30 minutes"
   - Auto-deleted after run

#### **Job Types**:

1. **Routine** - LLM-executed prompt
   - Full agent turn with all tools
   - Executes prompt at scheduled time
   - Can take action (browse, fetch, process)
   - Receives context from session
   - Returns: Agent response → routed to channel

2. **Reminder** - Simple notification
   - No LLM processing
   - Just displays message
   - Fire-and-forget

#### **Core Methods**:

- `initialize(memory, dbPath)` - Load jobs from DB
- `loadJobsFromDatabase()` - Fetch and schedule all enabled jobs
- `createJob(name, schedule, prompt)` - Add new routine
- `deleteJob(name)` - Remove routine
- `setJobEnabled(name, enabled)` - Toggle routine on/off
- `executeJob(job)` - Run routine immediately
- `checkReminders()` - Check for calendar/task reminders due
- `checkForNewJobs()` - Detect new jobs added to DB (every 60s)
- `broadcastNotification(title, message, channel)` - Route response

#### **Reminder System**:
- Checks every 30 seconds for due reminders
- **Calendar event reminders**:
  - Trigger: `event.start_time - reminder_minutes`
  - Channel: `event.channel`
  - Session: `event.session_id`
  - Sends: "Reminder: {title} at {time} ({location})"

- **Task reminders**:
  - Trigger: `task.due_date - reminder_minutes`
  - Channel: `task.channel`
  - Session: `task.session_id`
  - Sends: "Reminder: {title} ({priority})"

#### **Routing**:
- **Desktop channel**: Show notification + send to active session
- **Telegram channel**: Send message to linked chat/group
- **iOS channel**: Broadcast to connected device

#### **Job History**:
- Keeps last 100 job executions
- Track: jobName, response, channel, success, error, timestamp

---

## 🌐 BROWSER AUTOMATION

### Location: `/src/browser/`

#### **Three-Tier Architecture**:

##### **1. Electron Tier**
- **File**: `electron-tier.ts`
- **Purpose**: Hidden window rendering for JS-heavy pages
- **Uses**: Electron BrowserWindow
- **Capabilities**:
  - Navigate to URL
  - Screenshot (PNG, base64)
  - Click elements
  - Type text
  - Evaluate JavaScript
  - Extract page content (text, HTML, links, tables)
  - Scroll
  - Hover (triggers dropdowns)
  - Download files
  - Upload files
- **Limitations**:
  - No access to logged-in browser sessions
  - Cannot access user's authentication cookies
  - Single tab only

##### **2. Chrome DevTools Protocol (CDP) Tier**
- **File**: `cdp-tier.ts`
- **Purpose**: Connect to user's logged-in Chrome for authenticated workflows
- **Uses**: puppeteer-core + Chrome remote debugging protocol
- **Requirements**: Chrome running with `--remote-debugging-port=9222`
- **Capabilities**:
  - All Electron tier features
  - Access to logged-in sessions (Gmail, GitHub, etc.)
  - Multi-tab management:
    - `tabs_list` - List all open tabs
    - `tabs_open(url)` - Open new tab
    - `tabs_close(tab_id)` - Close tab
    - `tabs_focus(tab_id)` - Switch to tab
  - Cookie access
  - Network interception
- **Connection**: Auto-reconnects on disconnect, supports forced reconnect

##### **3. BrowserManager Orchestrator**
- **File**: `index.ts`
- **Class**: `BrowserManager`
- **Logic for tier selection**:
  1. Explicit tier requested → use that tier
  2. `requires_auth=true` → use CDP
  3. "Use My Browser" setting enabled → prefer CDP
  4. Already on CDP → stay on CDP
  5. Default → use Electron
- **Fallback**: If CDP fails (not explicitly requested), fall back to Electron

#### **Actions** (14 total):

| Action | Tier | Params | Output |
|--------|------|--------|--------|
| navigate | Both | url | success, url, title |
| screenshot | Both | (none) | base64 image |
| click | Both | selector, wait_for | success |
| type | Both | selector, text, wait_for | success |
| evaluate | Both | script | result, type |
| extract | Both | extract_type, extract_selector | text/html/links/tables |
| scroll | Both | direction, amount | success |
| hover | Both | selector | success |
| download | Both | selector, download_path | file path, size |
| upload | Both | selector, file_path | success |
| tabs_list | CDP | (none) | array of {id, url, title, active} |
| tabs_open | CDP | url | tab_id |
| tabs_close | CDP | tab_id | success |
| tabs_focus | CDP | tab_id | success |

#### **Extract Types**:
- **text** - Plain text content
- **html** - HTML markup
- **links** - Array of links with href, text, target
- **tables** - Array of table data with headers and rows
- **structured** - Smart extraction (combines above)

#### **Use Cases**:
- Form filling and submission
- Data scraping from authenticated pages
- Multi-step workflows (navigate → click → extract)
- Screenshot-based visual verification
- File download/upload workflows
- Tab-based multi-page workflows (CDP only)

#### **Limitations**:
- No JavaScript execution context isolation
- Synchronous operations only (no concurrent tabs in Electron)
- No cookie management API exposed
- Screenshot always full page

---

## 📱 CHANNELS & INTEGRATIONS

### Location: `/src/channels/`

#### **Base Channel Class**
Abstract base for all channel implementations.

#### **1. Desktop Channel** (built-in)
- **Mechanism**: Electron notifications + window focus
- **Messages**: Native toast notifications
- **Callbacks**: Message input, session switching

#### **2. Telegram Channel**
- **File**: `/telegram/index.ts`
- **Type**: Full bot with advanced features
- **Library**: grammy (modern Telegram bot framework)

##### **Telegram Features**:

**Message Types**:
- Text messages
- Photos (with captions)
- Voice messages (auto-transcribed)
- Audio files
- Documents (PDF, code, CSV, etc.)
- Locations (with reverse geocoding)
- Media groups (multiple files)

**Commands**:
- `/start` - Initialize bot
- `/status` - Show agent status
- `/facts` - List remembered facts
- `/clear` - Clear conversation
- `/link <session>` - Link group to session
- `/unlink` - Unlink group
- `/mychatid` - Show chat ID

**Features**:
1. **Message Reactions** - React to agent responses with emoji
2. **Inline Keyboards** - Interactive buttons with callbacks
3. **Reply Keyboards** - Persistent button grids
4. **Typing Indicator** - Show "typing..." while processing
5. **Document Processing**:
   - PDF extraction
   - Code syntax highlighting
   - CSV parsing
6. **Location Handling**:
   - Reverse geocoding
   - Coordinate extraction
7. **Media Groups** - Handle batched photos/documents
8. **Edit Detection** - Detect edited messages
9. **Authorized Users** - User ID allowlist for security
10. **Multi-Session Linking** - Link groups to isolated sessions

**Formatting**:
- Markdown to Telegram HTML conversion
- Message splitting for >4096 char limit
- Code block formatting
- Link preservation

**Middleware**:
- **Auth Middleware** - User ID validation
- **Tracking Middleware** - Message analytics

##### **Message Flow**:
```
Telegram User → grammy handler → format message → 
  AgentManager.processMessage() → format response → 
  Telegram API → User receives
```

#### **3. iOS Channel**
- **File**: `/ios/index.ts`
- **Type**: WebSocket-based mobile companion
- **Dual Mode**:

**Relay Mode** (Default)
- Connects to cloud relay server for remote access
- URL: `wss://pocket-agent-relay.buzzbeamaustralia.workers.dev`
- Instance ID for identification
- Works across networks (no port forwarding)
- Auto-reconnect on wake/unlock

**Local Mode**
- Runs local WebSocket server
- Default port: 7888
- LAN-only connections
- No external relay needed

##### **iOS Handlers** (25+ total):

**Core Messaging**:
- Message handling
- History retrieval
- Chat info

**Session Management**:
- List sessions
- Create/delete sessions
- Switch between sessions

**Model & Settings**:
- List available models
- Switch models
- Get/set agent mode
- Get customizations
- Save personalization

**Memory**:
- List facts with search
- Delete facts
- Daily logs retrieval
- Soul aspects list/delete

**Automation**:
- List routines
- Create routine
- Delete routine
- Toggle routine enabled
- Run routine immediately

**Tools**:
- Task management (list/add/complete/delete/filter)
- Calendar management (list/add/delete/upcoming)
- Workflow execution

**Status & Control**:
- Stop message processing
- Clear conversation
- Get app info
- Receive status updates

##### **Pairing**:
- 6-digit pairing code generation
- One-time authentication
- Device tracking with IDs

##### **Notifications**:
- Push notifications
- Desktop sync messages
- Real-time updates

---

## ⚙️ SETTINGS & CONFIGURATION

### Location: `/src/settings/index.ts`

#### **SettingsManager Class**
SQLite-backed settings with encryption for sensitive values.

#### **Storage**:
- **Table**: `settings` (key/value pairs)
- **Encryption**: Electron's safeStorage API (OS keychain)
- **Categories**: Organized in SQLite

#### **Settings Schema** (60+ settings):

##### **Authentication Settings**:
- `auth.method` - 'api_key' or 'oauth'
- `auth.oauthToken` - OAuth access token (encrypted)
- `auth.refreshToken` - OAuth refresh token (encrypted)
- `auth.tokenExpiresAt` - Token expiry timestamp

##### **API Keys** (all encrypted):
- `anthropic.apiKey` - Anthropic API key
- `openai.apiKey` - OpenAI API key (for embeddings + images)
- `moonshot.apiKey` - Moonshot/Kimi API key
- `glm.apiKey` - Z.AI GLM API key

##### **Agent Settings**:
- `agent.model` - Default model (claude-opus-4-7)
- `agent.mode` - 'general' or 'coder'
- `agent.thinkingLevel` - none/minimal/normal/extended

##### **Telegram Settings**:
- `telegram.botToken` - Bot token (encrypted)
- `telegram.allowedUserIds` - User ID allowlist (JSON array)
- `telegram.apiUrl` - Custom API base URL
- `telegram.webhookPath` - Webhook path for updates
- `telegram.webhookSecret` - Webhook secret (encrypted)

##### **iOS Settings**:
- `ios.relayUrl` - Relay server URL
- `ios.instanceId` - Unique instance ID
- `ios.port` - Local server port

##### **Browser Settings**:
- `browser.useMyBrowser` - Enable CDP tier ('true'/'false')
- `browser.cdpUrl` - Chrome DevTools URL

##### **Model Provider Settings**:
- `provider.default` - Default provider (anthropic/moonshot/glm)
- `provider.moonshot.baseUrl` - Custom Moonshot base URL
- `provider.glm.baseUrl` - Custom GLM base URL

##### **UI/Theme Settings**:
- `ui.theme` - dark/light
- `ui.fontSize` - Font size
- `ui.compactMode` - Enable compact layout

##### **Personalization Settings**:
- `personalize.name` - User name
- `personalize.timezone` - Timezone
- `personalize.personality` - Agent personality description
- `personalize.communityGuidelines` - Custom guidelines
- `personalize.systemPromptCustom` - Custom system prompt override

##### **Feature Flags**:
- `features.telegramEnabled` - Enable Telegram channel
- `features.iosEnabled` - Enable iOS channel
- `features.memoryEnabled` - Enable memory system
- `features.schedulerEnabled` - Enable scheduler
- `features.browserEnabled` - Enable browser automation

#### **Core Methods**:
- `get(key)` - Retrieve setting value
- `set(key, value)` - Set value (encrypts if configured)
- `has(key)` - Check if setting exists
- `remove(key)` - Delete setting
- `getAll()` - Get all settings
- `getCategory(category)` - Get settings by category
- `validateSetting(key, value)` - Run validation
- `export()` - Export settings (with encryption)
- `import(data)` - Import settings

#### **Themes**:
- **Location**: `themes.ts`
- **Builtin Themes**: Dracula, Nord, Catppuccin, Solarized
- **Custom Themes**: CSS variable override capability

---

## 🔐 AUTHENTICATION

### Location: `/src/auth/oauth.ts`

#### **OAuth Implementation**
Claude OAuth for Anthropic API access without storing long-lived API keys.

#### **Flow**:
1. **PKCE Generation** - Create code challenge/verifier pair
2. **Browser Auth** - User visits Anthropic OAuth consent page
3. **Manual Code Entry** - User copies authorization code from browser
4. **Token Exchange** - Exchange code for access token + refresh token
5. **Token Refresh** - Auto-refresh expired tokens

#### **Configuration**:
- **Client ID**: 9d1c250a-e61b-44d9-88ed-5944d1962f5e
- **Authorize URL**: https://claude.ai/oauth/authorize
- **Token URL**: https://console.anthropic.com/v1/oauth/token
- **Redirect URI**: https://console.anthropic.com/oauth/code/callback
- **Scopes**: org:create_api_key, user:profile, user:inference

#### **Methods**:
- `startFlow()` - Open browser for user auth
- `submitCode(code)` - Exchange authorization code
- `getAccessToken()` - Get fresh access token (auto-refresh)
- `revokeToken()` - Revoke tokens

#### **Token Storage**:
- Encrypted in SQLite via SettingsManager
- Auto-refresh before expiry
- Fallback to API key if OAuth fails

---

## 🤖 AGENT & CHAT ENGINE

### Location: `/src/agent/`

#### **AgentManager Class** (`index.ts`)
Main orchestrator for running agent conversations.

#### **Core Responsibilities**:
1. Session lifecycle management
2. Tool configuration and validation
3. Multi-provider setup (Anthropic, Moonshot, GLM)
4. Error handling and formatting
5. Memory and scheduler initialization
6. Channel integration

#### **Session Modes**:

**Coder Mode** (default)
- Full Claude Agent SDK integration
- All code execution tools
- Terminal access
- File operations
- Debugging tools
- Resource: `PersistentSDKSession`

**General Mode**
- Lightweight in-process agent loop
- No code execution
- Memory + tools only
- Resource: `ChatEngine`

#### **Process Message Flow**:
1. Validate input (text/images/attachments)
2. Set session context
3. Load/create session
4. Build system prompt (guidelines + facts + soul + customizations)
5. Invoke agent (SDK or ChatEngine)
6. Save response to memory
7. Broadcast to channels
8. Return to caller

#### **System Prompt Building**:
- **System Guidelines** (`config/system-guidelines.ts`) - Developer-controlled instructions
  - Memory usage (remember/forget/search)
  - Soul system usage
  - Routine vs reminder distinction
  - CLI integration guide
  - Daily log usage
- **Facts Context** - All user facts (formatted as markdown)
- **Soul Context** - Relationship dynamics
- **Daily Logs** - Last 3 days of logs
- **Customizations** - User personality + community guidelines

#### **Key Classes**:

**PersistentSDKSession** (`persistent-session.ts`)
- Wraps Claude Agent SDK session
- Coder mode agent
- Handles tool execution
- Persists across turns
- Lifecycle: create → turn → close

**ChatEngine** (`chat-engine.ts`)
- Lightweight alternative for general mode
- Uses @kenkaiiii/gg-agent library
- Simpler tool set
- In-process execution
- Suitable for quick queries

#### **Methods**:
- `processMessage(sessionId, message, ...)` - Run agent turn
- `createSession(name, mode)` - Create conversation thread
- `deleteSession(id)` - Delete session
- `listSessions()` - Get all sessions
- `switchSession(id)` - Change active session
- `setupChannels(telegram, ios)` - Register channel callbacks
- `getProjectRoot()` - Get workspace root
- `flagProjectSwitch(sessionId)` - Flag session for project change

#### **Error Handling**:
- Comprehensive error mapping to user-friendly messages
- Distinguishes user errors (auth, billing) from system errors
- Includes error codes for debugging
- Suggests remedial actions

#### **Tools Configuration**:
- **SDK Tools** (coder mode):
  - File operations
  - Terminal (bash)
  - Computer use (Docker)
  - Browser automation
- **Custom Tools** (both modes):
  - Memory tools
  - Soul tools
  - Scheduler tools
  - Calendar tools
  - Task tools
  - Project tools
  - macOS tools

---

## 🎨 USER INTERFACE

### Location: `/ui/`

#### **HTML Templates** (Electron renderer):

1. **chat.html** (Main)
   - Chat interface
   - Message display/input
   - Session switcher
   - Model selector
   - Thinking display
   - Status indicators
   - Suggested actions

2. **settings.html**
   - API key configuration
   - Model selection
   - Theme selection
   - Telegram bot setup
   - iOS relay configuration
   - Browser tier selection
   - Privacy & export options
   - About & updates

3. **facts.html**
   - Memory browser
   - Fact search
   - Category filters
   - Add/delete facts
   - Export facts
   - Import backup

4. **soul.html**
   - Soul aspects list
   - Relationship dynamics
   - Edit/delete aspects
   - Working style notes

5. **daily-logs.html**
   - Daily journal view
   - Date selector
   - Log entry editor
   - 3-day history

6. **cron.html** (Routines & Reminders)
   - List scheduled routines
   - Create routine wizard
   - Schedule syntax helper
   - View next run times
   - Enable/disable toggle
   - Delete routine

7. **customize.html**
   - Personality editor
   - System prompt preview
   - Guidelines editor
   - Test responses

8. **facts-graph.html**
   - Visual graph of facts
   - Node relationships
   - Interactive exploration
   - Category coloring
   - Search highlighting

9. **setup.html**
   - Initial onboarding
   - Credential entry
   - Service selection
   - Step-by-step guides

10. **splash.html**
    - Launch splash screen
    - Loading indicators
    - Version display

---

## 📊 DATABASE SCHEMA

### Location: SQLite (default: `~/Library/Application Support/pocket-agent/pocket-agent.db`)

```sql
-- Sessions (isolated conversation threads)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT DEFAULT 'general',
  working_directory TEXT,
  telegram_linked BOOLEAN DEFAULT 0,
  telegram_group_name TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- Messages (conversation history)
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp TEXT,
  token_count INTEGER,
  session_id TEXT REFERENCES sessions(id),
  metadata TEXT
);

-- Facts (long-term memory)
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  subject TEXT,
  content TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

-- Embeddings (vector search)
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_id INTEGER REFERENCES facts(id),
  embedding BLOB, -- serialized float array
  created_at TEXT
);

-- Daily logs
CREATE TABLE daily_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE,
  content TEXT,
  updated_at TEXT
);

-- Soul aspects
CREATE TABLE soul_aspects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aspect TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

-- Scheduled jobs (routines & reminders)
CREATE TABLE cron_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  schedule_type TEXT DEFAULT 'cron',
  schedule TEXT,
  run_at TEXT,
  interval_ms INTEGER,
  prompt TEXT NOT NULL,
  channel TEXT DEFAULT 'desktop',
  enabled BOOLEAN DEFAULT 1,
  delete_after_run BOOLEAN DEFAULT 0,
  next_run_at TEXT,
  session_id TEXT REFERENCES sessions(id),
  job_type TEXT DEFAULT 'routine',
  created_at TEXT,
  updated_at TEXT
);

-- Calendar events
CREATE TABLE calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  location TEXT,
  reminder_minutes INTEGER DEFAULT 15,
  reminded BOOLEAN DEFAULT 0,
  channel TEXT DEFAULT 'desktop',
  session_id TEXT REFERENCES sessions(id),
  created_at TEXT,
  updated_at TEXT
);

-- Tasks/todos
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',
  reminder_minutes INTEGER,
  reminded BOOLEAN DEFAULT 0,
  channel TEXT DEFAULT 'desktop',
  session_id TEXT REFERENCES sessions(id),
  created_at TEXT,
  updated_at TEXT
);

-- Telegram chat session links
CREATE TABLE telegram_sessions (
  chat_id INTEGER PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  group_name TEXT,
  created_at TEXT
);

-- Settings (key-value store)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encrypted BOOLEAN DEFAULT 0,
  category TEXT,
  updated_at TEXT
);
```

---

## 🔄 DATA FLOW DIAGRAMS

### Message Processing (Desktop)
```
User Input
    ↓
[chat.html] Input handler
    ↓
IPC → main.ts
    ↓
AgentManager.processMessage()
    ↓
Build System Prompt (facts + soul + guidelines)
    ↓
Create/Load Session
    ↓
Invoke Agent (SDK or ChatEngine)
    ↓
Tool Loop (memory, calendar, browser, etc.)
    ↓
Save Response to Memory
    ↓
Broadcast to Channels
    ↓
IPC ← Response
    ↓
[chat.html] Display message
```

### Telegram Message Flow
```
Telegram User
    ↓
[grammy handler]
    ↓
Format message
    ↓
AgentManager.processMessage(sessionId, message)
    ↓
[Same as above]
    ↓
TelegramBot.sendMessage(chatId, response)
    ↓
Telegram API
    ↓
User sees reply
```

### iOS Message Flow
```
iOS App (WebSocket)
    ↓
[iOSChannel backend]
    ↓
Handler routes to AgentManager
    ↓
[Same as above]
    ↓
iOSChannel.broadcast() / sendToDevice()
    ↓
iOS App (WebSocket)
    ↓
App displays message
```

### Scheduler Execution Flow
```
CronScheduler (every 30-60s)
    ↓
Check due jobs
    ↓
For each job:
  - Build prompt
  - Call AgentManager.processMessage()
  - Get response
  - Route to channel (desktop/telegram/ios)
    ↓
Channel sends to user
```

---

## 🏗️ ARCHITECTURE SUMMARY

### Layers:

**Layer 1: UI**
- Electron renderer (HTML/CSS/JS in multiple templates)
- IPC communication with main process
- Real-time updates via EventEmitter

**Layer 2: Main Process**
- Electron main.ts
- IPC handlers
- Channel instantiation
- Lifecycle management

**Layer 3: Agent Core**
- AgentManager (orchestration)
- PersistentSDKSession (coder mode)
- ChatEngine (general mode)
- Tool definitions & handlers

**Layer 4: Systems**
- MemoryManager (SQLite + embeddings)
- CronScheduler (job execution)
- BrowserManager (Electron + CDP tiers)
- SettingsManager (encrypted config)
- Channels (Desktop, Telegram, iOS)

**Layer 5: Storage**
- SQLite database
- Electron safeStorage (encryption)
- File system (screenshots, downloads)

### Key Design Patterns:

1. **Singleton Pattern**:
   - AgentManager, BrowserManager, MemoryManager, SettingsManager
   - Ensures single instance per process

2. **Factory Pattern**:
   - Channel creation (Desktop, Telegram, iOS)
   - MCP server builders

3. **Observer Pattern**:
   - EventEmitter for status updates
   - Channel callbacks for message sync

4. **Repository Pattern**:
   - MemoryManager abstracts SQLite access
   - Unified interface for persistence

5. **Strategy Pattern**:
   - Browser tier selection (Electron vs CDP)
   - Agent mode selection (SDK vs ChatEngine)

---

## 📈 EXTENSIBILITY POINTS

### Adding a New Tool:

1. Create `/src/tools/my-tool.ts`
2. Export definition + handler:
   ```typescript
   export function getMyToolDefinition() { ... }
   export async function handleMyTool(input) { ... }
   ```
3. Add to `/src/tools/index.ts`:
   ```typescript
   const myTools = getMyTools();
   for (const tool of myTools) { tools.push(tool); }
   ```

### Adding a New Channel:

1. Create `/src/channels/my-channel/index.ts`
2. Extend `BaseChannel`
3. Implement `start()`, `stop()`, `send()` methods
4. Register in main process
5. Add message handlers and callbacks

### Adding a New MCP Server:

1. Create `/src/mcp/my-server.ts`
2. Implement JSON-RPC 2.0 protocol
3. Define tools via `tools/list` method
4. Implement `tools/call` handler
5. Register in `buildMCPServers()`

---

## 🎯 QUICK FEATURE REFERENCE

| Feature | Tool | Command | Result |
|---------|------|---------|--------|
| Save fact | remember | remember category subject content | Saved to memory |
| Search memory | memory_search | memory_search "query" | Top 6 relevant facts |
| Create routine | create_routine | create_routine name schedule prompt | Job scheduled |
| Set project | set_project | set_project /path/to/project | Session directory changed |
| Add task | task_add | task_add "title" due:"friday" | Todo added |
| Browser screenshot | browser | browser action:screenshot | Image saved |
| Get calendar | calendar_list | calendar_list date:"today" | Events returned |
| Send notification | notify | notify title body | Toast shown |
| Log entry | daily_log | daily_log "what happened" | Logged to today |
| Record soul | soul_set | soul_set aspect content | Relationship learned |

---

## 📝 CONCLUSION

**Pocket Agent** is a sophisticated AI assistant desktop application with:

- **45+ tools** across memory, scheduling, calendar, tasks, browser automation, and system integration
- **3 communication channels** (Desktop, Telegram, iOS) with full feature parity
- **Persistent memory system** with semantic search and relationship tracking
- **Scheduled automation** with cron/natural language scheduling
- **Browser automation** with intelligent tier selection
- **Multi-session isolation** for keeping contexts separate
- **Encryption at rest** for sensitive configuration
- **Extensible architecture** supporting custom tools and MCP servers

The system is built for **long-term usefulness** - the more you use it, the better it becomes as it learns your facts, preferences, working style, and relationship dynamics.

---

**Last Updated**: March 11, 2025  
**Repository**: https://github.com/KenKaiii/pocket-agent
