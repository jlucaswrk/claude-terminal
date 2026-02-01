# Claude Terminal

Control Claude Code from WhatsApp. A terminal in your pocket.

Inspired by [Telminal](https://github.com/fristhon/telminal) (Telegram terminal), but for WhatsApp + Claude Code.

## Why

I have Claude Code running on my Mac and want to control it remotely from WhatsApp - as a pure terminal, not a fancy assistant. Just send commands, get output.

## Architecture

```
📱 WhatsApp
     │
     ▼
[Kapso Webhook] ──► Tailscale Funnel ──► Mac (local)
                                              │
                                              ▼
                                       Claude Code CLI
                                              │
                                              ▼
                                       Output → Kapso → 📱
```

**No servers, no cloud, no ngrok** - just your Mac with Tailscale.

## Quick Start

```bash
# Install
bun install

# Configure
cp .env.example .env
# Edit .env with your Kapso credentials

# Expose via Tailscale Funnel
tailscale funnel 3000

# Run
bun run dev
```

## Setup Details

### 1. Tailscale Funnel

Instead of ngrok, we use Tailscale Funnel for a stable, free HTTPS endpoint:

```bash
# Enable funnel (one time)
tailscale funnel 3000
```

This gives you a URL like `https://your-mac.tail1234.ts.net`

### 2. Kapso Webhook

Configure your Kapso webhook to point to:
```
https://your-mac.tail1234.ts.net/webhook
```

### 3. Environment Variables

```bash
KAPSO_API_KEY=           # From Kapso dashboard
KAPSO_PHONE_NUMBER_ID=   # Your WhatsApp number ID in Kapso
KAPSO_WEBHOOK_SECRET=    # For webhook verification
USER_PHONE_NUMBER=       # Your phone in E.164 format (+5581...)
PORT=3000
```

## Usage

Just send messages to your WhatsApp number. They go straight to Claude Code.

Examples:
- `ls -la` - list files
- `create a hello world in python` - Claude does it
- `/help` - Claude Code help
- Any Claude Code command works

## Requirements

- [Bun](https://bun.sh)
- [Tailscale](https://tailscale.com) with Funnel enabled
- [Kapso](https://kapso.ai) account for WhatsApp API
- Claude Code CLI installed and configured

## Design Decisions

| Decision | Why |
|----------|-----|
| Tailscale Funnel | Stable URL, no reconnections like ngrok |
| No database | Pure terminal, no state needed |
| No queues | One conversation at a time, simple |
| Kapso | Already had it configured, works well |
| Bun | Fast, simple, good DX |

## License

MIT
