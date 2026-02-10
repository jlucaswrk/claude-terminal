# Remove WhatsApp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all WhatsApp/Kapso code, making the bot Telegram-only with env-var whitelist access control.

**Architecture:** Delete WhatsApp files entirely (whatsapp.ts, ronin-agent.ts, message-router.ts). Simplify queue-manager to Telegram-only routing. Replace user-phone auth with ALLOWED_TELEGRAM_USERNAMES env var. Auto-register UserPreferences on first authorized access.

**Tech Stack:** TypeScript, Bun, Hono, Telegram Bot API, bun:test

---

### Task 1: Delete WhatsApp-only files

**Files:**
- Delete: `src/whatsapp.ts`
- Delete: `src/ronin-agent.ts`
- Delete: `src/message-router.ts`
- Delete: `src/__tests__/whatsapp.test.ts`
- Delete: `src/__tests__/whatsapp-groups.test.ts`
- Delete: `src/__tests__/whatsapp-send-groups.test.ts`
- Delete: `src/__tests__/whatsapp-ui-groups.test.ts`
- Delete: `src/__tests__/integration-onboarding.test.ts`

**Step 1: Delete all WhatsApp-only files**

```bash
rm src/whatsapp.ts src/ronin-agent.ts src/message-router.ts
rm src/__tests__/whatsapp.test.ts src/__tests__/whatsapp-groups.test.ts src/__tests__/whatsapp-send-groups.test.ts src/__tests__/whatsapp-ui-groups.test.ts src/__tests__/integration-onboarding.test.ts
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: delete WhatsApp-only files (whatsapp.ts, ronin-agent.ts, message-router.ts, tests)"
```

---

### Task 2: Clean up types.ts

**Files:**
- Modify: `src/types.ts`

**Step 1: Remove WhatsApp-specific types and fields**

Remove/modify these items:
- Delete `UserMode` type (line 57): `export type UserMode = 'ronin' | 'dojo';`
- Delete `Agent.groupId` field (line 86): `groupId?: string;`
- Delete `SerializedAgent.groupId` field (line 277): `groupId?: string;`
- Simplify `UserPreferences.mode` — remove the field entirely, along with `onboardingComplete`
- Simplify `SerializedUserPreferences` to match
- Remove `UserMode` from comment on line 54-56
- Remove `'onboarding'` from `UserContext.currentFlow` union (line 139)
- Remove `userMode?: UserMode` from `flowData` (line 150)
- Remove `telegramUsername?: string` from `flowData` (line 151) — this was only for WhatsApp onboarding
- Remove `'awaiting_mode_selection' | 'awaiting_telegram_username'` from `flowState` (line 140)
- Update `DEFAULTS.BASH_TRUNCATE_AT` comment to remove "WhatsApp message limit" (line 436)
- Clean up MIME_TYPES comments in storage.ts that say "WhatsApp doesn't accept"

**Step 2: Verify TypeScript compiles**

```bash
bunx tsc --noEmit 2>&1 | head -30
```

Expected: Many errors from index.ts and other files referencing removed types — that's expected at this stage.

**Step 3: Commit**

```bash
git add src/types.ts && git commit -m "refactor: remove WhatsApp types (UserMode, groupId, onboarding flow)"
```

---

### Task 3: Clean up storage.ts

**Files:**
- Modify: `src/storage.ts`

**Step 1: Gut the file — remove all Kapso functions**

Replace the entire file keeping only the MIME utilities:

```typescript
import { extname } from 'path';

// MIME type mapping for common file extensions
const MIME_TYPES: Record<string, string> = {
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Get MIME type from file extension
 */
export function getMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Determine media type from MIME type
 */
export function getMediaType(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}
```

**Step 2: Commit**

```bash
git add src/storage.ts && git commit -m "refactor: remove Kapso functions from storage.ts, keep MIME utilities"
```

---

### Task 4: Simplify queue-manager.ts to Telegram-only

**Files:**
- Modify: `src/queue-manager.ts`

**Step 1: Remove WhatsApp types, detectPlatform, simplify constructor**

Changes needed:
- Remove `import { uploadToKapso } from './storage';` (line 7)
- Delete type definitions: `SendWhatsAppFn`, `SendWhatsAppImageFn`, `SendWhatsAppMediaFn`, `SendErrorWithActionsFn`, `Platform` (lines 27-69)
- Delete `detectPlatform()` function (lines 77-85)
- Simplify constructor to only take Telegram functions:
  ```typescript
  constructor(
    semaphore: Semaphore,
    agentManager: AgentManager,
    terminal: ClaudeTerminal,
    sendTelegram: SendTelegramFn,
    sendTelegramImage: SendTelegramImageFn,
    startTypingIndicator: StartTypingIndicatorFn
  )
  ```
