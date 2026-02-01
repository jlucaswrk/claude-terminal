# Claude Terminal

Control Claude Code from WhatsApp. A terminal in your pocket.

## Quick Start

```bash
# Install
bun install

# Configure
cp .env.example .env
# Edit .env with your Kapso credentials

# Expose via Tailscale
tailscale funnel 3000

# Run
bun run dev
```

## How it works

1. You send a message on WhatsApp
2. Kapso forwards it to your Mac via Tailscale Funnel
3. Message goes to Claude Code CLI
4. Response comes back to WhatsApp

No servers, no complex infra. Just your Mac and WhatsApp.

## Requirements

- [Bun](https://bun.sh)
- [Tailscale](https://tailscale.com) with Funnel enabled
- [Kapso](https://kapso.ai) account for WhatsApp API
- Claude Code CLI installed

## License

MIT
