// src/__tests__/workspace-selector-integration.test.ts
/**
 * Integration tests for workspace selector hybrid flows (wsnav:* callbacks)
 *
 * Tests cover:
 * - Recent workspace selection and navigation
 * - Sandbox selection with topic workspace update
 * - Filter apply/clear in directory browser
 * - 12-item pagination in directory listing
 * - Agent workspace selection and tree navigation
 * - State-loss recovery (nav state gone)
 * - Welcome message "⚙️ Workspace" button (topic_workspace: callback)
 * - Recent-workspace persistence after selection
 *
 * These tests simulate the wsnav: callback handler logic from index.ts
 * using real PersistenceService, AgentManager, TopicManager, and UserContextManager.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { AgentManager } from '../agent-manager';
import { TopicManager } from '../topic-manager';
import { UserContextManager } from '../user-context-manager';
import { PersistenceService } from '../persistence';
import { listDirectories, navigateUp, navigateInto } from '../directory-navigator';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AgentTopic, TopicType, TopicStatus } from '../types';

// Test file paths
const TEST_STATE_FILE = './test-ws-selector-int-state.json';
const TEST_LOOPS_DIR = './test-ws-selector-int-loops';
const TEST_PREFS_FILE = './test-ws-selector-int-prefs.json';
const TEST_TOPICS_DIR = './test-ws-selector-int-topics';

// Temporary directory for directory browsing tests
const TEST_BROWSE_DIR = join(tmpdir(), 'ws-selector-integration-test-' + process.pid);

// Mock Telegram API calls
const mockSendTelegramMessage = mock(() => Promise.resolve(null));
const mockSendTelegramButtons = mock(() => Promise.resolve({ message_id: 99999 }));

function cleanup() {
  for (const f of [TEST_STATE_FILE, TEST_STATE_FILE + '.bak', TEST_PREFS_FILE]) {
    if (existsSync(f)) unlinkSync(f);
  }
  for (const dir of [TEST_LOOPS_DIR, TEST_TOPICS_DIR]) {
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const file of files) unlinkSync(join(dir, file));
      rmdirSync(dir);
    }
  }
  if (existsSync(TEST_BROWSE_DIR)) {
    rmSync(TEST_BROWSE_DIR, { recursive: true, force: true });
  }
}

function createTestDirectoryTree() {
  mkdirSync(TEST_BROWSE_DIR, { recursive: true });
  // Create subdirectories for testing
  for (const name of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']) {
    mkdirSync(join(TEST_BROWSE_DIR, name), { recursive: true });
  }
}

function createManySubdirs(parent: string, count: number) {
  for (let i = 0; i < count; i++) {
    mkdirSync(join(parent, `dir-${String(i).padStart(2, '0')}`), { recursive: true });
  }
}

/**
 * Simulate showWorkspaceSelector from index.ts
 * Builds the buttons and sends them, initializes navigation state.
 */
async function simulateShowWorkspaceSelector(
  chatId: number,
  threadId: number | undefined,
  userId: string,
  agentId: string,
  topicId: string,
  agentManager: AgentManager,
  topicManager: TopicManager,
  persistenceService: PersistenceService,
  userContextManager: UserContextManager,
  sendButtons: typeof mockSendTelegramButtons,
): Promise<void> {
  const agent = agentManager.getAgent(agentId);
  const topic = topicManager.getTopic(agentId, topicId);

  const currentWorkspace = topic?.workspace || agent?.workspace || '(sandbox padrão)';
  const source = topic?.workspace ? 'tópico' : agent?.workspace ? 'agente' : 'sandbox';

  const recents = persistenceService.getRecentWorkspaces(userId).slice(0, 3);
  const baseOptions = recents.slice();
  userContextManager.startDirectoryNavigation(userId, agentId, topicId, '', baseOptions);

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  if (agent?.workspace) {
    const shortPath = agent.workspace.length > 30
      ? '...' + agent.workspace.slice(-27)
      : agent.workspace;
    rows.push([
      { text: `🏠 Agente: ${shortPath}`, callback_data: 'wsnav:agent' },
    ]);
  }

  rows.push([
    { text: '🧪 Sandbox', callback_data: 'wsnav:sandbox' },
  ]);

  for (let i = 0; i < recents.length; i++) {
    const shortPath = recents[i].length > 30
      ? '...' + recents[i].slice(-27)
      : recents[i];
    rows.push([
      { text: `📂 ${shortPath}`, callback_data: `wsnav:rec:${i}` },
    ]);
  }

  rows.push([
    { text: '✏️ Digitar caminho base', callback_data: 'wsnav:custom' },
  ]);
  rows.push([
    { text: '❌ Cancelar', callback_data: 'wsnav:cancel' },
  ]);

  const header = `📁 *Workspace atual:* \`${currentWorkspace}\` (${source})\n\n` +
    '*Selecione o workspace para este tópico:*';
  await sendButtons(chatId, header, rows, threadId);
}

