# Grupos por Agente - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Each Claude agent lives in its own WhatsApp group, with the main number becoming a command center that rejects direct prompts.

**Architecture:** Messages from groups route to their linked agent. Main number accepts only commands (/, /status, /reset all, $ bash). Agent creation automatically creates a WhatsApp group via Groups API. Vínculo imutável: agent ↔ group ↔ workspace ↔ type.

**Tech Stack:** Bun, TypeScript, Kapso WhatsApp API, Claude SDK

---

## Phase 1: Data Model Updates

### Task 1.1: Add Model Mode Type to types.ts

**Files:**
- Modify: `src/types.ts:7-13`

**Step 1: Write the failing test**

```typescript
// src/__tests__/types.test.ts
import { describe, it, expect } from 'bun:test';

describe('ModelMode type', () => {
  it('should accept valid model mode values', () => {
    const modes: Array<'selection' | 'haiku' | 'sonnet' | 'opus'> = [
      'selection', 'haiku', 'sonnet', 'opus'
    ];
    expect(modes).toHaveLength(4);
  });
});
```

**Step 2: Run test to verify it compiles**

Run: `bun test src/__tests__/types.test.ts`
Expected: PASS (type exists after implementation)

**Step 3: Add ModelMode type**

In `src/types.ts`, add after line 13:

```typescript
/**
 * Model mode - selection (asks each time) or fixed model
 */
export type ModelMode = 'selection' | 'haiku' | 'sonnet' | 'opus';
```

**Step 4: Run test to verify**

Run: `bun test src/__tests__/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/__tests__/types.test.ts
git commit -m "feat(types): add ModelMode type for agent model configuration"
```

---

### Task 1.2: Add groupId and modelMode to Agent Interface

**Files:**
- Modify: `src/types.ts:34-52` (Agent interface)
- Modify: `src/types.ts:161-179` (SerializedAgent interface)

**Step 1: Write the failing test**

```typescript
// src/__tests__/agent-model.test.ts
import { describe, it, expect } from 'bun:test';
import type { Agent, ModelMode } from '../types';

describe('Agent with groupId and modelMode', () => {
  it('should have optional groupId field', () => {
    const agent: Partial<Agent> = {
      id: 'test-id',
      groupId: '120363123456789012@g.us',
    };
    expect(agent.groupId).toBe('120363123456789012@g.us');
  });

  it('should have modelMode field with default selection', () => {
    const agent: Partial<Agent> = {
      id: 'test-id',
      modelMode: 'selection',
    };
    expect(agent.modelMode).toBe('selection');
  });

  it('should allow fixed model modes', () => {
    const modes: ModelMode[] = ['haiku', 'sonnet', 'opus'];
    modes.forEach(mode => {
      const agent: Partial<Agent> = { modelMode: mode };
      expect(agent.modelMode).toBe(mode);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/agent-model.test.ts`
