import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { PersistenceService } from '../persistence';
import type { Agent, SystemConfig } from '../types';
import { DEFAULTS } from '../types';

const TEST_STATE_FILE = './test-agents-state.json';
const TEST_BACKUP_FILE = './test-agents-state.json.bak';

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-uuid-1234',
    userId: 'user-123',
    name: 'Test Agent',
    type: 'claude',
    mode: 'conversational',
    emoji: '🤖',
    workspace: '/test/workspace',
    modelMode: 'selection',
    mainSessionId: 'session-123',
    topics: [],
    title: 'Test conversation',
    status: 'idle',
    statusDetails: 'Ready',
    priority: 'medium',
    lastActivity: new Date('2024-01-15T10:00:00.000Z'),
    messageCount: 5,
    outputs: [
      {
        id: 'output-1',
        summary: 'Created test files',
        prompt: 'create test files',
        response: 'I created the test files...',
        model: 'opus',
        status: 'success',
        timestamp: new Date('2024-01-15T09:30:00.000Z'),
      },
    ],
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createMockConfig(): SystemConfig {
  return {
    maxConcurrent: 3,
    version: DEFAULTS.SCHEMA_VERSION,
  };
}

function cleanup() {
  if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  if (existsSync(TEST_BACKUP_FILE)) unlinkSync(TEST_BACKUP_FILE);
}

