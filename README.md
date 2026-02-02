# Claude Terminal

Control multiple Claude Code agents from WhatsApp.

Inspired by [Telminal](https://github.com/fristhon/telminal), evolved into a multi-agent system.

## Features

- **Multi-agent system**: Create independent agents for different projects
- **Persistent sessions**: Context maintained between messages via Claude SDK
- **Priority queue**: Control which agents execute first (high/medium/low)
- **Concurrency control**: Limit how many agents run simultaneously
- **File generation**: Receive spreadsheets, PDFs, images created by Claude
- **Web capabilities**: Firecrawl and Browser MCP for scraping and automation
- **Interactive menus**: WhatsApp buttons and lists for easy navigation
- **Error recovery**: Retry/ignore buttons when tasks fail

## Architecture

```
                                    ┌─────────────────────────────────────────┐
                                    │              Claude Terminal            │
                                    ├─────────────────────────────────────────┤
📱 WhatsApp ──→ Kapso ──→ Tailscale │  Webhook Handler                        │
                                    │         │                               │
                                    │         ▼                               │
                                    │  AgentManager ←→ UserContextManager     │
                                    │         │                               │
                                    │         ▼                               │
                                    │  QueueManager ←→ Semaphore              │
                                    │         │                               │
                                    │         ▼                               │
                                    │  Claude SDK + MCP Servers               │
                                    │         │                               │
                                    │         ▼                               │
                                    │  Storage (Kapso Media)                  │
                                    └─────────────────────────────────────────┘
                                              │
📱 WhatsApp ←── Kapso ←── text/images/documents
```

**No cloud servers** - runs on your Mac with Tailscale Funnel.

## Quick Start

```bash
# Install
bun install

# Configure
cp .env.example .env
# Edit with your credentials

# Expose via Tailscale
tailscale funnel 3000

# Run
bun run dev
```

## Environment Variables

```env
KAPSO_API_KEY=xxx              # From Kapso dashboard
KAPSO_PHONE_NUMBER_ID=xxx      # Your WhatsApp number ID
KAPSO_WEBHOOK_SECRET=xxx       # For webhook verification
USER_PHONE_NUMBER=+5511...     # Authorized phone (E.164 format)
```

## Usage

### First Time
Send any message → "General" agent created automatically → Choose model (Haiku/Opus)

### Commands

| Command | Description |
|---------|-------------|
| `/` | Main menu (agents, settings) |
| `/reset` | Clear agent session |
| `/compact` | Compact conversation context |
| `/help` | Show help |

### Agents

Each agent has:
- **Name**: Your identifier (e.g., "API Backend")
- **Workspace**: Optional working directory
- **Priority**: high/medium/low for queue ordering
- **History**: Last 10 interactions

### Models

- **Haiku**: Fast and economical
- **Opus**: More capable and detailed

## File Support

Claude can create files that are automatically sent to you:

| Type | Extensions |
|------|------------|
| Spreadsheets | .xlsx, .xls, .csv |
| Documents | .pdf, .docx, .doc, .txt |
| Data | .json, .xml |
| Images | .png, .jpg, .gif |
| Media | .mp4, .mp3, .wav |

## MCP Servers

Built-in integrations:
- **Firecrawl**: Web scraping and crawling
- **Browser MCP**: Browser automation and screenshots
- **Auggie**: Augment code context

## Project Structure

```
src/
├── index.ts              # Webhook handler and orchestration
├── terminal.ts           # Claude SDK wrapper with file detection
├── agent-manager.ts      # Agent CRUD and persistence
├── queue-manager.ts      # Priority queue processing
├── semaphore.ts          # Concurrency control
├── whatsapp.ts           # Kapso client (menus, buttons, media)
├── storage.ts            # Kapso Media upload
├── user-context-manager.ts  # Multi-step conversation flows
├── persistence.ts        # State serialization
└── types.ts              # TypeScript interfaces
```

## Tests

```bash
bun test
```

59 unit tests covering all core components.

## Requirements

- [Bun](https://bun.sh) runtime
- [Tailscale](https://tailscale.com) with Funnel enabled
- [Kapso](https://kapso.ai) for WhatsApp API
- Claude Code CLI

## Design Decisions

| Decision | Why |
|----------|-----|
| Multi-agent | Different contexts for different projects |
| Priority queue | Important tasks first |
| Semaphore | Control resource usage |
| Kapso Media | Send files directly via WhatsApp |
| Tailscale Funnel | Stable URL, no ngrok reconnections |
| Bun | Fast runtime, good DX |

## License

MIT
