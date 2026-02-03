import { describe, it, expect } from 'bun:test';
import type { Agent, ModelMode, TopicType, TopicStatus, AgentTopic, AgentTopicsFile } from '../types';

describe('ModelMode type', () => {
  it('should accept valid model mode values', () => {
    const modes: ModelMode[] = ['selection', 'haiku', 'sonnet', 'opus'];
    expect(modes).toHaveLength(4);
  });

  it('should be usable in type assertions', () => {
    const selection: ModelMode = 'selection';
    const haiku: ModelMode = 'haiku';
    const sonnet: ModelMode = 'sonnet';
    const opus: ModelMode = 'opus';

    expect(selection).toBe('selection');
    expect(haiku).toBe('haiku');
    expect(sonnet).toBe('sonnet');
    expect(opus).toBe('opus');
  });
});

describe('TopicType type', () => {
  it('should accept valid topic type values', () => {
    const types: TopicType[] = ['general', 'ralph', 'worktree', 'session'];
    expect(types).toHaveLength(4);
  });

  it('should be usable in type assertions', () => {
    const general: TopicType = 'general';
    const ralph: TopicType = 'ralph';
    const worktree: TopicType = 'worktree';
    const session: TopicType = 'session';

    expect(general).toBe('general');
    expect(ralph).toBe('ralph');
    expect(worktree).toBe('worktree');
    expect(session).toBe('session');
  });
});

describe('TopicStatus type', () => {
  it('should accept valid topic status values', () => {
    const statuses: TopicStatus[] = ['active', 'closed'];
    expect(statuses).toHaveLength(2);
  });

  it('should be usable in type assertions', () => {
    const active: TopicStatus = 'active';
    const closed: TopicStatus = 'closed';

    expect(active).toBe('active');
    expect(closed).toBe('closed');
  });
});

