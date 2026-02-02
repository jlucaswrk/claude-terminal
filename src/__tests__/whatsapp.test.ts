import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  formatTimestamp,
  sendAgentsList,
  sendAgentMenu,
  sendHistoryList,
  sendErrorWithActions,
  sendConfigureLimitMenu,
  sendConfigurePriorityMenu,
} from '../whatsapp';
import type { Agent, Output } from '../types';

// Mock fetch globally
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    text: () => Promise.resolve(''),
  })
);

// Store original fetch
const originalFetch = global.fetch;

function createTestAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: crypto.randomUUID(),
    name: 'Test Agent',
    title: 'Working on API',
    status: 'idle',
    statusDetails: 'Aguardando prompt',
    priority: 'medium',
    lastActivity: new Date(),
    messageCount: 0,
    outputs: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function createTestOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: crypto.randomUUID(),
    summary: 'Test summary',
    prompt: 'Test prompt',
    response: 'Test response',
    model: 'opus',
    status: 'success',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('formatTimestamp', () => {
  test('returns "agora" for timestamps less than 1 minute ago', () => {
    const now = new Date();
    expect(formatTimestamp(now)).toBe('agora');

    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    expect(formatTimestamp(thirtySecondsAgo)).toBe('agora');
  });

  test('returns minutes for timestamps less than 1 hour ago', () => {
    const now = new Date();

    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    expect(formatTimestamp(twoMinutesAgo)).toBe('2min');

    const fiftyNineMinutesAgo = new Date(now.getTime() - 59 * 60 * 1000);
    expect(formatTimestamp(fiftyNineMinutesAgo)).toBe('59min');
  });

  test('returns hours for timestamps less than 24 hours ago', () => {
    const now = new Date();

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    expect(formatTimestamp(oneHourAgo)).toBe('1h');

    const twentyThreeHoursAgo = new Date(now.getTime() - 23 * 60 * 60 * 1000);
    expect(formatTimestamp(twentyThreeHoursAgo)).toBe('23h');
  });

  test('returns days for timestamps less than 7 days ago', () => {
    const now = new Date();

    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(formatTimestamp(oneDayAgo)).toBe('1d');

    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    expect(formatTimestamp(sixDaysAgo)).toBe('6d');
  });

  test('returns formatted date for timestamps 7+ days ago', () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const result = formatTimestamp(tenDaysAgo);
    // Should be in dd/mm format
    expect(result).toMatch(/^\d{2}\/\d{2}$/);
  });
});

describe('sendAgentsList', () => {
  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends interactive list message with agents', async () => {
    const agents = [
      createTestAgent({ name: 'Agent 1', status: 'idle' }),
      createTestAgent({ name: 'Agent 2', status: 'processing' }),
    ];

    await sendAgentsList('5511999999999', agents);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.body.text).toContain('Agentes disponíveis (2)');
    expect(body.interactive.action.sections).toHaveLength(2); // Agents, Manage (Commands removed)
    expect(body.interactive.action.sections[0].title).toBe('🤖 Agentes');
    expect(body.interactive.action.sections[0].rows).toHaveLength(2);
  });

  test('sends message with empty agents list', async () => {
    await sendAgentsList('5511999999999', []);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.interactive.body.text).toContain('Nenhum agente criado');
    // Should have Management section only (no agents, no commands)
    expect(body.interactive.action.sections).toHaveLength(1);
  });

  test('limits agents to 8 (WhatsApp 10 row limit minus management)', async () => {
    const agents = Array.from({ length: 15 }, (_, i) =>
      createTestAgent({ name: `Agent ${i + 1}` })
    );

    await sendAgentsList('5511999999999', agents);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const agentRows = body.interactive.action.sections[0].rows;

    // Now max 7 agents (10 rows - 3 management items)
    expect(agentRows).toHaveLength(7);
  });

  test('includes messageId as context when provided', async () => {
    await sendAgentsList('5511999999999', [], 'msg123');

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.context).toEqual({ message_id: 'msg123' });
  });

  test('includes management options', async () => {
    await sendAgentsList('5511999999999', []);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const manageSection = body.interactive.action.sections.find(
      (s: any) => s.title === '⚙️ Gerenciar'
    );

    // Create + bash toggle when no agents (delete not shown)
    expect(manageSection.rows).toHaveLength(2);
    expect(manageSection.rows[0].id).toBe('action_create_agent');
    expect(manageSection.rows[1].id).toBe('action_toggle_bash');
  });
});

describe('sendAgentMenu', () => {
  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends interactive list with agent options', async () => {
    const agent = createTestAgent({
      id: 'agent-123',
      name: 'My Agent',
      statusDetails: 'Criou 3 arquivos',
      status: 'processing',
      priority: 'high',
    });

    await sendAgentMenu('5511999999999', agent);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.body.text).toContain('*My Agent*');
    expect(body.interactive.body.text).toContain('Criou 3 arquivos');
    expect(body.interactive.body.text).toContain('Alta');
  });

  test('includes all menu options', async () => {
    const agent = createTestAgent({ id: 'agent-123' });

    await sendAgentMenu('5511999999999', agent);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const rows = body.interactive.action.sections[0].rows;

    expect(rows).toHaveLength(7);
    expect(rows.map((r: any) => r.id)).toEqual([
      'agentmenu_prompt_agent-123',
      'agentmenu_history_agent-123',
      'agentmenu_emoji_agent-123',
      'agentmenu_priority_agent-123',
      'agentmenu_reset_agent-123',
      'agentmenu_delete_agent-123',
      'agentmenu_back',
    ]);
  });

  test('shows default status for new agent', async () => {
    const agent = createTestAgent({ statusDetails: '' });

    await sendAgentMenu('5511999999999', agent);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.interactive.body.text).toContain('Aguardando prompt');
  });
});