- Update private fields to match (remove `sendWhatsApp*`, make Telegram fields required not optional)
- Simplify `sendResponse()` — always use Telegram:
  ```typescript
  private async sendResponse(replyTo: number, text: string, threadId?: number): Promise<void> {
    await this.sendTelegram(replyTo, text, threadId);
  }
  ```
- Simplify `sendImageResponse()` — always use Telegram
- Simplify `sendMediaResponse()` — for now, just send text placeholder (same as current Telegram branch)
- Remove `notifyTaskStart()` legacy method (line 691-705) — WhatsApp-only
- Remove `notifyTaskError()` legacy method (line 731-762) — WhatsApp-only
- Simplify `notifyTaskStartPlatform()` and `notifyTaskErrorPlatform()` — remove platform branching
- Simplify `processTask()` — remove WhatsApp progress interval (lines 414-428), always use typing indicator
- Simplify `processBashTask()` — remove platform detection, always use Telegram typing
- Remove `uploadToKapso` call in `processBashTask()` (line 604) — truncated bash output was uploaded via Kapso. For now, just skip file upload (send text only)
- Simplify `getTargetDescription()` — always return 'telegram'
- Update `processTask()` and `processBashTask()` signatures: `replyTo` becomes `number` (Telegram chatId), remove string/undefined options

**Step 2: Commit**

```bash
git add src/queue-manager.ts && git commit -m "refactor: simplify queue-manager to Telegram-only routing"
```

---

### Task 5: Clean up agent-manager.ts

**Files:**
- Modify: `src/agent-manager.ts`

**Step 1: Remove groupId methods**

- Delete `setGroupId()` method (~line 373-382)
- Delete `getAgentByGroupId()` method (~line 385-392)

**Step 2: Commit**

```bash
git add src/agent-manager.ts && git commit -m "refactor: remove groupId methods from agent-manager"
```

---

### Task 6: Rewrite index.ts — remove WhatsApp imports and config

**Files:**
- Modify: `src/index.ts`

This is the biggest task. Do it in sub-steps.

**Step 1: Remove WhatsApp imports (lines 4-52)**

Delete the entire `import { ... } from './whatsapp'` block.

**Step 2: Remove other dead imports**

- Delete: `import { roninAgent, RONIN_SYSTEM_PROMPT } from './ronin-agent';` (line 53)
- Delete: `import { MessageRouter } from './message-router';` (line 148)
- Delete: `import { uploadToKapso, downloadFromKapso } from './storage';` (line 161)
- Delete: `import { TelegramTokenManager } from './telegram-tokens';` (line 162)
- Remove `UserMode` from the type import on line 159

**Step 3: Remove/simplify config**

Replace config (lines 168-172) with:
```typescript
const config = {
  port: parseInt(process.env.PORT || '3000'),
  allowedUsernames: new Set(
    (process.env.ALLOWED_TELEGRAM_USERNAMES || '')
      .split(',')
      .map(u => u.trim().toLowerCase())
      .filter(Boolean)
  ),
};
```

**Step 4: Remove platform wrapper functions**

Delete lines 194-231 (sendMessage, sendImage, sendErrorWithActionsWrapper, sendMedia wrappers).

**Step 5: Simplify QueueManager instantiation**

Replace the queueManager construction (lines 243-254) with:
```typescript
const queueManager = new QueueManager(
  semaphore,
  agentManager,
  terminal,
  sendTelegramDirectMessage,
  sendTelegramDirectImage,
  startTypingIndicator
);
```

**Step 6: Remove dead initializations**

- Delete: `const messageRouter = new MessageRouter(agentManager, config.userPhone);` (line 277)
- Delete: `const telegramTokenManager = new TelegramTokenManager();` (line 280)

**Step 7: Remove User Mode helpers**

Delete lines 299-331 (getUserMode, needsOnboarding, isDojoMode functions).

**Step 8: Remove Ralph loop WhatsApp progress callback**

Delete or simplify the `ralphLoopManager.setProgressCallback()` block (lines 263-271) that calls WhatsApp's `sendLoopProgress`. This callback was only for WhatsApp; Telegram Ralph has its own progress handling.

