# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun run dev                    # Hot reload development server
bun run start                  # Production server

# Testing
bun test                       # Run all tests
bun test <pattern>             # Run tests matching pattern (e.g., bun test agent)
bun test --only                # Run tests marked with test.only()
bun test -t "test name regex"  # Run tests matching name pattern

# Production (PM2)
pm2 logs claude-terminal       # View logs
pm2 restart claude-terminal --update-env  # Restart with new env vars
```

## Architecture

WhatsApp/Telegram bot that spawns independent Claude Code agent sessions. Each agent maintains its own SDK session and conversation context.

### Request Flow

```
WhatsApp/Telegram → Webhook (index.ts)
                         ↓
              UserContextManager (multi-step flows)
                         ↓
                   AgentManager (CRUD)
                         ↓
              QueueManager + Semaphore (concurrency)
                         ↓
              ClaudeTerminal (SDK sessions)
                         ↓
                   Storage (file upload)
                         ↓
              WhatsApp/Telegram response
```

### Key Patterns

**State Management**: Three persistence files track different concerns:
- `.claude-terminal-state.json` - Agent definitions and outputs
- `.claude-terminal-sessions.json` - SDK session IDs
- `.claude-terminal-preferences.json` - User mode preferences

**Multi-Step Flows**: `UserContextManager` tracks conversation state for flows that span multiple messages (agent creation, configuration, onboarding). The `currentFlow` and `flowState` fields in `UserContext` define the state machine.

**Queue Priority**: Tasks ordered by priority (high=0, medium=1, low=2) then timestamp. `Semaphore` limits concurrent executions.

**Dual Platform Support**:
- WhatsApp (Kapso API) via `whatsapp.ts` - interactive menus, buttons, lists
- Telegram Bot API via `telegram.ts` - inline keyboards, callbacks
- Telegram groups can be linked to agents via `groupId`/`telegramChatId`

**Agent Modes**:
- `conversational` - Standard Claude chat
- `ralph` - Autonomous loop with iteration limits (see `ralph-loop-manager.ts`)

**File Detection**: `terminal.ts` monitors Write tool usage to detect created files, uploads to Kapso Media, sends to user.

### Type System

Core types in `types.ts`:
- `Agent` - Session definition with status, priority, outputs
- `UserContext` - Conversation state machine
- `QueueTask` - Execution queue item
- `GroupOnboardingState` - Telegram group setup flow

Serialized variants (`SerializedAgent`, etc.) use ISO strings for dates - required for JSON persistence.
