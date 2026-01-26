# Pocket Agent

A persistent personal AI assistant that runs as a desktop application on macOS. Pocket Agent maintains one continuous conversation across all sessions, remembering everything discussed.

## Features

- **Persistent Memory**: All conversations stored locally in SQLite with automatic summarization
- **Fact Extraction**: Learns and remembers important information about you
- **Desktop Chat UI**: Clean, always-available chat interface via system tray
- **Telegram Integration**: Access your assistant from anywhere via Telegram bot
- **Scheduled Tasks**: Set up cron jobs for recurring tasks and reminders
- **File & Terminal Access**: Full access to your filesystem and terminal
- **Browser Automation**: Web scraping and automation capabilities
- **Privacy-First**: All data stays on your machine

## Installation

### Download

Download the latest release from the [Releases](https://github.com/KenKaiii/pocket-agent/releases) page:

| Architecture | Download |
|--------------|----------|
| Apple Silicon (M1/M2/M3) | [Pocket Agent-arm64.dmg](https://github.com/KenKaiii/pocket-agent/releases/latest/download/Pocket.Agent-1.0.0-arm64.dmg) |
| Intel Mac | [Pocket Agent-x64.dmg](https://github.com/KenKaiii/pocket-agent/releases/latest/download/Pocket.Agent-1.0.0-x64.dmg) |

### Install

1. Open the downloaded DMG file
2. Drag Pocket Agent to your Applications folder
3. Launch Pocket Agent from Applications
4. The app will appear in your system tray (menu bar)

## Initial Setup

### API Key

Pocket Agent requires an Anthropic API key:

1. Get your API key from [console.anthropic.com](https://console.anthropic.com)
2. On first launch, you'll be prompted to enter your API key
3. The key is stored securely in your system keychain

### Telegram (Optional)

To access your assistant via Telegram:

1. Create a bot with [@BotFather](https://t.me/botfather) on Telegram
2. Copy the bot token
3. Open Pocket Agent settings (click tray icon > Settings)
4. Enter your Telegram bot token
5. Start a chat with your bot and send `/start`

## Usage

### Desktop Chat

- Click the tray icon to open the chat window
- Type your message and press Enter or click Send
- The assistant remembers your entire conversation history

### Telegram

Send messages to your Telegram bot from any device. Commands:

- `/start` - Initialize the bot
- `/status` - Check connection status
- `/facts` - View remembered facts
- `/clear` - Clear conversation history

### Scheduled Tasks

Set up recurring tasks via the tray menu:

1. Click tray icon > Cron Jobs
2. Add a new job with:
   - **Name**: Unique identifier
   - **Schedule**: Cron expression (e.g., `0 9 * * *` for 9 AM daily)
   - **Prompt**: What the assistant should do
   - **Channel**: Where to send the response (desktop/telegram)

### Memory System

The assistant automatically:

- Stores all conversations
- Extracts and remembers important facts
- Summarizes older conversations to maintain context
- References past discussions naturally

You can view stored facts via the Settings menu or `/facts` command.

## Configuration

### Identity File

Customize your assistant's personality by creating `~/.my-assistant/identity.md`:

```markdown
# My Assistant

You are Alex, a helpful and friendly assistant.

## About the User
- Name: John
- Location: San Francisco
- Interests: Programming, hiking, coffee
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Yes |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | No |
| `TELEGRAM_ALLOWED_USERS` | Comma-separated chat IDs | No |
| `CDP_URL` | Chrome DevTools Protocol URL | No |

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
# Clone the repository
git clone https://github.com/KenKaiii/pocket-agent.git
cd pocket-agent

# Install dependencies
npm install

# Start in development mode
npm run dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Build and run in development |
| `npm run build` | Compile TypeScript |
| `npm run start` | Build and start the app |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Type check with TypeScript |
| `npm run test` | Run tests |
| `npm run dist` | Build distributable |
| `npm run dist:local` | Build unsigned for local testing |

### Project Structure

```
pocket-agent/
├── src/
│   ├── main/          # Electron main process
│   ├── agent/         # Claude Agent SDK integration
│   ├── memory/        # SQLite persistence
│   ├── channels/      # Telegram integration
│   ├── scheduler/     # Cron job manager
│   ├── browser/       # Browser automation
│   ├── tools/         # Custom tools
│   └── config/        # Configuration
├── ui/                # HTML interfaces
├── assets/            # Icons and static files
└── build/             # Build configuration
```

## Privacy

- All data is stored locally on your machine
- Conversations are sent to Anthropic's API for processing
- No data is shared with third parties
- API keys are stored in your system keychain

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run lint && npm run typecheck`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- Powered by [Anthropic's Claude](https://anthropic.com)
- Desktop framework: [Electron](https://electronjs.org)