**Step 9: Commit**

```bash
git add src/index.ts && git commit -m "refactor: remove WhatsApp imports, config, and platform wrappers from index.ts"
```

---

### Task 7: Rewrite index.ts — add whitelist guard and auto-register

**Files:**
- Modify: `src/index.ts`

**Step 1: Add whitelist check helper**

Add near the top (after config):
```typescript
function isAuthorizedUser(username?: string): boolean {
  if (!username) return false;
  if (config.allowedUsernames.size === 0) return true; // empty = allow all
  return config.allowedUsernames.has(username.toLowerCase());
}
```

**Step 2: Update handleTelegramMessage() guard**

Find the existing userPrefs guard (~line 907-913). Replace it with:
```typescript
if (!isAuthorizedUser(from.username)) {
  console.log(`[telegram] Unauthorized access from @${from.username || 'unknown'} (chat ${chatId})`);
  return;
}

// Auto-register user preferences if not exists
const userId = `telegram:${from.username}`;
let userPrefs = persistenceService.loadUserPreferences(userId);
if (!userPrefs) {
  userPrefs = {
    userId,
    telegramUsername: from.username,
    telegramChatId: chatId,
  };
  persistenceService.saveUserPreferences(userPrefs);
  console.log(`[telegram] Auto-registered user @${from.username}`);
}
```

**Step 3: Update handleBotAddedToGroup() guard**

Replace the "unknown user" check (~line 714-722) with a similar whitelist check.

**Step 4: Update handleTelegramCallback() if it has a similar guard**

Search for userPrefs checks in the callback handler and apply the same pattern.

**Step 5: Commit**

```bash
git add src/index.ts && git commit -m "feat: add ALLOWED_TELEGRAM_USERNAMES whitelist with auto-register"
```

---

### Task 8: Rewrite index.ts — delete WhatsApp webhook and handlers

**Files:**
- Modify: `src/index.ts`

**Step 1: Delete Kapso webhook endpoints**

Delete:
- `app.get('/webhook', ...)` (lines 510-521) — Kapso verification
- `app.post('/webhook', ...)` (lines 527-574) — WhatsApp message handler

**Step 2: Delete all WhatsApp-only handler functions**

Delete these functions entirely (they are only called from the WhatsApp webhook or WhatsApp button/list handlers):
- `extractMessage()` (~line 7505+) — Kapso payload parser
- `handleTextMessage()` (~line 3813) — WhatsApp text routing
- `handleButtonReply()` (~line 4631) — WhatsApp button routing
- `handleListReply()` (~line 5638) — WhatsApp list routing
- `handleImageMessage()` (~line 3969) — WhatsApp image (NOT the Telegram one)
- `handleAudioMessage()` (~line 4082) — WhatsApp audio
- `handleGroupPrompt()` (~line 4153) — WhatsApp group routing
- `handleStatusCommand()` (~line 4204) — WhatsApp status
- `handleResetAllCommand()` (~line 4226) — WhatsApp reset
- `handleOnboarding()` (~line 4249) — WhatsApp onboarding
- `handleSendPrompt()` (~line 4273) — WhatsApp prompt sending
- `handleCreateAgentFlow()` (~line 4316)
- `handleMenuCommand()` (~line 4325)
- `handleResetCommand()` (~line 4335)
- `handleDeleteAgentsCommand()` (~line 4350)
- `handleConfigureLimitCommand()` (~line 4365)
- `handleConfigurePriorityCommand()` (~line 4375)
- `handleCompactCommand()` (~line 4398)
- `handleHelpCommand()` (~line 4417)
- `handleBashModeEnable/Disable()` (~line 4446-4472)
- `handleBashCommand()` (~line 4474) — WhatsApp bash (different from Telegram bash)
- `handleFlowTextInput()` (~line 4519)
- `handleTranscriptionManualFallback()` (~line 4771)
- `handleContinueWithLastChoice()` (~line 4782)
- `handleModelSelection()` (~line 4811)
- `handleAgentModelSelection()` (~line 4872)
- `handleMigrationChoice()` (~line 4927)
- `handleErrorRecovery()` (~line 4991)
- `handleConfirmation()` (~line 5043)
- `handleNewAgentChoice()` (~line 5353)
- `handleGenericConfirmation()` (~line 5375)
- `handleModeSelection()` (~line 5395)
- `handleRalphIterationsSelection()` (~line 5431)
- `handleRalphPause/Resume/Cancel/Retry/Details/Restart()` (~lines 5462-5633) — WhatsApp Ralph controls
- `handleAgentSelection()` (~line 5760)
- `handleAgentSelectionForPrompt()` (~line 5799)
- `handleModelSelectionForPrompt()` (~line 5828)
- `handleRalphModelSelection()` (~line 5888)
- `handleAgentTypeSelection()` (~line 5947)
- `handleEmojiSelection()` (~line 5982)
- `handleWorkspaceSelection()` (~line 6005)
- `handleModelModeSelection()` (~line 6049)
- `handleAgentMenuAction()` (~line 6079)
- `handleHistorySelection()` (~line 6289)
- `handleOutputAction()` (~line 6316)
- `handleResetSelection()` (~line 6374)
- `handleDeleteSelection()` (~line 6412)
- `handleLimitSelection()` (~line 6450)
- `handlePrioritySelection()` (~line 6471)
- `handleOnboardingFlow()` (~line 6691)
- `handleRoninQuery()` (~line 6759)