/**
 * Simulate showWorkspaceDirectoryBrowser from index.ts
 */
async function simulateShowWorkspaceDirectoryBrowser(
  chatId: number,
  threadId: number | undefined,
  userId: string,
  userContextManager: UserContextManager,
  sendButtons: typeof mockSendTelegramButtons,
  sendMessage: typeof mockSendTelegramMessage,
): Promise<void> {
  const navState = userContextManager.getDirectoryNavigationState(userId);
  if (!navState) {
    await sendMessage(chatId,
      '❌ Estado de navegação perdido. Use /workspace para recomeçar.',
      undefined,
      threadId
    );
    return;
  }

  const listing = listDirectories(navState.currentPath, {
    filter: navState.filter,
    limit: 12,
  });

  userContextManager.updateVisibleDirectories(userId, listing.directories);

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  if (listing.parentPath) {
    rows.push([
      { text: '⬆️ Subir', callback_data: 'wsnav:up' },
      { text: '✅ Selecionar esta pasta', callback_data: 'wsnav:select' },
    ]);
  } else {
    rows.push([
      { text: '✅ Selecionar esta pasta', callback_data: 'wsnav:select' },
    ]);
  }

  if (navState.filter) {
    rows.push([
      { text: '🗑️ Limpar filtro', callback_data: 'wsnav:clearfilter' },
    ]);
  } else {
    rows.push([
      { text: '🔎 Filtrar por nome', callback_data: 'wsnav:filter' },
    ]);
  }

  for (let i = 0; i < listing.directories.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [
      { text: `📁 ${listing.directories[i]}`, callback_data: `wsnav:into:${i}` },
    ];
    if (listing.directories[i + 1]) {
      row.push({ text: `📁 ${listing.directories[i + 1]}`, callback_data: `wsnav:into:${i + 1}` });
    }
    rows.push(row);
  }

  rows.push([
    { text: '❌ Cancelar', callback_data: 'wsnav:cancel' },
  ]);

  let header = `📁 \`${navState.currentPath}\``;
  if (navState.filter) {
    header += `\n🔍 Filtro: "${navState.filter}"`;
  }
  if (listing.truncated) {
    header += `\n_(Mostrando 12 de ${listing.totalFound} pastas)_`;
  }
  if (listing.directories.length === 0) {
    header += '\n\n_Nenhuma subpasta encontrada._';
  }

  await sendButtons(chatId, header, rows, threadId);
}

/**
 * Simulate the wsnav: callback handler from index.ts
 */