Expected: FAIL (groupId and modelMode don't exist on Agent type)

**Step 3: Update Agent interface**

In `src/types.ts`, modify Agent interface (around line 34-52):

```typescript
export interface Agent {
  id: string;                   // UUID
  userId: string;               // Owning user ID (phone number)
  name: string;                 // User-provided name
  type: AgentType;              // 'claude' (default) or 'bash'
  mode: 'conversational' | 'ralph';  // Agent operation mode
  emoji?: string;               // Visual identifier emoji (default: 🤖)
  workspace?: string;           // Absolute path (optional, immutable)
  groupId?: string;             // WhatsApp group ID (format: 120363...@g.us)
  modelMode: ModelMode;         // 'selection' or fixed model
  sessionId?: string;           // Claude session ID (managed by SDK)
  currentLoopId?: string;       // Active Ralph loop ID (if in ralph mode)
  title: string;                // Auto-generated title (3-5 words)
  status: 'idle' | 'processing' | 'error' | 'ralph-loop' | 'ralph-paused';
  statusDetails: string;        // e.g., "Awaiting prompt", "Creating API endpoints..."
  priority: 'high' | 'medium' | 'low';
  lastActivity: Date;
  messageCount: number;         // Counter for title update triggers
  outputs: Output[];            // Last 10 outputs (FIFO)
  createdAt: Date;
}
```

**Step 4: Update SerializedAgent interface**

In `src/types.ts`, modify SerializedAgent interface (around line 161-179):

```typescript
export interface SerializedAgent {
  id: string;
  userId: string;
  name: string;
  type?: AgentType;
  mode?: 'conversational' | 'ralph';
  emoji?: string;
  workspace?: string;
  groupId?: string;             // WhatsApp group ID
  modelMode?: ModelMode;        // Model mode (optional for backwards compat)
  sessionId?: string;
  currentLoopId?: string;
  title: string;
  status: 'idle' | 'processing' | 'error' | 'ralph-loop' | 'ralph-paused';
  statusDetails: string;
  priority: 'high' | 'medium' | 'low';
  lastActivity: string;
  messageCount: number;
  outputs: SerializedOutput[];
  createdAt: string;
}
```

**Step 5: Run test to verify**

Run: `bun test src/__tests__/agent-model.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types.ts src/__tests__/agent-model.test.ts
git commit -m "feat(types): add groupId and modelMode to Agent interface"
```

---

### Task 1.3: Update AgentManager to Handle New Fields

**Files:**
- Modify: `src/agent-manager.ts:67-108` (createAgent method)
- Modify: `src/persistence.ts` (serialization/deserialization)

**Step 1: Write the failing test**

```typescript
// src/__tests__/agent-manager-groups.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AgentManager } from '../agent-manager';
import { PersistenceService } from '../persistence';
import { unlinkSync, existsSync } from 'fs';

const TEST_STATE_FILE = './.test-agents-state.json';

describe('AgentManager with groups', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;

  beforeEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  });

  it('should create agent with default modelMode "selection"', () => {
    const agent = agentManager.createAgent('user1', 'Test Agent');
    expect(agent.modelMode).toBe('selection');
    expect(agent.groupId).toBeUndefined();
  });

  it('should create agent with specified modelMode', () => {
    const agent = agentManager.createAgent('user1', 'Test Agent', undefined, undefined, 'claude', 'opus');
    expect(agent.modelMode).toBe('opus');
  });

  it('should set groupId after creation', () => {
    const agent = agentManager.createAgent('user1', 'Test Agent');
    agentManager.setGroupId(agent.id, '120363123456789012@g.us');
    const updated = agentManager.getAgent(agent.id);
    expect(updated?.groupId).toBe('120363123456789012@g.us');
  });

  it('should find agent by groupId', () => {
    const agent = agentManager.createAgent('user1', 'Test Agent');
    agentManager.setGroupId(agent.id, '120363123456789012@g.us');
    const found = agentManager.getAgentByGroupId('120363123456789012@g.us');
    expect(found?.id).toBe(agent.id);
  });

  it('should update modelMode', () => {
    const agent = agentManager.createAgent('user1', 'Test Agent');
    agentManager.setModelMode(agent.id, 'sonnet');
    const updated = agentManager.getAgent(agent.id);
    expect(updated?.modelMode).toBe('sonnet');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/agent-manager-groups.test.ts`
Expected: FAIL (methods don't exist)

**Step 3: Update createAgent signature and implementation**

In `src/agent-manager.ts`, update createAgent method:

```typescript
import type { Agent, AgentType, ModelMode, Output, OutputType, SystemConfig } from './types';

// ... in class AgentManager ...

  /**
   * Create a new agent
   * @throws AgentValidationError if validation fails
   */
  createAgent(
    userId: string,
    name: string,
    workspace?: string,
    emoji?: string,
    type: AgentType = 'claude',
    modelMode: ModelMode = 'selection'
  ): Agent {
    // Validate name
    this.validateName(name);

    // Validate workspace if provided
    if (workspace) {
      this.validateWorkspace(workspace);
    }

    // Check user agent limit
    const userAgents = this.agentsByUser.get(userId) || new Set();
    if (userAgents.size >= AgentManager.MAX_AGENTS_PER_USER) {
      throw new AgentValidationError(
        `Maximum agents limit reached (${AgentManager.MAX_AGENTS_PER_USER})`
      );
    }

    const now = new Date();
    const agent: Agent = {
      id: crypto.randomUUID(),
      userId,
      name: name.trim(),
      type,
      mode: 'conversational',
      emoji,
      workspace,
      modelMode,
      title: '',
      status: 'idle',
      statusDetails: type === 'bash' ? 'Terminal pronto' : 'Aguardando prompt',
      priority: 'medium',
      lastActivity: now,
      messageCount: 0,
      outputs: [],
      createdAt: now,
    };

    this.agents.set(agent.id, agent);
    this.trackAgentForUser(userId, agent.id);

    this.persist();
    return agent;
  }
```

**Step 4: Add new methods to AgentManager**

Add after updateAgentMode method:

```typescript
  /**
   * Set the WhatsApp group ID for an agent
   */
  setGroupId(agentId: string, groupId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.groupId = groupId;
    this.persist();
    return true;
  }

  /**
   * Get an agent by its WhatsApp group ID
   */
  getAgentByGroupId(groupId: string): Agent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.groupId === groupId) {
        return agent;
      }
    }
    return undefined;
  }

  /**
   * Set the model mode for an agent
   */
  setModelMode(agentId: string, modelMode: ModelMode): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.modelMode = modelMode;
    this.persist();
    return true;
  }
```

**Step 5: Update persistence serialization/deserialization**

In `src/persistence.ts`, update serialize method to include new fields:

```typescript
// In serialize method, ensure groupId and modelMode are preserved
const serializedAgent: SerializedAgent = {
  // ... existing fields ...
  groupId: agent.groupId,
  modelMode: agent.modelMode,
  // ... rest of fields ...
};
```

In deserialize method, add defaults for backwards compat:

```typescript
// In deserialize method
const agent: Agent = {
  // ... existing fields ...
  groupId: serialized.groupId,
  modelMode: serialized.modelMode || 'selection',
  // ... rest of fields ...
};
```

**Step 6: Run tests**

Run: `bun test src/__tests__/agent-manager-groups.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/agent-manager.ts src/persistence.ts src/types.ts src/__tests__/agent-manager-groups.test.ts
git commit -m "feat(agent-manager): add groupId and modelMode support"
```

---

## Phase 2: WhatsApp Groups API Integration

### Task 2.1: Add Group Creation Function

**Files:**
- Modify: `src/whatsapp.ts` (add createWhatsAppGroup function)

**Step 1: Write the failing test**

```typescript
// src/__tests__/whatsapp-groups.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock fetch globally
const mockFetch = mock(() => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({ id: '120363123456789012@g.us' }),
}));

describe('WhatsApp Groups API', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
  });

  it('should create a group with correct payload', async () => {
    const { createWhatsAppGroup } = await import('../whatsapp');

    const groupId = await createWhatsAppGroup(
      'Backend API',
      '📁 /Users/lucas/projects/api\n📅 03/02/2026\n💬 Conversacional',
      '+5581999999999'
    );

    expect(mockFetch).toHaveBeenCalled();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/groups');

    const body = JSON.parse(options.body);
    expect(body.subject).toBe('Backend API');
    expect(body.description).toContain('Conversacional');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/whatsapp-groups.test.ts`
Expected: FAIL (function doesn't exist)

**Step 3: Implement createWhatsAppGroup**

Add to `src/whatsapp.ts`:

```typescript
/**
 * Create a new WhatsApp group and add the user as participant
 * Uses the WhatsApp Groups API (available since October 2025)
 *
 * @param name - Group name (will be prefixed with emoji)
 * @param description - Group description with workspace and type info
 * @param userPhone - Phone number to add as participant
 * @returns Group ID (format: 120363...@g.us)
 */
export async function createWhatsAppGroup(
  name: string,
  description: string,
  userPhone: string
): Promise<string> {
  // Create the group
  const createResponse = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/groups`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: name,
        description,
      }),
    }
  );

  if (!createResponse.ok) {
    const error = await createResponse.text();
    console.error('WhatsApp group creation error:', error);
    throw new Error(`Failed to create WhatsApp group: ${error}`);
  }

  const { id: groupId } = await createResponse.json() as { id: string };

  // Add user to the group
  const addResponse = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/groups/${groupId}/participants`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        participants: [userPhone.replace('+', '')],
      }),
    }
  );

  if (!addResponse.ok) {
    console.error('Failed to add participant to group:', await addResponse.text());
    // Group was created, return ID anyway - user can be added manually
  }

  return groupId;
}
```

**Step 4: Run test**

Run: `bun test src/__tests__/whatsapp-groups.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/whatsapp.ts src/__tests__/whatsapp-groups.test.ts
git commit -m "feat(whatsapp): add createWhatsAppGroup function"
```

---

### Task 2.2: Add Group Deletion Function

**Files:**
- Modify: `src/whatsapp.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/__tests__/whatsapp-groups.test.ts

it('should delete a group', async () => {
  const { deleteWhatsAppGroup } = await import('../whatsapp');

  await deleteWhatsAppGroup('120363123456789012@g.us');

  expect(mockFetch).toHaveBeenCalled();
  const [url, options] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  expect(url).toContain('/groups/120363123456789012@g.us');
  expect(options.method).toBe('DELETE');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/whatsapp-groups.test.ts`