describe('AgentTopic interface', () => {
  it('should have all required fields', () => {
    const topic: AgentTopic = {
      id: 'topic-123',
      agentId: 'agent-456',
      telegramTopicId: 789,
      type: 'session',
      name: 'Test Topic',
      emoji: '💬',
      status: 'active',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    expect(topic.id).toBe('topic-123');
    expect(topic.agentId).toBe('agent-456');
    expect(topic.telegramTopicId).toBe(789);
    expect(topic.type).toBe('session');
    expect(topic.name).toBe('Test Topic');
    expect(topic.emoji).toBe('💬');
    expect(topic.status).toBe('active');
    expect(topic.createdAt).toBeInstanceOf(Date);
    expect(topic.lastActivity).toBeInstanceOf(Date);
  });

  it('should allow optional sessionId and loopId', () => {
    const topicWithSession: AgentTopic = {
      id: 'topic-1',
      agentId: 'agent-1',
      telegramTopicId: 123,
      type: 'worktree',
      name: 'Feature Branch',
      emoji: '🌿',
      sessionId: 'session-isolated',
      status: 'active',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    const topicWithLoop: AgentTopic = {
      id: 'topic-2',
      agentId: 'agent-1',
      telegramTopicId: 456,
      type: 'ralph',
      name: 'Autonomous Task',
      emoji: '🔄',
      sessionId: 'session-ralph',
      loopId: 'loop-789',
      status: 'active',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    expect(topicWithSession.sessionId).toBe('session-isolated');
    expect(topicWithSession.loopId).toBeUndefined();
    expect(topicWithLoop.loopId).toBe('loop-789');
  });

  it('should support general topic without sessionId', () => {
    const generalTopic: AgentTopic = {
      id: 'topic-general',
      agentId: 'agent-1',
      telegramTopicId: 0, // General topic
      type: 'general',
      name: 'General',
      emoji: '📌',
      // No sessionId - uses agent's mainSessionId
      status: 'active',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    expect(generalTopic.type).toBe('general');
    expect(generalTopic.sessionId).toBeUndefined();
  });
});

describe('AgentTopicsFile interface', () => {
  it('should have all required fields', () => {
    const file: AgentTopicsFile = {
      agentId: 'agent-123',
      mainSessionId: 'main-session-456',
      topics: [],
    };

    expect(file.agentId).toBe('agent-123');
    expect(file.mainSessionId).toBe('main-session-456');
    expect(file.topics).toHaveLength(0);
  });

  it('should allow undefined mainSessionId', () => {
    const file: AgentTopicsFile = {
      agentId: 'agent-123',
      topics: [],
    };

    expect(file.mainSessionId).toBeUndefined();
  });

  it('should contain AgentTopic array', () => {
    const topic: AgentTopic = {
      id: 'topic-1',
      agentId: 'agent-123',
      telegramTopicId: 789,
      type: 'session',
      name: 'Test',
      emoji: '💬',
      status: 'active',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    const file: AgentTopicsFile = {
      agentId: 'agent-123',
      mainSessionId: 'session',
      topics: [topic],
    };

    expect(file.topics).toHaveLength(1);
    expect(file.topics[0].id).toBe('topic-1');
  });
});

describe('Agent with groupId and modelMode', () => {
  it('should have optional groupId field', () => {
    // Type assertion to verify groupId is a valid key of Agent
    const groupIdKey: keyof Agent = 'groupId';
    expect(groupIdKey).toBe('groupId');

    // Test value assignment
    const agent: Pick<Agent, 'id' | 'groupId'> = {
      id: 'test-id',
      groupId: '120363123456789012@g.us',
    };
    expect(agent.groupId).toBe('120363123456789012@g.us');
  });

  it('should have modelMode field with default selection', () => {
    // Type assertion to verify modelMode is a valid key of Agent
    const modelModeKey: keyof Agent = 'modelMode';
    expect(modelModeKey).toBe('modelMode');

    // Test value assignment
    const agent: Pick<Agent, 'id' | 'modelMode'> = {
      id: 'test-id',
      modelMode: 'selection',
    };
    expect(agent.modelMode).toBe('selection');
  });

  it('should allow fixed model modes', () => {
    const modes: ModelMode[] = ['haiku', 'sonnet', 'opus'];
    modes.forEach(mode => {
      const agent: Pick<Agent, 'modelMode'> = { modelMode: mode };
      expect(agent.modelMode).toBe(mode);
    });
  });
});

describe('Agent with mainSessionId and topics', () => {
  it('should have optional mainSessionId field', () => {
    const mainSessionIdKey: keyof Agent = 'mainSessionId';
    expect(mainSessionIdKey).toBe('mainSessionId');

    const agent: Pick<Agent, 'id' | 'mainSessionId'> = {
      id: 'test-id',
      mainSessionId: 'main-session-123',
    };
    expect(agent.mainSessionId).toBe('main-session-123');
  });

  it('should have required topics array field', () => {
    const topicsKey: keyof Agent = 'topics';
    expect(topicsKey).toBe('topics');

    const agent: Pick<Agent, 'id' | 'topics'> = {
      id: 'test-id',
      topics: [],
    };
    expect(agent.topics).toHaveLength(0);
  });

  it('should allow topics with various types', () => {
    const topics: AgentTopic[] = [
      {
        id: 'topic-1',
        agentId: 'agent-1',
        telegramTopicId: 100,
        type: 'general',
        name: 'General',
        emoji: '📌',
        status: 'active',
        createdAt: new Date(),
        lastActivity: new Date(),
      },
      {
        id: 'topic-2',
        agentId: 'agent-1',
        telegramTopicId: 200,
        type: 'ralph',
        name: 'Auth Task',
        emoji: '🔄',
        sessionId: 'ralph-session',
        loopId: 'loop-123',
        status: 'active',
        createdAt: new Date(),
        lastActivity: new Date(),
      },
    ];

    const agent: Pick<Agent, 'id' | 'topics'> = {
      id: 'test-id',
      topics,
    };

    expect(agent.topics).toHaveLength(2);
    expect(agent.topics[0].type).toBe('general');
    expect(agent.topics[1].type).toBe('ralph');
    expect(agent.topics[1].loopId).toBe('loop-123');
  });
});
