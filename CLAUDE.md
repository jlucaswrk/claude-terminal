# Claude Terminal

WhatsApp as a terminal for Claude Code. Send messages, get responses. That's it.

## Architecture

```
WhatsApp → Kapso → Tailscale Funnel → Local server → Claude Code CLI
                                                           ↓
WhatsApp ← Kapso ← ─────────────────────────────── Output ─┘
```

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start with hot reload
bun run start        # Production start
```

## Setup

1. Copy `.env.example` to `.env` and fill in values
2. Run `tailscale funnel 3000` to expose locally
3. Configure Kapso webhook to your Tailscale Funnel URL
4. Start the server: `bun run dev`

## Files

- `src/index.ts` - HTTP server, webhook handler
- `src/terminal.ts` - Claude Code process wrapper
- `src/whatsapp.ts` - Kapso API client