Expected: FAIL

**Step 3: Implement deleteWhatsAppGroup**

Add to `src/whatsapp.ts`:

```typescript
/**
 * Delete a WhatsApp group
 *
 * @param groupId - Group ID to delete
 */
export async function deleteWhatsAppGroup(groupId: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/groups/${groupId}`,
    {
      method: 'DELETE',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('WhatsApp group deletion error:', error);
    throw new Error(`Failed to delete WhatsApp group: ${error}`);
  }
}
```

**Step 4: Run test**

Run: `bun test src/__tests__/whatsapp-groups.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/whatsapp.ts src/__tests__/whatsapp-groups.test.ts
git commit -m "feat(whatsapp): add deleteWhatsAppGroup function"
```

---

### Task 2.3: Update Send Functions to Support Groups

**Files:**
- Modify: `src/whatsapp.ts` (all send functions)

**Step 1: Write the failing test**

```typescript
// src/__tests__/whatsapp-send-groups.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

describe('WhatsApp send to groups', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  it('should send text to group with recipient_type group', async () => {
    const { sendWhatsApp } = await import('../whatsapp');

    // Group ID format: starts with number, ends with @g.us
    await sendWhatsApp('120363123456789012@g.us', 'Hello group!');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('group');
    expect(body.to).toBe('120363123456789012@g.us');
  });

  it('should send text to individual with recipient_type individual', async () => {
    const { sendWhatsApp } = await import('../whatsapp');

    await sendWhatsApp('5581999999999', 'Hello!');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('individual');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/whatsapp-send-groups.test.ts`
Expected: FAIL (recipient_type is always 'individual')

**Step 3: Add helper function and update sendWhatsApp**

Add helper at top of `src/whatsapp.ts`:

```typescript
/**
 * Determine if a recipient is a group or individual
 * Group IDs end with @g.us (e.g., 120363123456789012@g.us)
 */
function isGroupId(recipient: string): boolean {
  return recipient.endsWith('@g.us');
}

/**
 * Get recipient type for WhatsApp API
 */
function getRecipientType(recipient: string): 'group' | 'individual' {
  return isGroupId(recipient) ? 'group' : 'individual';
}
```

Update sendWhatsApp function:

```typescript
export async function sendWhatsApp(to: string, text: string): Promise<void> {
  // Truncate if too long
  const truncatedText = text.length > MAX_MESSAGE_LENGTH
    ? text.slice(0, MAX_MESSAGE_LENGTH - 50) + '\n\n... (truncated)'
    : text;

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: getRecipientType(to),
        to,
        type: 'text',
        text: { body: truncatedText },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}
```

**Step 4: Update ALL other send functions similarly**

Replace `recipient_type: 'individual'` with `recipient_type: getRecipientType(to)` in:
- sendWhatsAppImage
- sendWhatsAppDocument
- sendWhatsAppMedia
- sendButtons
- sendModelSelector
- sendAgentsList
- sendAgentSelector
- (all other send functions with hardcoded 'individual')

**Step 5: Run test**

Run: `bun test src/__tests__/whatsapp-send-groups.test.ts`
Expected: PASS

**Step 6: Run all tests to ensure nothing broke**

Run: `bun test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/whatsapp.ts src/__tests__/whatsapp-send-groups.test.ts
git commit -m "feat(whatsapp): update send functions to support groups"
```

---

## Phase 3: Message Routing

### Task 3.1: Update extractMessage to Detect Group Messages

**Files:**
- Modify: `src/index.ts:2556-2700` (extractMessage function)

**Step 1: Write the failing test**

```typescript
// src/__tests__/extract-message-groups.test.ts
import { describe, it, expect } from 'bun:test';

// Import will need to export extractMessage for testing
describe('extractMessage with groups', () => {
  it('should extract groupId from group message', () => {
    const payload = {
      message: {
        type: 'text',
        text: { body: 'Hello' },
        id: 'msg123',
      },
      conversation: {
        phone_number: '+5581999999999',
        group_id: '120363123456789012@g.us',
      },
    };

    // After implementation, extractMessage should return groupId
    const result = extractMessage(payload);
    expect(result?.groupId).toBe('120363123456789012@g.us');
    expect(result?.from).toBe('5581999999999');
  });

  it('should not have groupId for individual messages', () => {
    const payload = {
      message: {
        type: 'text',
        text: { body: 'Hello' },
        id: 'msg123',
      },
      conversation: {
        phone_number: '+5581999999999',
      },
    };

    const result = extractMessage(payload);
    expect(result?.groupId).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/extract-message-groups.test.ts`
Expected: FAIL (extractMessage not exported, groupId not extracted)

**Step 3: Update ExtractedMessage type and extractMessage**

In `src/index.ts`, update type:

```typescript
type ExtractedMessage = {
  from: string;
  type: 'text' | 'button' | 'list' | 'image' | 'audio';
  groupId?: string;  // NEW: WhatsApp group ID if from a group
  text?: string;
  buttonId?: string;
  listId?: string;
  messageId?: string;
  imageId?: string;
  imageMimeType?: string;
  imageUrl?: string;
  audioId?: string;
  audioMimeType?: string;
  audioUrl?: string;
};
```

Update extractMessage to extract groupId:

```typescript
export function extractMessage(payload: unknown): ExtractedMessage | null {
  try {
    const p = payload as Record<string, unknown>;

    // Kapso v2 format
    if (p?.message && p?.conversation) {
      const message = p.message as Record<string, unknown>;
      const conversation = p.conversation as Record<string, unknown>;
      const from = ((conversation.phone_number as string) || '').replace('+', '');
      const groupId = conversation.group_id as string | undefined;

      // Button reply
      if (
        message.type === 'interactive' &&
        (message.interactive as Record<string, unknown>)?.type === 'button_reply'
      ) {
        return {
          from,
          groupId,
          type: 'button',
          buttonId: /* ... existing code ... */
        };
      }

      // ... update all other return statements to include groupId ...
    }

    // ... rest of function ...
  }
}
```

**Step 4: Run test**

Run: `bun test src/__tests__/extract-message-groups.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts src/__tests__/extract-message-groups.test.ts
git commit -m "feat(webhook): extract groupId from group messages"
```

---

### Task 3.2: Create Message Router

**Files:**
- Create: `src/message-router.ts`
- Test: `src/__tests__/message-router.test.ts`

**Step 1: Write the failing test**

```typescript
// src/__tests__/message-router.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { MessageRouter, RouteResult } from '../message-router';
import { AgentManager } from '../agent-manager';
import { PersistenceService } from '../persistence';
import { unlinkSync, existsSync } from 'fs';

const TEST_STATE_FILE = './.test-router-state.json';

describe('MessageRouter', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let router: MessageRouter;

  beforeEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
    router = new MessageRouter(agentManager, '5581999999999');
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  });

  describe('Main number (command center)', () => {
    it('should route / command to menu', () => {
      const result = router.route('5581999999999', undefined, '/');
      expect(result.action).toBe('menu');
    });

    it('should route /status to status', () => {
      const result = router.route('5581999999999', undefined, '/status');
      expect(result.action).toBe('status');
    });

    it('should route /reset all to reset_all', () => {
      const result = router.route('5581999999999', undefined, '/reset all');
      expect(result.action).toBe('reset_all');
    });

    it('should route $ command to bash', () => {
      const result = router.route('5581999999999', undefined, '$ ls -la');
      expect(result.action).toBe('bash');
      expect(result.command).toBe('ls -la');
    });

    it('should reject prompts on main number', () => {
      const result = router.route('5581999999999', undefined, 'Hello, help me with code');
      expect(result.action).toBe('reject_prompt');
    });
  });

  describe('Group messages', () => {
    it('should route group message to linked agent', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const result = router.route('5581999999999', '120363123456789012@g.us', 'Hello');
      expect(result.action).toBe('prompt');
      expect(result.agentId).toBe(agent.id);
    });

    it('should reject message from unlinked group', () => {
      const result = router.route('5581999999999', '120363999999999999@g.us', 'Hello');
      expect(result.action).toBe('reject_unlinked_group');
    });

    it('should handle model prefix !opus in group', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const result = router.route('5581999999999', '120363123456789012@g.us', '!opus Hello');
      expect(result.action).toBe('prompt');
      expect(result.model).toBe('opus');
      expect(result.text).toBe('Hello');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/message-router.test.ts`
Expected: FAIL (MessageRouter doesn't exist)

**Step 3: Create MessageRouter class**

Create `src/message-router.ts`:

```typescript
import type { AgentManager } from './agent-manager';
import type { ModelMode } from './types';

export type RouteAction =
  | 'menu'           // Show main menu
  | 'status'         // Show all agents status
  | 'reset_all'      // Reset all agents
  | 'bash'           // Execute bash command
  | 'prompt'         // Send prompt to agent
  | 'reject_prompt'  // Reject prompt on main number
  | 'reject_unlinked_group'  // Message from unlinked group
  | 'button'         // Button interaction
  | 'list';          // List interaction

export interface RouteResult {
  action: RouteAction;
  agentId?: string;
  text?: string;
  command?: string;
  model?: 'haiku' | 'sonnet' | 'opus';
}

/**
 * MessageRouter determines how to handle incoming messages
 * based on whether they come from the main number or a group
 */
export class MessageRouter {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly mainUserPhone: string
  ) {}

  /**
   * Route an incoming text message
   */
  route(from: string, groupId: string | undefined, text: string): RouteResult {
    // Normalize phone
    const normalizedFrom = from.replace('+', '');
    const normalizedMain = this.mainUserPhone.replace('+', '');

    // Message from a group
    if (groupId) {
      return this.routeGroupMessage(groupId, text);
    }

    // Message from main number (command center)
    if (normalizedFrom.endsWith(normalizedMain)) {
      return this.routeMainMessage(text);
    }

    // Unknown sender
    return { action: 'reject_prompt' };
  }

  private routeMainMessage(text: string): RouteResult {
    const trimmed = text.trim();

    // Commands
    if (trimmed === '/') {
      return { action: 'menu' };
    }
    if (trimmed === '/status') {
      return { action: 'status' };
    }
    if (trimmed === '/reset all') {
      return { action: 'reset_all' };
    }

    // Bash prefix
    if (trimmed.startsWith('$ ')) {
      return { action: 'bash', command: trimmed.slice(2) };
    }
    if (trimmed.startsWith('> ')) {
      return { action: 'bash', command: trimmed.slice(2) };
    }

    // Any other text is rejected
    return { action: 'reject_prompt' };
  }

  private routeGroupMessage(groupId: string, text: string): RouteResult {
    // Find agent linked to this group
    const agent = this.agentManager.getAgentByGroupId(groupId);
    if (!agent) {
      return { action: 'reject_unlinked_group' };
    }

    // Parse model prefix (!haiku, !sonnet, !opus)
    const { model, cleanText } = this.parseModelPrefix(text);

    return {
      action: 'prompt',
      agentId: agent.id,
      text: cleanText,
      model: model || this.getDefaultModel(agent.modelMode),
    };
  }

  private parseModelPrefix(text: string): { model?: 'haiku' | 'sonnet' | 'opus'; cleanText: string } {
    const trimmed = text.trim();

    if (trimmed.startsWith('!haiku ')) {
      return { model: 'haiku', cleanText: trimmed.slice(7).trim() };
    }
    if (trimmed.startsWith('!sonnet ')) {
      return { model: 'sonnet', cleanText: trimmed.slice(8).trim() };
    }
    if (trimmed.startsWith('!opus ')) {
      return { model: 'opus', cleanText: trimmed.slice(6).trim() };
    }

    return { cleanText: trimmed };
  }

  private getDefaultModel(modelMode: ModelMode): 'haiku' | 'sonnet' | 'opus' | undefined {
    if (modelMode === 'selection') {
      return undefined; // Will trigger model selection UI
    }
    return modelMode;
  }
}
```

**Step 4: Run test**

Run: `bun test src/__tests__/message-router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/message-router.ts src/__tests__/message-router.test.ts
git commit -m "feat: add MessageRouter for group/main number routing"
```

---

## Phase 4: Agent Creation Flow Update

### Task 4.1: Update UserContextManager for New Flow

**Files:**
- Modify: `src/user-context-manager.ts`
- Modify: `src/types.ts` (UserContext interface)

**Step 1: Write the failing test**

```typescript
// src/__tests__/user-context-groups.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { UserContextManager } from '../user-context-manager';

describe('UserContextManager - Groups flow', () => {
  let manager: UserContextManager;

  beforeEach(() => {
    manager = new UserContextManager();
  });

  describe('Create agent flow with mode selection', () => {
    it('should advance through all steps: name → emoji → type → workspace → modelMode', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isAwaitingAgentName('user1')).toBe(true);

      manager.setAgentName('user1', 'Backend API');
      expect(manager.isAwaitingEmoji('user1')).toBe(true);

      manager.setAgentEmoji('user1', '🚀');
      expect(manager.isAwaitingAgentMode('user1')).toBe(true);

      manager.setAgentMode('user1', 'conversational');
      expect(manager.isAwaitingWorkspaceChoice('user1')).toBe(true);

      manager.setAgentWorkspace('user1', '/Users/lucas/projects/api');
      expect(manager.isAwaitingModelMode('user1')).toBe(true);

      manager.setAgentModelMode('user1', 'opus');
      expect(manager.isAwaitingCreateConfirmation('user1')).toBe(true);

      const data = manager.getCreateAgentData('user1');
      expect(data).toEqual({
        agentName: 'Backend API',
        agentType: 'claude',
        emoji: '🚀',
        agentMode: 'conversational',
        workspace: '/Users/lucas/projects/api',
        modelMode: 'opus',
      });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/user-context-groups.test.ts`
Expected: FAIL (new methods don't exist)

**Step 3: Update UserContext type in types.ts**

```typescript
export interface UserContext {
  userId: string;
  currentFlow?: 'create_agent' | 'configure_priority' | 'configure_limit' | 'delete_agent' | 'edit_emoji' | 'configure_ralph' | 'configure_model_mode';
  flowState?: 'awaiting_name' | 'awaiting_type' | 'awaiting_emoji' | 'awaiting_mode' | 'awaiting_workspace' | 'awaiting_workspace_choice' | 'awaiting_model_mode' | 'awaiting_confirmation' | 'awaiting_selection' | 'awaiting_emoji_text' | 'awaiting_ralph_task' | 'awaiting_ralph_max_iterations' | 'awaiting_delete_group_choice';
  flowData?: {
    agentName?: string;
    agentId?: string;
    agentType?: AgentType;
    agentMode?: 'conversational' | 'ralph';
    emoji?: string;
    workspace?: string;
    modelMode?: ModelMode;
    priority?: string;
    [key: string]: unknown;
  };
  // ... rest unchanged
}
```

**Step 4: Add new methods to UserContextManager**

Add to `src/user-context-manager.ts`:

```typescript
  /**
   * Set agent mode (conversational/ralph) in create flow
   * Advances state to awaiting_workspace_choice
   */
  setAgentMode(userId: string, mode: 'conversational' | 'ralph'): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      agentMode: mode,
    };
    context.flowState = 'awaiting_workspace_choice';
    this.contexts.set(userId, context);
  }

  /**
   * Check if awaiting agent mode selection
   */
  isAwaitingAgentMode(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_mode';
  }

  /**
   * Set model mode in create flow
   * Advances state to awaiting_confirmation
   */
  setAgentModelMode(userId: string, modelMode: ModelMode): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      modelMode,
    };
    context.flowState = 'awaiting_confirmation';
    this.contexts.set(userId, context);
  }

  /**
   * Check if awaiting model mode selection
   */
  isAwaitingModelMode(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_model_mode';
  }
```

Also update existing flow to add the new step. Modify `setAgentEmoji`:

```typescript
  setAgentEmoji(userId: string, emoji: string): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      emoji,
    };
    // NEW: Go to mode selection instead of workspace
    context.flowState = 'awaiting_mode';
    this.contexts.set(userId, context);
  }
```

Update `setAgentWorkspace` to go to model mode:

```typescript
  setAgentWorkspace(userId: string, workspace: string | null): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      workspace: workspace ?? undefined,
    };
    // NEW: Go to model mode selection instead of confirmation
    context.flowState = 'awaiting_model_mode';
    this.contexts.set(userId, context);
  }
```

Update `getCreateAgentData`:

```typescript
  getCreateAgentData(userId: string): {
    agentName?: string;
    agentType?: 'claude' | 'bash';
    emoji?: string;
    agentMode?: 'conversational' | 'ralph';
    workspace?: string;
    modelMode?: ModelMode;
  } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      return undefined;
    }
    return {
      agentName: context.flowData?.agentName as string | undefined,
      agentType: context.flowData?.agentType as 'claude' | 'bash' | undefined,
      emoji: context.flowData?.emoji as string | undefined,
      agentMode: context.flowData?.agentMode as 'conversational' | 'ralph' | undefined,
      workspace: context.flowData?.workspace as string | undefined,
      modelMode: context.flowData?.modelMode as ModelMode | undefined,
    };
  }
```

**Step 5: Run test**

Run: `bun test src/__tests__/user-context-groups.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/user-context-manager.ts src/types.ts src/__tests__/user-context-groups.test.ts
git commit -m "feat(user-context): add mode and modelMode to create agent flow"
```

---

### Task 4.2: Add WhatsApp UI Components for New Flow

**Files:**
- Modify: `src/whatsapp.ts`

**Step 1: Write the failing test**

```typescript
// src/__tests__/whatsapp-ui-groups.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFetch = mock(() => Promise.resolve({ ok: true }));

describe('WhatsApp UI for groups flow', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  it('should send agent mode selector', async () => {
    const { sendAgentModeSelector } = await import('../whatsapp');

    await sendAgentModeSelector('user1');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.interactive.body.text).toContain('Conversacional');
    expect(body.interactive.body.text).toContain('Ralph');
  });

  it('should send model mode selector', async () => {
    const { sendModelModeSelector } = await import('../whatsapp');

    await sendModelModeSelector('user1');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.interactive.body.text).toContain('Seleção');
    expect(body.interactive.body.text).toContain('Haiku');
    expect(body.interactive.body.text).toContain('Sonnet');
    expect(body.interactive.body.text).toContain('Opus');
  });

  it('should send delete group choice', async () => {
    const { sendDeleteGroupChoice } = await import('../whatsapp');

    await sendDeleteGroupChoice('user1', 'Backend API');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.interactive.body.text).toContain('deletar');
    expect(body.interactive.body.text).toContain('grupo');
  });

  it('should send reject prompt message', async () => {
    const { sendRejectPrompt } = await import('../whatsapp');

    await sendRejectPrompt('user1');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.text.body).toContain('grupo do agente');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/whatsapp-ui-groups.test.ts`
Expected: FAIL (functions don't exist)

**Step 3: Add new UI functions**

Add to `src/whatsapp.ts`:

```typescript
/**
 * Send agent mode selector (Conversational vs Ralph)
 */
export async function sendAgentModeSelector(to: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: getRecipientType(to),
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: `*Tipo do agente (imutável)*

💬 *Conversacional*
Responde a cada mensagem individualmente.
Você envia prompt → agente responde → aguarda.

🔄 *Ralph Loop*
Executa tarefas autonomamente em loop.
Você define a tarefa → agente trabalha sozinho
até completar ou atingir limite de iterações.`,
          },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'mode_conversational', title: '💬 Conversacional' } },
              { type: 'reply', reply: { id: 'mode_ralph', title: '🔄 Ralph Loop' } },
            ],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