async function simulateWsnavCallback(
  data: string,
  chatId: number,
  userId: string,
  agentManager: AgentManager,
  topicManager: TopicManager,
  persistenceService: PersistenceService,
  userContextManager: UserContextManager,
  sendButtons: typeof mockSendTelegramButtons,
  sendMessage: typeof mockSendTelegramMessage,
): Promise<void> {
  if (!data.startsWith('wsnav:')) return;

  const action = data.replace('wsnav:', '');
  const navState = userContextManager.getDirectoryNavigationState(userId);
  const agent = agentManager.getAgentByTelegramChatId(chatId);

  if (!agent || agent.userId !== userId) return;

  const getThreadId = (): number | undefined => {
    if (navState?.targetTopicId) {
      const topic = topicManager.getTopic(agent.id, navState.targetTopicId);
      return topic?.telegramTopicId;
    }
    return undefined;
  };

  if (action === 'agent') {
    if (agent.workspace && navState) {
      userContextManager.updateDirectoryPath(userId, agent.workspace);
      await simulateShowWorkspaceDirectoryBrowser(chatId, getThreadId(), userId, userContextManager, sendButtons, sendMessage);
    }
  }
  else if (action === 'sandbox') {
    const topicId = navState?.targetTopicId;
    if (!topicId) return;

    const sandboxPath = join(tmpdir(), 'sandbox-test', agent.id);
    mkdirSync(sandboxPath, { recursive: true });
    topicManager.updateTopicWorkspace(agent.id, topicId, sandboxPath);
    persistenceService.addRecentWorkspace(userId, sandboxPath);
    const threadId = getThreadId();

    await sendMessage(chatId,
      `✅ Workspace atualizado\n📁 \`${sandboxPath}\``,
      undefined,
      threadId
    );

    userContextManager.clearDirectoryNavigation(userId);
  }
  else if (action.startsWith('rec:')) {
    const idx = parseInt(action.replace('rec:', ''), 10);
    const recents = navState?.baseOptions || persistenceService.getRecentWorkspaces(userId).slice(0, 3);
    const selectedPath = recents[idx];

    if (selectedPath && existsSync(selectedPath)) {
      userContextManager.updateDirectoryPath(userId, selectedPath);
      await simulateShowWorkspaceDirectoryBrowser(chatId, getThreadId(), userId, userContextManager, sendButtons, sendMessage);
    } else {
      await sendMessage(chatId,
        `❌ Caminho não encontrado: \`${selectedPath || '(inválido)'}\``,
        undefined,
        getThreadId()
      );
    }
  }
  else if (action === 'custom') {
    userContextManager.setAwaitingDirectoryInput(userId, 'custom_base_path');
    await sendMessage(chatId,
      '📁 Envie o caminho absoluto do diretório base:\n\n' +
      '_Exemplo: `/Users/lucas/projetos`_',
      undefined,
      getThreadId()
    );
  }
  else if (action === 'up') {
    if (navState) {
      const parentPath = navigateUp(navState.currentPath);
      userContextManager.updateDirectoryPath(userId, parentPath);
      await simulateShowWorkspaceDirectoryBrowser(chatId, getThreadId(), userId, userContextManager, sendButtons, sendMessage);
    }
  }
  else if (action.startsWith('into:')) {
    const idx = parseInt(action.replace('into:', ''), 10);
    if (navState && navState.visibleDirectories[idx]) {
      const newPath = navigateInto(navState.currentPath, navState.visibleDirectories[idx]);
      userContextManager.updateDirectoryPath(userId, newPath);
      await simulateShowWorkspaceDirectoryBrowser(chatId, getThreadId(), userId, userContextManager, sendButtons, sendMessage);
    }
  }
  else if (action === 'select') {
    if (!navState) return;
    const topicId = navState.targetTopicId;
    if (!topicId) return;

    const selectedPath = navState.currentPath;

    let isDirectory = false;
    try {
      isDirectory = statSync(selectedPath).isDirectory();
    } catch {
      // not found
    }

    if (!isDirectory) {
      await sendMessage(chatId,
        `❌ Caminho não encontrado: \`${selectedPath}\``,
        undefined,
        getThreadId()
      );
      return;
    }

    topicManager.updateTopicWorkspace(agent.id, topicId, selectedPath);
    persistenceService.addRecentWorkspace(userId, selectedPath);
    const threadId = getThreadId();

    await sendMessage(chatId,
      `✅ Workspace atualizado\n📁 \`${selectedPath}\``,
      undefined,
      threadId
    );

    userContextManager.clearDirectoryNavigation(userId);
  }
  else if (action === 'filter') {
    userContextManager.setAwaitingDirectoryInput(userId, 'filter');
    await sendMessage(chatId,
      '🔎 Digite o texto do filtro:',
      undefined,
      getThreadId()
    );
  }
  else if (action === 'clearfilter') {
    userContextManager.clearDirectoryFilter(userId);
    await simulateShowWorkspaceDirectoryBrowser(chatId, getThreadId(), userId, userContextManager, sendButtons, sendMessage);
  }
  else if (action === 'cancel') {
    userContextManager.clearDirectoryNavigation(userId);
    await sendMessage(chatId,
      '❌ Seleção de workspace cancelada.',
      undefined,
      getThreadId()
    );
  }
}