describe('sendHistoryList', () => {
  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends interactive list with outputs', async () => {
    const outputs = [
      createTestOutput({ summary: 'Created files', status: 'success' }),
      createTestOutput({ summary: 'Fixed bug', status: 'warning' }),
      createTestOutput({ summary: 'Failed test', status: 'error' }),
    ];

    await sendHistoryList('5511999999999', 'Backend API', outputs);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.body.text).toContain('📋 Histórico - *Backend API*');
    expect(body.interactive.body.text).toContain('3 interações');
  });

  test('shows most recent first', async () => {
    const outputs = [
      createTestOutput({ id: 'old', summary: 'Old' }),
      createTestOutput({ id: 'new', summary: 'New' }),
    ];

    await sendHistoryList('5511999999999', 'Agent', outputs);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const rows = body.interactive.action.sections[0].rows;

    // Most recent (last added) should be first
    expect(rows[0].id).toBe('history_new');
    expect(rows[1].id).toBe('history_old');
  });

  test('limits to 10 outputs', async () => {
    const outputs = Array.from({ length: 15 }, (_, i) =>
      createTestOutput({ id: `output-${i}` })
    );

    await sendHistoryList('5511999999999', 'Agent', outputs);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const rows = body.interactive.action.sections[0].rows;

    expect(rows).toHaveLength(10);
  });

  test('shows empty state when no outputs', async () => {
    await sendHistoryList('5511999999999', 'Agent', []);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.interactive.body.text).toContain('Nenhuma interação');
    expect(body.interactive.action.sections[0].rows[0].id).toBe('history_empty');
  });

  test('uses status emojis correctly', async () => {
    const outputs = [
      createTestOutput({ summary: 'Success task', status: 'success' }),
    ];

    await sendHistoryList('5511999999999', 'Agent', outputs);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const row = body.interactive.action.sections[0].rows[0];

    expect(row.title).toContain('✅');
  });
});

describe('sendErrorWithActions', () => {
  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends button message with error and actions', async () => {
    await sendErrorWithActions(
      '5511999999999',
      'Backend API',
      'Permission denied'
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('button');
    expect(body.interactive.body.text).toContain('❌ Erro no agente *Backend API*');
    expect(body.interactive.body.text).toContain('Permission denied');
  });

  test('includes three action buttons', async () => {
    await sendErrorWithActions('5511999999999', 'Agent', 'Error');

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const buttons = body.interactive.action.buttons;

    expect(buttons).toHaveLength(3);
    expect(buttons[0].reply.title).toBe('Tentar novamente');
    expect(buttons[1].reply.title).toBe('Ver log');
    expect(buttons[2].reply.title).toBe('Ignorar');
  });

  test('truncates long error messages', async () => {
    const longError = 'x'.repeat(600);

    await sendErrorWithActions('5511999999999', 'Agent', longError);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.interactive.body.text.length).toBeLessThan(600);
    expect(body.interactive.body.text).toContain('...');
  });
});

describe('sendConfigureLimitMenu', () => {
  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends interactive list with limit options', async () => {
    await sendConfigureLimitMenu('5511999999999', 3);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.body.text).toContain('Limite atual: 3 agentes');
  });

  test('shows current selection', async () => {
    await sendConfigureLimitMenu('5511999999999', 5);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const rows = body.interactive.action.sections[0].rows;

    const currentOption = rows.find((r: any) => r.id === 'limit_5');
    expect(currentOption.description).toBe('✓ Atual');
  });

  test('includes all limit options', async () => {
    await sendConfigureLimitMenu('5511999999999', 3);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const rows = body.interactive.action.sections[0].rows;

    expect(rows).toHaveLength(5);
    expect(rows.map((r: any) => r.id)).toEqual([
      'limit_1',
      'limit_3',
      'limit_5',
      'limit_10',
      'limit_0',
    ]);
  });

  test('handles "no limit" option', async () => {
    await sendConfigureLimitMenu('5511999999999', 0);

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.interactive.body.text).toContain('Limite atual: Sem limite');
  });
});

describe('sendConfigurePriorityMenu', () => {
  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('sends interactive list with priority options', async () => {
    await sendConfigurePriorityMenu('5511999999999', 'Backend API', 'medium');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.body.text).toContain('Agente: *Backend API*');
    expect(body.interactive.body.text).toContain('Prioridade atual: Média');
  });

  test('shows current priority selection', async () => {
    await sendConfigurePriorityMenu('5511999999999', 'Agent', 'high');

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const rows = body.interactive.action.sections[0].rows;

    const currentOption = rows.find((r: any) => r.id === 'priority_high');
    expect(currentOption.description).toBe('✓ Atual');
  });

  test('includes all priority options with emojis', async () => {
    await sendConfigurePriorityMenu('5511999999999', 'Agent', 'medium');

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    const rows = body.interactive.action.sections[0].rows;

    expect(rows).toHaveLength(3);
    expect(rows[0].title).toContain('🔴');
    expect(rows[0].title).toContain('Alta');
    expect(rows[1].title).toContain('🟡');
    expect(rows[1].title).toContain('Média');
    expect(rows[2].title).toContain('🟢');
    expect(rows[2].title).toContain('Baixa');
  });

  test('includes messageId as context when provided', async () => {
    await sendConfigurePriorityMenu('5511999999999', 'Agent', 'low', 'msg456');

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);

    expect(body.context).toEqual({ message_id: 'msg456' });
  });
});