/**
 * Send model mode selector
 */
export async function sendModelModeSelector(to: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: getRecipientType(to),
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: `*Modo de modelo*

Como o agente deve escolher o modelo Claude?

🔄 *Seleção* (padrão)
Pergunta qual modelo usar a cada prompt.

⚡ *Modelo fixo*
Executa direto com o modelo escolhido.

💡 Use !haiku, !sonnet ou !opus no início
da mensagem para usar outro modelo pontualmente.`,
          },
          action: {
            button: 'Escolher modo',
            sections: [
              {
                title: 'Modo de modelo',
                rows: [
                  { id: 'model_mode_selection', title: '🔄 Seleção', description: 'Pergunta sempre' },
                  { id: 'model_mode_haiku', title: '⚡ Haiku fixo', description: 'Rápido e barato' },
                  { id: 'model_mode_sonnet', title: '🎭 Sonnet fixo', description: 'Equilibrado' },
                  { id: 'model_mode_opus', title: '🎼 Opus fixo', description: 'Mais capaz' },
                ],
              },
            ],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

/**
 * Send delete group choice
 */
export async function sendDeleteGroupChoice(to: string, agentName: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: getRecipientType(to),
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: `⚠️ *Deletar agente "${agentName}"?*

O que fazer com o grupo?`,
          },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'delete_with_group', title: '🗑️ Deletar grupo' } },
              { type: 'reply', reply: { id: 'delete_keep_group', title: '📁 Manter grupo' } },
              { type: 'reply', reply: { id: 'delete_cancel', title: '❌ Cancelar' } },
            ],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