**Step 3: Clean up exports**

Update the export block at the bottom to remove references to deleted functions/objects (messageRouter, etc).

**Step 4: Commit**

```bash
git add src/index.ts && git commit -m "refactor: delete all WhatsApp webhook handlers and functions from index.ts"
```

---

### Task 9: Fix remaining compilation errors

**Files:**
- Modify: various files as needed

**Step 1: Run TypeScript check**

```bash
bunx tsc --noEmit 2>&1 | head -50
```

**Step 2: Fix all remaining errors iteratively**

Common expected issues:
- References to `UserMode` type in persistence.ts
- References to `mode` and `onboardingComplete` in UserPreferences across persistence.ts, user-context-manager.ts
- References to `groupId` in persistence.ts serialization
- `telegram-tokens.ts` may be orphaned (was only used for WhatsApp→Telegram linking)
- Any remaining `sendWhatsApp*` calls or `uploadToKapso` references
- Comments referencing WhatsApp in various files

**Step 3: Check if telegram-tokens.ts is still needed**

If it was only used for the WhatsApp→Telegram deep link onboarding, delete it.

**Step 4: Run TypeScript check until clean**

```bash
bunx tsc --noEmit
```

Expected: No errors

**Step 5: Commit**

```bash
git add -A && git commit -m "fix: resolve all compilation errors from WhatsApp removal"
```

---

### Task 10: Fix and update tests

**Files:**
- Modify: `src/__tests__/queue-manager.test.ts`
- Modify: `src/__tests__/queue-manager-cancel.test.ts`
- Modify: `src/__tests__/index.test.ts`
- Modify: `src/__tests__/integration-group-onboarding.test.ts`
- Possibly modify: other test files with WhatsApp references

**Step 1: Run all tests to see what fails**

```bash
bun test 2>&1 | tail -40
```

**Step 2: Fix each failing test file**

- `queue-manager.test.ts`: Update constructor calls to new signature (3 Telegram fns instead of mixed), remove `detectPlatform` tests
- `queue-manager-cancel.test.ts`: Same constructor update
- `index.test.ts`: Remove WhatsApp webhook tests, update any remaining tests
- `integration-group-onboarding.test.ts`: Remove "configure o dojo pelo WhatsApp" assertions, update user setup to not require mode/onboardingComplete
- Other test files: Fix UserPreferences shapes (remove `mode`, `onboardingComplete`)

**Step 3: Run tests until all pass**

```bash
bun test
```

Expected: All tests pass

**Step 4: Commit**

```bash
git add -A && git commit -m "test: fix all tests after WhatsApp removal"
```

---

### Task 11: Final cleanup and verification

**Files:**
- Verify: all files

**Step 1: Search for any remaining WhatsApp/Kapso references**

```bash
grep -ri "whatsapp\|kapso\|ronin\|dojo\|userPhone\|groupId\|@g\.us" src/ --include="*.ts" -l
```

Clean up any remaining references (comments, dead code, type references).

**Step 2: Search for dead imports**

```bash
bunx tsc --noEmit
```

**Step 3: Run full test suite**

```bash
bun test
```

**Step 4: Verify the app starts**

```bash
ALLOWED_TELEGRAM_USERNAMES=lucas bun run dev
```

Check logs for clean startup (no errors about missing Kapso env vars, etc).

**Step 5: Final commit**

```bash
git add -A && git commit -m "chore: final cleanup of WhatsApp references"
```