describe('Workspace Selector Integration - wsnav: callbacks', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let topicManager: TopicManager;
  let userContextManager: UserContextManager;

  let testAgentId: string;
  let testTopicId: string;

  const userId = 'user-ws-int-test';
  const chatId = -1001234567890;
  const telegramTopicThreadId = 42;

  beforeEach(() => {
    cleanup();
    createTestDirectoryTree();

    persistenceService = new PersistenceService(
      TEST_STATE_FILE,
      TEST_LOOPS_DIR,
      TEST_PREFS_FILE,
      TEST_TOPICS_DIR
    );
    agentManager = new AgentManager(persistenceService);
    topicManager = new TopicManager(persistenceService);
    userContextManager = new UserContextManager();

    // Save user preferences
    persistenceService.saveUserPreferences({
      userId,
      mode: 'dojo',
      telegramUsername: 'testuser',
      onboardingComplete: true,
    });

    // Create agent linked to Telegram group
    const agent = agentManager.createAgent(userId, 'IntTest Agent', TEST_BROWSE_DIR, '🤖', 'claude', 'sonnet');
    testAgentId = agent.id;
    agentManager.setTelegramChatId(agent.id, chatId);

    // Create a topic with a telegramTopicId for thread routing
    const topic: AgentTopic = {
      id: 'topic-ws-int-1',
      agentId: testAgentId,
      telegramTopicId: telegramTopicThreadId,
      type: 'session',
      name: 'Test Topic',
      emoji: '💬',
      status: 'active',
      messageCount: 0,
      createdAt: new Date(),
      lastActivity: new Date(),
    };
    persistenceService.saveTopics(testAgentId, undefined, [topic]);
    testTopicId = topic.id;

    // Reset mocks
    mockSendTelegramMessage.mockClear();
    mockSendTelegramButtons.mockClear();
  });

  afterEach(() => {
    cleanup();
    // Clean sandbox test dirs if created
    const sandboxTest = join(tmpdir(), 'sandbox-test');
    if (existsSync(sandboxTest)) {
      rmSync(sandboxTest, { recursive: true, force: true });
    }
  });

  // ================================================================
  // 1. Welcome "⚙️ Workspace" button (topic_workspace: callback)
  // ================================================================
  describe('Welcome "⚙️ Workspace" button', () => {
    test('topic_workspace: callback opens workspace selector with correct buttons', async () => {
      await simulateShowWorkspaceSelector(
        chatId,
        telegramTopicThreadId,
        userId,
        testAgentId,
        testTopicId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
      );

      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);

      const [sentChatId, sentText, sentRows, sentThreadId] = mockSendTelegramButtons.mock.calls[0];
      expect(sentChatId).toBe(chatId);
      expect(sentThreadId).toBe(telegramTopicThreadId);
      expect(sentText).toContain('Workspace atual');
      expect(sentText).toContain('Selecione o workspace para este tópico');

      // Should have: agent workspace, sandbox, custom, cancel (no recents yet)
      const allButtons = sentRows.flat();
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:agent')).toBe(true);
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:sandbox')).toBe(true);
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:custom')).toBe(true);
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:cancel')).toBe(true);
    });

    test('topic_workspace: shows recent workspaces when available', async () => {
      // Add recent workspaces
      persistenceService.addRecentWorkspace(userId, '/path/recent-a');
      persistenceService.addRecentWorkspace(userId, '/path/recent-b');

      await simulateShowWorkspaceSelector(
        chatId,
        telegramTopicThreadId,
        userId,
        testAgentId,
        testTopicId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
      );

      const [, , sentRows] = mockSendTelegramButtons.mock.calls[0];
      const allButtons = sentRows.flat();
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:rec:0')).toBe(true);
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:rec:1')).toBe(true);
    });

    test('topic_workspace: shows source as "agente" when workspace comes from agent', async () => {
      await simulateShowWorkspaceSelector(
        chatId,
        telegramTopicThreadId,
        userId,
        testAgentId,
        testTopicId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
      );

      const [, sentText] = mockSendTelegramButtons.mock.calls[0];
      expect(sentText).toContain('agente');
    });

    test('topic_workspace: shows source as "tópico" when topic has own workspace', async () => {
      // Set topic workspace
      topicManager.updateTopicWorkspace(testAgentId, testTopicId, '/custom/topic/path');

      await simulateShowWorkspaceSelector(
        chatId,
        telegramTopicThreadId,
        userId,
        testAgentId,
        testTopicId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
      );

      const [, sentText] = mockSendTelegramButtons.mock.calls[0];
      expect(sentText).toContain('tópico');
      expect(sentText).toContain('/custom/topic/path');
    });
  });

  // ================================================================
  // 2. Recent workspace selection
  // ================================================================
  describe('Recent workspace selection (wsnav:rec:*)', () => {
    test('wsnav:rec:0 navigates to first recent workspace and shows directory browser', async () => {
      persistenceService.addRecentWorkspace(userId, TEST_BROWSE_DIR);

      // Initialize nav state as showWorkspaceSelector would
      const recents = persistenceService.getRecentWorkspaces(userId).slice(0, 3);
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, '', recents);

      await simulateWsnavCallback(
        'wsnav:rec:0',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Should show directory browser (sendButtons called with dir listing)
      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const [, sentText, sentRows] = mockSendTelegramButtons.mock.calls[0];
      expect(sentText).toContain(TEST_BROWSE_DIR);

      // Should show subdirectories as buttons
      const allButtons = sentRows.flat();
      expect(allButtons.some((b: any) => b.text.includes('alpha'))).toBe(true);
      expect(allButtons.some((b: any) => b.text.includes('bravo'))).toBe(true);

      // Navigation state should be updated
      const navState = userContextManager.getDirectoryNavigationState(userId);
      expect(navState!.currentPath).toBe(TEST_BROWSE_DIR);
    });

    test('wsnav:rec: with invalid path shows error message', async () => {
      userContextManager.startDirectoryNavigation(
        userId, testAgentId, testTopicId, '',
        ['/nonexistent/recent/path']
      );

      await simulateWsnavCallback(
        'wsnav:rec:0',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramMessage.mock.calls[0];
      expect(sentText).toContain('Caminho não encontrado');
    });
  });

  // ================================================================
  // 3. Sandbox selection
  // ================================================================
  describe('Sandbox selection (wsnav:sandbox)', () => {
    test('wsnav:sandbox updates topic workspace to sandbox path', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, '');

      await simulateWsnavCallback(
        'wsnav:sandbox',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Verify topic workspace was updated
      const topic = topicManager.getTopic(testAgentId, testTopicId);
      expect(topic!.workspace).toBeDefined();
      expect(topic!.workspace).toContain('sandbox-test');

      // Verify recent workspace was persisted
      const recents = persistenceService.getRecentWorkspaces(userId);
      expect(recents.length).toBeGreaterThan(0);
      expect(recents[0]).toContain('sandbox-test');

      // Verify success message
      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramMessage.mock.calls[0];
      expect(sentText).toContain('Workspace atualizado');

      // Verify nav state was cleared
      expect(userContextManager.hasDirectoryNavigation(userId)).toBe(false);
    });
  });

  // ================================================================
  // 4. Agent workspace selection
  // ================================================================
  describe('Agent workspace selection (wsnav:agent)', () => {
    test('wsnav:agent opens directory browser at agent workspace path', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, '');

      await simulateWsnavCallback(
        'wsnav:agent',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Should show directory browser
      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramButtons.mock.calls[0];
      expect(sentText).toContain(TEST_BROWSE_DIR);

      // Navigation state should have agent workspace path
      const navState = userContextManager.getDirectoryNavigationState(userId);
      expect(navState!.currentPath).toBe(TEST_BROWSE_DIR);
    });
  });

  // ================================================================
  // 5. Filter apply/clear
  // ================================================================
  describe('Filter apply/clear (wsnav:filter / wsnav:clearfilter)', () => {
    test('wsnav:filter sets awaiting input for filter', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, TEST_BROWSE_DIR);

      await simulateWsnavCallback(
        'wsnav:filter',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramMessage.mock.calls[0];
      expect(sentText).toContain('filtro');

      const navState = userContextManager.getDirectoryNavigationState(userId);
      expect(navState!.awaitingInput).toBe('filter');
    });

    test('directory browser shows filtered results and "Limpar filtro" button', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, TEST_BROWSE_DIR);
      userContextManager.setDirectoryFilter(userId, 'alpha');

      await simulateShowWorkspaceDirectoryBrowser(
        chatId,
        telegramTopicThreadId,
        userId,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const [, sentText, sentRows] = mockSendTelegramButtons.mock.calls[0];

      // Header should show filter
      expect(sentText).toContain('Filtro: "alpha"');

      // Should show "Limpar filtro" instead of "Filtrar"
      const allButtons = sentRows.flat();
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:clearfilter')).toBe(true);
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:filter')).toBe(false);

      // Should only show matching directories
      const dirButtons = allButtons.filter((b: any) => b.callback_data.startsWith('wsnav:into:'));
      expect(dirButtons.length).toBe(1);
      expect(dirButtons[0].text).toContain('alpha');
    });

    test('wsnav:clearfilter removes filter and refreshes browser', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, TEST_BROWSE_DIR);
      userContextManager.setDirectoryFilter(userId, 'alpha');
      userContextManager.updateVisibleDirectories(userId, ['alpha']);

      await simulateWsnavCallback(
        'wsnav:clearfilter',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Filter should be cleared
      const navState = userContextManager.getDirectoryNavigationState(userId);
      expect(navState!.filter).toBeUndefined();

      // Browser should be refreshed with all directories
      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const [, sentText, sentRows] = mockSendTelegramButtons.mock.calls[0];
      expect(sentText).not.toContain('Filtro');

      // Should show all 6 subdirectories
      const dirButtons = sentRows.flat().filter((b: any) => b.callback_data.startsWith('wsnav:into:'));
      expect(dirButtons.length).toBe(6);
    });
  });

  // ================================================================
  // 6. 12-item pagination
  // ================================================================
  describe('12-item pagination in directory listing', () => {
    test('directory browser shows at most 12 directories and truncation note', async () => {
      // Create 15 subdirectories
      const paginationDir = join(TEST_BROWSE_DIR, 'pagination-test');
      mkdirSync(paginationDir, { recursive: true });
      createManySubdirs(paginationDir, 15);

      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, paginationDir);

      await simulateShowWorkspaceDirectoryBrowser(
        chatId,
        telegramTopicThreadId,
        userId,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const [, sentText, sentRows] = mockSendTelegramButtons.mock.calls[0];

      // Should show truncation note
      expect(sentText).toContain('Mostrando 12 de 15 pastas');

      // Count directory buttons (wsnav:into:*)
      const dirButtons = sentRows.flat().filter((b: any) => b.callback_data.startsWith('wsnav:into:'));
      expect(dirButtons.length).toBe(12);

      // Visible directories should be limited to 12
      const navState = userContextManager.getDirectoryNavigationState(userId);
      expect(navState!.visibleDirectories.length).toBe(12);
    });

    test('directories are arranged 2 per row', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, TEST_BROWSE_DIR);

      await simulateShowWorkspaceDirectoryBrowser(
        chatId,
        telegramTopicThreadId,
        userId,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const [, , sentRows] = mockSendTelegramButtons.mock.calls[0];

      // Find rows with directory buttons
      const dirRows = sentRows.filter((row: any[]) =>
        row.some((b: any) => b.callback_data.startsWith('wsnav:into:'))
      );

      // With 6 dirs, should have 3 rows of 2
      expect(dirRows.length).toBe(3);
      for (const row of dirRows) {
        expect(row.length).toBe(2);
      }
    });
  });

  // ================================================================
  // 7. Directory navigation (into / up / select)
  // ================================================================
  describe('Directory navigation', () => {
    test('wsnav:into:0 navigates into first visible subdirectory', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, TEST_BROWSE_DIR);
      // Set visible directories as the browser would
      userContextManager.updateVisibleDirectories(userId, ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']);

      await simulateWsnavCallback(
        'wsnav:into:0',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const navState = userContextManager.getDirectoryNavigationState(userId);
      expect(navState!.currentPath).toBe(join(TEST_BROWSE_DIR, 'alpha'));

      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramButtons.mock.calls[0];
      expect(sentText).toContain('alpha');
    });

    test('wsnav:up navigates to parent directory', async () => {
      const subPath = join(TEST_BROWSE_DIR, 'alpha');
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, subPath);

      await simulateWsnavCallback(
        'wsnav:up',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const navState = userContextManager.getDirectoryNavigationState(userId);
      expect(navState!.currentPath).toBe(TEST_BROWSE_DIR);
    });

    test('wsnav:select selects current directory, updates topic, persists recent', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, TEST_BROWSE_DIR);

      await simulateWsnavCallback(
        'wsnav:select',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Topic workspace should be updated
      const topic = topicManager.getTopic(testAgentId, testTopicId);
      expect(topic!.workspace).toBe(TEST_BROWSE_DIR);

      // Recent workspaces should include the selected path
      const recents = persistenceService.getRecentWorkspaces(userId);
      expect(recents).toContain(TEST_BROWSE_DIR);

      // Success message sent
      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramMessage.mock.calls[0];
      expect(sentText).toContain('Workspace atualizado');
      expect(sentText).toContain(TEST_BROWSE_DIR);

      // Nav state cleared
      expect(userContextManager.hasDirectoryNavigation(userId)).toBe(false);
    });

    test('wsnav:select with invalid path shows error', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, '/nonexistent/path/xyz');

      await simulateWsnavCallback(
        'wsnav:select',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramMessage.mock.calls[0];
      expect(sentText).toContain('Caminho não encontrado');

      // Topic workspace should NOT be updated
      const topic = topicManager.getTopic(testAgentId, testTopicId);
      expect(topic!.workspace).toBeUndefined();
    });
  });

  // ================================================================
  // 8. State-loss recovery
  // ================================================================
  describe('State-loss recovery', () => {
    test('directory browser shows error when navigation state is lost', async () => {
      // Do NOT start navigation - simulating state loss
      await simulateShowWorkspaceDirectoryBrowser(
        chatId,
        telegramTopicThreadId,
        userId,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramMessage.mock.calls[0];
      expect(sentText).toContain('Estado de navegação perdido');
      expect(sentText).toContain('/workspace');

      // sendButtons should NOT have been called
      expect(mockSendTelegramButtons).not.toHaveBeenCalled();
    });

    test('wsnav:up with no navigation state does nothing', async () => {
      // No nav state
      await simulateWsnavCallback(
        'wsnav:up',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Nothing should happen
      expect(mockSendTelegramButtons).not.toHaveBeenCalled();
      expect(mockSendTelegramMessage).not.toHaveBeenCalled();
    });

    test('wsnav:select with no navigation state does nothing', async () => {
      await simulateWsnavCallback(
        'wsnav:select',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      expect(mockSendTelegramButtons).not.toHaveBeenCalled();
      expect(mockSendTelegramMessage).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  // 9. Cancel flow
  // ================================================================
  describe('Cancel flow (wsnav:cancel)', () => {
    test('wsnav:cancel clears navigation and sends cancel message', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, TEST_BROWSE_DIR);

      await simulateWsnavCallback(
        'wsnav:cancel',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      expect(userContextManager.hasDirectoryNavigation(userId)).toBe(false);
      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramMessage.mock.calls[0];
      expect(sentText).toContain('cancelada');
    });
  });

  // ================================================================
  // 10. Custom base path
  // ================================================================
  describe('Custom base path (wsnav:custom)', () => {
    test('wsnav:custom sets awaiting custom_base_path input', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, TEST_BROWSE_DIR);

      await simulateWsnavCallback(
        'wsnav:custom',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const navState = userContextManager.getDirectoryNavigationState(userId);
      expect(navState!.awaitingInput).toBe('custom_base_path');

      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      const [, sentText] = mockSendTelegramMessage.mock.calls[0];
      expect(sentText).toContain('caminho absoluto');
    });
  });

  // ================================================================
  // 11. Recent workspace persistence after full flow
  // ================================================================
  describe('Recent workspace persistence after selection', () => {
    test('selecting workspace persists it to recent workspaces and survives reload', async () => {
      const targetDir = join(TEST_BROWSE_DIR, 'alpha');
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, targetDir);

      await simulateWsnavCallback(
        'wsnav:select',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Verify persistence
      const recents = persistenceService.getRecentWorkspaces(userId);
      expect(recents).toContain(targetDir);

      // Verify it survives reload
      const persistence2 = new PersistenceService(
        TEST_STATE_FILE,
        TEST_LOOPS_DIR,
        TEST_PREFS_FILE,
        TEST_TOPICS_DIR
      );
      const reloadedRecents = persistence2.getRecentWorkspaces(userId);
      expect(reloadedRecents).toContain(targetDir);
    });

    test('sandbox selection persists to recent workspaces', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, '');

      await simulateWsnavCallback(
        'wsnav:sandbox',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const recents = persistenceService.getRecentWorkspaces(userId);
      expect(recents.length).toBe(1);
      expect(recents[0]).toContain('sandbox-test');
    });
  });

  // ================================================================
  // 12. Topic workspace update verification
  // ================================================================
  describe('Topic workspace update verification', () => {
    test('full flow: open selector -> navigate into subdir -> select updates topic workspace', async () => {
      // Step 1: Open workspace selector
      await simulateShowWorkspaceSelector(
        chatId,
        telegramTopicThreadId,
        userId,
        testAgentId,
        testTopicId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
      );
      mockSendTelegramButtons.mockClear();

      // Step 2: Select agent workspace to start browsing
      await simulateWsnavCallback(
        'wsnav:agent',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Verify directory browser shown at agent workspace
      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const navState1 = userContextManager.getDirectoryNavigationState(userId);
      expect(navState1!.currentPath).toBe(TEST_BROWSE_DIR);
      mockSendTelegramButtons.mockClear();

      // Step 3: Navigate into 'charlie'
      // First get visible dirs from the browser
      const visible = userContextManager.getDirectoryNavigationState(userId)!.visibleDirectories;
      const charlieIdx = visible.indexOf('charlie');
      expect(charlieIdx).toBeGreaterThanOrEqual(0);

      await simulateWsnavCallback(
        `wsnav:into:${charlieIdx}`,
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const navState2 = userContextManager.getDirectoryNavigationState(userId);
      expect(navState2!.currentPath).toBe(join(TEST_BROWSE_DIR, 'charlie'));
      mockSendTelegramButtons.mockClear();

      // Step 4: Select current directory
      await simulateWsnavCallback(
        'wsnav:select',
        chatId,
        userId,
        agentManager,
        topicManager,
        persistenceService,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      // Verify topic workspace updated
      const topic = topicManager.getTopic(testAgentId, testTopicId);
      expect(topic!.workspace).toBe(join(TEST_BROWSE_DIR, 'charlie'));

      // Verify recent workspace persisted
      const recents = persistenceService.getRecentWorkspaces(userId);
      expect(recents[0]).toBe(join(TEST_BROWSE_DIR, 'charlie'));

      // Verify nav state cleared
      expect(userContextManager.hasDirectoryNavigation(userId)).toBe(false);
    });
  });

  // ================================================================
  // 13. Directory browser UI details
  // ================================================================
  describe('Directory browser UI', () => {
    test('browser shows "Subir" button when not at root', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, join(TEST_BROWSE_DIR, 'alpha'));

      await simulateShowWorkspaceDirectoryBrowser(
        chatId,
        telegramTopicThreadId,
        userId,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const [, , sentRows] = mockSendTelegramButtons.mock.calls[0];
      const allButtons = sentRows.flat();
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:up')).toBe(true);
      expect(allButtons.some((b: any) => b.callback_data === 'wsnav:select')).toBe(true);
    });

    test('browser shows no subdirectories message for empty directory', async () => {
      const emptyDir = join(TEST_BROWSE_DIR, 'alpha');
      // alpha has no subdirectories
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, emptyDir);

      await simulateShowWorkspaceDirectoryBrowser(
        chatId,
        telegramTopicThreadId,
        userId,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const [, sentText] = mockSendTelegramButtons.mock.calls[0];
      expect(sentText).toContain('Nenhuma subpasta encontrada');
    });

    test('browser at root shows no "Subir" button', async () => {
      userContextManager.startDirectoryNavigation(userId, testAgentId, testTopicId, '/');

      await simulateShowWorkspaceDirectoryBrowser(
        chatId,
        telegramTopicThreadId,
        userId,
        userContextManager,
        mockSendTelegramButtons,
        mockSendTelegramMessage,
      );

      const [, , sentRows] = mockSendTelegramButtons.mock.calls[0];
      // First row should only have "Selecionar" (no "Subir")
      expect(sentRows[0].length).toBe(1);
      expect(sentRows[0][0].callback_data).toBe('wsnav:select');
    });
  });
});