/**
 * Send message rejecting prompt on main number
 */
export async function sendRejectPrompt(to: string): Promise<void> {
  await sendWhatsApp(to, `⚠️ *Prompts não são aceitos aqui.*

Use o grupo do agente para conversar.
Digite / para ver seus agentes.`);
}

/**
 * Send message for unlinked group
 */
export async function sendUnlinkedGroupMessage(to: string): Promise<void> {
  await sendWhatsApp(to, `⚠️ *Grupo não vinculado a nenhum agente.*

Este grupo não está associado a nenhum agente Claude.`);
}
```

**Step 4: Run test**

Run: `bun test src/__tests__/whatsapp-ui-groups.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/whatsapp.ts src/__tests__/whatsapp-ui-groups.test.ts
git commit -m "feat(whatsapp): add UI components for groups flow"
```

---

## Phase 5: Webhook Handler Integration

### Task 5.1: Integrate MessageRouter in Webhook

**Files:**
- Modify: `src/index.ts`

**Step 1: Update imports and initialization**

```typescript
import { MessageRouter } from './message-router';

// After other initializations
const messageRouter = new MessageRouter(agentManager, config.userPhone);
```

**Step 2: Update webhook handler to use router**

Modify the POST /webhook handler:

```typescript
app.post('/webhook', async (c) => {
  const payload = await c.req.json();
  const message = extractMessage(payload);

  if (!message) {
    return c.json({ status: 'ignored' });
  }

  // Authorization: only accept from main user
  const normalizedPhone = config.userPhone.replace('+', '');
  if (!message.from.endsWith(normalizedPhone)) {
    console.log(`Ignored message from ${message.from}`);
    return c.json({ status: 'ignored' });
  }

  const userId = message.from;
  const t0 = Date.now();

  try {
    // Handle button/list interactions (UI flows)
    if (message.type === 'button') {
      return c.json(await handleButtonReply(userId, message.buttonId!, message.groupId));
    }
    if (message.type === 'list') {
      return c.json(await handleListReply(userId, message.listId!, message.messageId, message.groupId));
    }

    // Route text messages
    if (message.type === 'text') {
      // Check for ongoing flow first
      if (userContextManager.isInFlow(userId)) {
        return c.json(await handleFlowMessage(userId, message.text!, message.messageId));
      }

      // Use router for new messages
      const route = messageRouter.route(userId, message.groupId, message.text!);

      switch (route.action) {
        case 'menu':
          await sendAgentsList(userId, agentManager.listAgentsByUser(userId));
          return c.json({ status: 'menu_sent' });

        case 'status':
          return c.json(await handleStatusCommand(userId));

        case 'reset_all':
          return c.json(await handleResetAllCommand(userId));

        case 'bash':
          return c.json(await handleBashCommand(userId, route.command!));

        case 'prompt':
          return c.json(await handleGroupPrompt(
            userId,
            message.groupId!,
            route.agentId!,
            route.text!,
            route.model,
            message.messageId
          ));

        case 'reject_prompt':
          await sendRejectPrompt(userId);
          return c.json({ status: 'rejected' });

        case 'reject_unlinked_group':
          await sendUnlinkedGroupMessage(message.groupId!);
          return c.json({ status: 'rejected' });
      }
    }

    // Handle image/audio as before but with group context
    if (message.type === 'image') {
      return c.json(await handleImageMessage(
        userId, message.text || '', message.imageId!, message.imageMimeType!,
        message.messageId, message.imageUrl, message.groupId
      ));
    }

    return c.json({ status: 'unsupported_type' });
  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const target = message.groupId || userId;
    await sendWhatsApp(target, `❌ Erro interno: ${errorMessage}`);
    return c.json({ status: 'error', message: errorMessage });
  } finally {
    console.log(`[timing] Total: ${Date.now() - t0}ms`);
  }
});
```

**Step 3: Add new handler functions**

```typescript
/**
 * Handle prompt from a group (linked to an agent)
 */
