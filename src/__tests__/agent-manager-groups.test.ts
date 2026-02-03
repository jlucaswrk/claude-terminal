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
    // Also clean up backup file
    const backupFile = TEST_STATE_FILE + '.bak';
    if (existsSync(backupFile)) unlinkSync(backupFile);
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

  it('should return undefined for non-existent groupId', () => {
    const agent = agentManager.createAgent('user1', 'Test Agent');
    const found = agentManager.getAgentByGroupId('non-existent-group');
    expect(found).toBeUndefined();
  });

  it('should update modelMode', () => {
    const agent = agentManager.createAgent('user1', 'Test Agent');
    agentManager.setModelMode(agent.id, 'sonnet');
    const updated = agentManager.getAgent(agent.id);
    expect(updated?.modelMode).toBe('sonnet');
  });

  it('should return false when setting groupId for non-existent agent', () => {
    const result = agentManager.setGroupId('non-existent-id', '120363123456789012@g.us');
    expect(result).toBe(false);
  });

  it('should return false when setting modelMode for non-existent agent', () => {
    const result = agentManager.setModelMode('non-existent-id', 'haiku');
    expect(result).toBe(false);
  });

  it('should persist groupId and modelMode', () => {
    const agent = agentManager.createAgent('user1', 'Test Agent', undefined, undefined, 'claude', 'sonnet');
    agentManager.setGroupId(agent.id, '120363123456789012@g.us');

    // Create new manager from persisted state
    const newPersistenceService = new PersistenceService(TEST_STATE_FILE);
    const newAgentManager = new AgentManager(newPersistenceService);

    const loadedAgent = newAgentManager.getAgent(agent.id);
    expect(loadedAgent?.modelMode).toBe('sonnet');
    expect(loadedAgent?.groupId).toBe('120363123456789012@g.us');
  });

  it('should default modelMode to "selection" when loading old agents', async () => {
    // Create an agent and save
    const agent = agentManager.createAgent('user1', 'Test Agent');

    // Manually read and modify the persisted state to simulate old format
    const file = Bun.file(TEST_STATE_FILE);
    const text = await file.text();
    const content = JSON.parse(text);
    delete content.agents[0].modelMode;
    await Bun.write(TEST_STATE_FILE, JSON.stringify(content, null, 2));

    // Create new manager from modified state
    const newPersistenceService = new PersistenceService(TEST_STATE_FILE);
    const newAgentManager = new AgentManager(newPersistenceService);

    const loadedAgent = newAgentManager.getAgent(agent.id);
    expect(loadedAgent?.modelMode).toBe('selection');
  });
});