describe('PersistenceService', () => {
  let service: PersistenceService;

  beforeEach(() => {
    cleanup();
    service = new PersistenceService(TEST_STATE_FILE);
  });

  afterEach(() => {
    cleanup();
  });

  describe('save', () => {
    test('creates JSON file with correct structure', () => {
      const config = createMockConfig();
      const agents = [createMockAgent()];

      service.save({ config, agents });

      expect(existsSync(TEST_STATE_FILE)).toBe(true);

      const content = readFileSync(TEST_STATE_FILE, 'utf-8');
      const data = JSON.parse(content);

      expect(data.version).toBe(DEFAULTS.SCHEMA_VERSION);
      expect(data.config.maxConcurrent).toBe(3);
      expect(data.agents).toHaveLength(1);
      expect(data.agents[0].name).toBe('Test Agent');
    });

    test('serializes dates as ISO strings', () => {
      const config = createMockConfig();
      const agent = createMockAgent({
        lastActivity: new Date('2024-06-15T12:00:00.000Z'),
      });

      service.save({ config, agents: [agent] });

      const content = readFileSync(TEST_STATE_FILE, 'utf-8');
      const data = JSON.parse(content);

      expect(data.agents[0].lastActivity).toBe('2024-06-15T12:00:00.000Z');
    });

    test('creates backup before overwriting', () => {
      const config = createMockConfig();

      // First save
      service.save({ config, agents: [createMockAgent({ name: 'First' })] });

      // Second save should create backup
      service.save({ config, agents: [createMockAgent({ name: 'Second' })] });

      expect(existsSync(TEST_BACKUP_FILE)).toBe(true);

      const backupContent = readFileSync(TEST_BACKUP_FILE, 'utf-8');
      const backupData = JSON.parse(backupContent);
      expect(backupData.agents[0].name).toBe('First');

      const mainContent = readFileSync(TEST_STATE_FILE, 'utf-8');
      const mainData = JSON.parse(mainContent);
      expect(mainData.agents[0].name).toBe('Second');
    });
  });

  describe('load', () => {
    test('returns null if file does not exist', () => {
      const result = service.load();
      expect(result).toBeNull();
    });

    test('loads and deserializes state correctly', () => {
      const config = createMockConfig();
      const agent = createMockAgent();
      service.save({ config, agents: [agent] });

      const result = service.load();

      expect(result).not.toBeNull();
      expect(result!.config.maxConcurrent).toBe(3);
      expect(result!.agents).toHaveLength(1);
      expect(result!.agents[0].name).toBe('Test Agent');
      expect(result!.agents[0].lastActivity).toBeInstanceOf(Date);
      expect(result!.agents[0].outputs[0].timestamp).toBeInstanceOf(Date);
    });

    test('returns null for invalid JSON', () => {
      Bun.write(TEST_STATE_FILE, 'not valid json');

      const result = service.load();
      expect(result).toBeNull();
    });

    test('returns null for invalid schema', () => {
      Bun.write(TEST_STATE_FILE, JSON.stringify({ invalid: 'schema' }));

      const result = service.load();
      expect(result).toBeNull();
    });

    test('falls back to backup when main file is invalid', () => {
      const config = createMockConfig();

      // Create valid backup manually
      const validState = {
        version: DEFAULTS.SCHEMA_VERSION,
        config: { maxConcurrent: 5, version: DEFAULTS.SCHEMA_VERSION },
        agents: [
          {
            id: 'backup-agent',
            name: 'Backup Agent',
            title: 'Backup',
            status: 'idle',
            statusDetails: 'Ready',
            priority: 'low',
            lastActivity: '2024-01-01T00:00:00.000Z',
            messageCount: 0,
            outputs: [],
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      };
      Bun.write(TEST_BACKUP_FILE, JSON.stringify(validState));

      // Create invalid main file
      Bun.write(TEST_STATE_FILE, 'corrupted data');

      const result = service.load();

      expect(result).not.toBeNull();
      expect(result!.agents[0].name).toBe('Backup Agent');
      expect(result!.config.maxConcurrent).toBe(5);
    });
  });

  describe('schema validation', () => {
    test('rejects missing version', () => {
      Bun.write(
        TEST_STATE_FILE,
        JSON.stringify({
          config: { maxConcurrent: 3, version: '1.0' },
          agents: [],
        })
      );

      expect(service.load()).toBeNull();
    });

    test('rejects missing config', () => {
      Bun.write(
        TEST_STATE_FILE,
        JSON.stringify({
          version: '1.0',
          agents: [],
        })
      );

      expect(service.load()).toBeNull();
    });

    test('rejects invalid agent status', () => {
      Bun.write(
        TEST_STATE_FILE,
        JSON.stringify({
          version: '1.0',
          config: { maxConcurrent: 3, version: '1.0' },
          agents: [
            {
              id: 'test',
              name: 'Test',
              title: 'Test',
              status: 'invalid_status',
              statusDetails: 'Ready',
              priority: 'medium',
              lastActivity: '2024-01-01T00:00:00.000Z',
              messageCount: 0,
              outputs: [],
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        })
      );

      expect(service.load()).toBeNull();
    });

    test('rejects invalid agent priority', () => {
      Bun.write(
        TEST_STATE_FILE,
        JSON.stringify({
          version: '1.0',
          config: { maxConcurrent: 3, version: '1.0' },
          agents: [
            {
              id: 'test',
              name: 'Test',
              title: 'Test',
              status: 'idle',
              statusDetails: 'Ready',
              priority: 'invalid_priority',
              lastActivity: '2024-01-01T00:00:00.000Z',
              messageCount: 0,
              outputs: [],
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        })
      );

      expect(service.load()).toBeNull();
    });

    test('accepts valid minimal agent', () => {
      Bun.write(
        TEST_STATE_FILE,
        JSON.stringify({
          version: '1.0',
          config: { maxConcurrent: 3, version: '1.0' },
          agents: [
            {
              id: 'test',
              name: 'Test',
              title: 'Test',
              status: 'idle',
              statusDetails: 'Ready',
              priority: 'high',
              lastActivity: '2024-01-01T00:00:00.000Z',
              messageCount: 0,
              outputs: [],
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        })
      );

      const result = service.load();
      expect(result).not.toBeNull();
      expect(result!.agents[0].priority).toBe('high');
    });
  });

  describe('file paths', () => {
    test('returns correct state file path', () => {
      expect(service.getStateFilePath()).toBe(TEST_STATE_FILE);
    });

    test('returns correct backup file path', () => {
      expect(service.getBackupFilePath()).toBe(TEST_BACKUP_FILE);
    });
  });
});