async function handleGroupPrompt(
  userId: string,
  groupId: string,
  agentId: string,
  text: string,
  model: 'haiku' | 'sonnet' | 'opus' | undefined,
  messageId?: string
): Promise<{ status: string }> {
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendWhatsApp(groupId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  // If model not specified and agent uses selection mode, ask
  if (!model && agent.modelMode === 'selection') {
    userContextManager.setPendingPrompt(userId, text, messageId);
    pendingAgentSelection.set(userId, agentId);
    await sendModelSelector(groupId, agent.name);
    return { status: 'awaiting_model' };
  }

  // Use specified model or agent's fixed model
  const finalModel = model || agent.modelMode as 'haiku' | 'sonnet' | 'opus';

  // Queue the task
  queueManager.addTask(agent.id, text, finalModel, userId);
  agentManager.updateAgentStatus(agent.id, 'processing', 'Na fila...');

  await sendWhatsApp(groupId, `⏳ Processando com ${finalModel}...`);
  return { status: 'queued' };
}

/**
 * Handle /status command
 */
async function handleStatusCommand(userId: string): Promise<{ status: string }> {
  const agents = agentManager.listAgentsByUser(userId);

  if (agents.length === 0) {
    await sendWhatsApp(userId, '📭 Nenhum agente criado.\n\nDigite / para criar um agente.');
    return { status: 'no_agents' };
  }

  const lines = agents.map(a => {
    const emoji = a.emoji || '🤖';
    const status = STATUS_EMOJI[a.status];
    const mode = a.modelMode === 'selection' ? '🔄' : `⚡${a.modelMode}`;
    return `${emoji} *${a.name}* ${status}\n   ${mode} | ${a.statusDetails}`;
  });

  await sendWhatsApp(userId, `📊 *Status dos agentes*\n\n${lines.join('\n\n')}`);
  return { status: 'status_sent' };
}

/**
 * Handle /reset all command
 */
async function handleResetAllCommand(userId: string): Promise<{ status: string }> {
  const agents = agentManager.listAgentsByUser(userId);
  let count = 0;

  for (const agent of agents) {
    if (agent.sessionId) {
      terminal.clearSession(userId, agent.id);
      agentManager.clearSessionId(agent.id);
      count++;
    }
  }

  await sendWhatsApp(userId, `✅ ${count} sessão(ões) resetada(s).`);
  return { status: 'reset_all' };
}
```

**Step 4: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(webhook): integrate MessageRouter for group/main routing"
```

---

### Task 5.2: Update Agent Creation to Create Group

**Files:**
- Modify: `src/index.ts` (handleButtonReply, handleCreateAgentConfirmation)

**Step 1: Update create agent confirmation handler**

```typescript
async function handleCreateAgentConfirmation(userId: string): Promise<{ status: string }> {
  const data = userContextManager.getCreateAgentData(userId);
  if (!data?.agentName) {
    userContextManager.clearContext(userId);
    await sendWhatsApp(userId, '❌ Erro no fluxo. Tente novamente.');
    return { status: 'error' };
  }

  try {
    // Create the agent
    const agent = agentManager.createAgent(
      userId,
      data.agentName,
      data.workspace,
      data.emoji,
      data.agentType || 'claude',
      data.modelMode || 'selection'
    );

    // Set the mode
    if (data.agentMode) {
      agentManager.updateAgentMode(agent.id, data.agentMode);
    }

    // Create WhatsApp group
    const dateStr = new Date().toLocaleDateString('pt-BR');
    const modeText = data.agentMode === 'ralph'
      ? '🔄 Ralph: trabalha sozinho até completar'
      : '💬 Conversacional: responde a cada prompt';
    const description = `📁 ${data.workspace || '~'}\n📅 ${dateStr}\n${modeText}`;

    const groupName = `${data.emoji || '🤖'} ${data.agentName}`;

    const groupId = await createWhatsAppGroup(groupName, description, userId);
    agentManager.setGroupId(agent.id, groupId);

    userContextManager.clearContext(userId);

    // Send confirmation to main number
    const modelModeText = data.modelMode === 'selection'
      ? '🔄 Seleção (pergunta sempre)'
      : `⚡ ${data.modelMode} fixo`;

    await sendWhatsApp(userId, `✅ *Agente criado!*

${data.emoji || '🤖'} *${data.agentName}*
📁 ${data.workspace || 'Sem workspace'}
${modeText}
${modelModeText}

💬 Um grupo foi criado para este agente.
Envie mensagens no grupo para interagir.`);

    // Send welcome message to group
    await sendWhatsApp(groupId, `👋 *Olá! Sou ${data.agentName}.*

${modeText}

Envie uma mensagem para começar.`);

    return { status: 'created' };
  } catch (error) {
    console.error('Error creating agent:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendWhatsApp(userId, `❌ Erro ao criar agente: ${errorMsg}`);
    return { status: 'error' };
  }
}
```

**Step 2: Update button handler for new flow steps**

In handleButtonReply, add cases:

```typescript
// Mode selection
if (buttonId === 'mode_conversational') {
  userContextManager.setAgentMode(userId, 'conversational');
  await sendWorkspaceSelector(userId);
  return { status: 'workspace_selector_sent' };
}

if (buttonId === 'mode_ralph') {
  userContextManager.setAgentMode(userId, 'ralph');
  await sendWorkspaceSelector(userId);
  return { status: 'workspace_selector_sent' };
}

// Delete with group choice
if (buttonId === 'delete_with_group') {
  const data = userContextManager.getDeleteAgentData(userId);
  if (data?.agentId) {
    const agent = agentManager.getAgent(data.agentId);
    if (agent?.groupId) {
      try {
        await deleteWhatsAppGroup(agent.groupId);
      } catch (e) {
        console.error('Failed to delete group:', e);
      }
    }
    agentManager.deleteAgent(data.agentId);
    userContextManager.clearContext(userId);
    await sendWhatsApp(userId, `✅ Agente e grupo deletados.`);
  }
  return { status: 'deleted_with_group' };
}

if (buttonId === 'delete_keep_group') {
  const data = userContextManager.getDeleteAgentData(userId);
  if (data?.agentId) {
    agentManager.deleteAgent(data.agentId);
    userContextManager.clearContext(userId);
    await sendWhatsApp(userId, `✅ Agente deletado. Grupo mantido.`);
  }
  return { status: 'deleted_keep_group' };
}
```

**Step 3: Update list reply handler for model mode**

In handleListReply, add cases:

```typescript
// Model mode selection during creation
if (listId === 'model_mode_selection') {
  userContextManager.setAgentModelMode(userId, 'selection');
  await sendCreateAgentConfirmation(userId);
  return { status: 'confirmation_sent' };
}

if (listId === 'model_mode_haiku') {
  userContextManager.setAgentModelMode(userId, 'haiku');
  await sendCreateAgentConfirmation(userId);
  return { status: 'confirmation_sent' };
}

if (listId === 'model_mode_sonnet') {
  userContextManager.setAgentModelMode(userId, 'sonnet');
  await sendCreateAgentConfirmation(userId);
  return { status: 'confirmation_sent' };
}

if (listId === 'model_mode_opus') {
  userContextManager.setAgentModelMode(userId, 'opus');
  await sendCreateAgentConfirmation(userId);
  return { status: 'confirmation_sent' };
}
```

**Step 4: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: create WhatsApp group on agent creation"
```

---

### Task 5.3: Update Delete Flow for Group Choice

**Files:**
- Modify: `src/index.ts` (delete agent flow)
- Modify: `src/user-context-manager.ts`

**Step 1: Update delete flow to ask about group**

In handleButtonReply, modify delete confirmation:

```typescript
if (buttonId.startsWith('delete_agent_')) {
  const agentId = buttonId.replace('delete_agent_', '');
  const agent = agentManager.getAgent(agentId);

  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    return { status: 'not_found' };
  }

  // If agent has a group, ask what to do with it
  if (agent.groupId) {
    userContextManager.startDeleteAgentFlow(userId, agentId);
    await sendDeleteGroupChoice(userId, agent.name);
    return { status: 'awaiting_group_choice' };
  }

  // No group, delete directly
  agentManager.deleteAgent(agentId);
  await sendWhatsApp(userId, `✅ Agente "${agent.name}" deletado.`);
  return { status: 'deleted' };
}
```

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/index.ts src/user-context-manager.ts
git commit -m "feat: add group deletion choice on agent delete"
```

---

## Phase 6: Final Integration and Testing

### Task 6.1: Update Existing Tests

**Files:**
- Modify: `src/__tests__/*.test.ts` (update tests for new fields)

**Step 1: Run all existing tests**

Run: `bun test`
Expected: Some tests may fail due to new required fields

**Step 2: Fix any failing tests**

Add `modelMode: 'selection'` to test agent fixtures where needed.

**Step 3: Commit**

```bash
git add src/__tests__/
git commit -m "test: update tests for modelMode field"
```

---

### Task 6.2: Integration Test

**Step 1: Write integration test**

```typescript
// src/__tests__/integration-groups.test.ts
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { AgentManager } from '../agent-manager';
import { PersistenceService } from '../persistence';
import { MessageRouter } from '../message-router';
import { UserContextManager } from '../user-context-manager';
import { unlinkSync, existsSync } from 'fs';

const TEST_STATE_FILE = './.test-integration-state.json';

describe('Groups Integration', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let router: MessageRouter;
  let contextManager: UserContextManager;

  beforeEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
    router = new MessageRouter(agentManager, '5581999999999');
    contextManager = new UserContextManager();
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  });

  it('should complete full agent creation flow', () => {
    const userId = '5581999999999';

    // Start flow
    contextManager.startCreateAgentFlow(userId);
    expect(contextManager.isAwaitingAgentName(userId)).toBe(true);

    // Set name
    contextManager.setAgentName(userId, 'Backend API');
    expect(contextManager.isAwaitingEmoji(userId)).toBe(true);

    // Set emoji
    contextManager.setAgentEmoji(userId, '🚀');
    expect(contextManager.isAwaitingAgentMode(userId)).toBe(true);

    // Set mode
    contextManager.setAgentMode(userId, 'conversational');
    expect(contextManager.isAwaitingWorkspaceChoice(userId)).toBe(true);

    // Set workspace
    contextManager.setAgentWorkspace(userId, '/Users/lucas/api');
    expect(contextManager.isAwaitingModelMode(userId)).toBe(true);

    // Set model mode
    contextManager.setAgentModelMode(userId, 'opus');
    expect(contextManager.isAwaitingCreateConfirmation(userId)).toBe(true);

    // Create agent
    const data = contextManager.getCreateAgentData(userId);
    const agent = agentManager.createAgent(
      userId,
      data!.agentName!,
      data!.workspace,
      data!.emoji,
      'claude',
      data!.modelMode
    );
    agentManager.setGroupId(agent.id, '120363123456789012@g.us');

    // Verify agent
    expect(agent.name).toBe('Backend API');
    expect(agent.emoji).toBe('🚀');
    expect(agent.workspace).toBe('/Users/lucas/api');
    expect(agent.modelMode).toBe('opus');
    expect(agent.groupId).toBe('120363123456789012@g.us');

    // Route message from group
    const route = router.route(userId, '120363123456789012@g.us', 'Hello!');
    expect(route.action).toBe('prompt');
    expect(route.agentId).toBe(agent.id);
    expect(route.model).toBe('opus'); // Fixed model

    // Route with prefix override
    const override = router.route(userId, '120363123456789012@g.us', '!haiku Quick question');
    expect(override.model).toBe('haiku');
    expect(override.text).toBe('Quick question');
  });

  it('should reject prompts on main number', () => {
    const route = router.route('5581999999999', undefined, 'Hello!');
    expect(route.action).toBe('reject_prompt');
  });

  it('should accept commands on main number', () => {
    expect(router.route('5581999999999', undefined, '/').action).toBe('menu');
    expect(router.route('5581999999999', undefined, '/status').action).toBe('status');
    expect(router.route('5581999999999', undefined, '$ ls').action).toBe('bash');
  });
});
```

**Step 2: Run integration test**

Run: `bun test src/__tests__/integration-groups.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/__tests__/integration-groups.test.ts
git commit -m "test: add integration test for groups feature"
```

---

### Task 6.3: Manual Testing Checklist

**Verify in production:**

1. [ ] Main number receives `/` → shows menu
2. [ ] Main number receives `/status` → shows all agents status
3. [ ] Main number receives `/reset all` → resets all sessions
4. [ ] Main number receives `$ ls` → executes bash
5. [ ] Main number receives text prompt → rejects with message
6. [ ] Create agent flow → creates WhatsApp group
7. [ ] Message in agent group → routes to agent
8. [ ] `!opus text` in group → uses Opus model
9. [ ] Agent with fixed model → doesn't ask for model
10. [ ] Delete agent with group → asks about group
11. [ ] Delete and remove group → group is deleted
12. [ ] Delete and keep group → group persists

---

## Summary

**Total Tasks:** 14 tasks across 6 phases

**Key Changes:**
1. Added `groupId` and `modelMode` to Agent
2. Created `MessageRouter` for routing logic
3. Added WhatsApp Groups API functions
4. Updated all send functions to support groups
5. Extended create agent flow with mode and modelMode steps
6. Added delete flow with group choice
7. Integrated router in webhook handler

**Files Modified:**
- `src/types.ts` - New types and interface updates
- `src/agent-manager.ts` - New methods for groups
- `src/persistence.ts` - Serialization updates
- `src/whatsapp.ts` - Group API + send functions
- `src/user-context-manager.ts` - New flow steps
- `src/index.ts` - Router integration
- `src/message-router.ts` - New file

**Tests Added:**
- `src/__tests__/types.test.ts`
- `src/__tests__/agent-model.test.ts`
- `src/__tests__/agent-manager-groups.test.ts`
- `src/__tests__/whatsapp-groups.test.ts`
- `src/__tests__/whatsapp-send-groups.test.ts`
- `src/__tests__/extract-message-groups.test.ts`
- `src/__tests__/message-router.test.ts`
- `src/__tests__/user-context-groups.test.ts`
- `src/__tests__/whatsapp-ui-groups.test.ts`
- `src/__tests__/integration-groups.test.ts`
