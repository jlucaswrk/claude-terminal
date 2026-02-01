import { query } from '@anthropic-ai/claude-agent-sdk';
import { uploadBase64Image } from './storage';
import { TitleExtractor } from './title-extractor';

export type Model = 'haiku' | 'opus';

export type ClaudeResponse = {
  text: string;
  images: string[]; // URLs of uploaded images
  title?: string;   // Auto-extracted title from response
};

// Store session IDs per user per agent
const sessions = new Map<string, string>();

// Title extractor instance
const titleExtractor = new TitleExtractor();

function getSessionKey(userId: string, agentId: string): string {
  return `${userId}_${agentId}`;
}

/**
 * Check if old-style sessions exist for a user (${userId}_haiku or ${userId}_opus)
 */
export function detectOldSessions(userId: string): boolean {
  const oldKeys = [`${userId}_haiku`, `${userId}_opus`];
  return oldKeys.some(key => sessions.has(key));
}

/**
 * Migrate old-style sessions and return their session IDs
 * Removes the old sessions from the map
 */
export function migrateOldSessions(userId: string): { haiku?: string; opus?: string } {
  const haiku = sessions.get(`${userId}_haiku`);
  const opus = sessions.get(`${userId}_opus`);

  // Remove old sessions
  sessions.delete(`${userId}_haiku`);
  sessions.delete(`${userId}_opus`);

  return { haiku, opus };
}

export class ClaudeTerminal {
  async send(
    input: string,
    model: Model,
    userId: string,
    agentId: string,
    workspace?: string
  ): Promise<ClaudeResponse> {
    const sessionKey = getSessionKey(userId, agentId);
    const existingSessionId = sessions.get(sessionKey);

    console.log(`Running Claude (SDK) with ${model}${existingSessionId ? ' [resuming session]' : ' [new session]'}${workspace ? ` in ${workspace}` : ''}...`);

    const result = query({
      prompt: input,
      options: {
        model,
        // Keep essential tools for terminal functionality
        tools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
        // MCP servers for web access
        mcpServers: [
          {
            name: 'firecrawl',
            command: 'npx',
            args: ['-y', 'firecrawl-mcp'],
            env: {
              FIRECRAWL_API_KEY: 'fc-d147bf869b0e49ef8407dffbbc017020',
            },
          },
          {
            name: 'browser',
            command: 'npx',
            args: ['@browsermcp/mcp@latest'],
          },
          {
            name: 'auggie',
            command: 'auggie',
            args: ['--mcp', '--mcp-auto-workspace', '--augment-token-file', '/Users/lucas/.augment/session.json'],
          },
        ],
        // Allow execution without permission prompts
        permissionMode: 'bypassPermissions',
        dangerouslySkipPermissions: true,
        // Resume existing session if available
        ...(existingSessionId && { resume: existingSessionId }),
        // Set working directory if workspace provided
        ...(workspace && { cwd: workspace }),
      }
    });

    let response = '';
    let newSessionId: string | undefined;
    const images: string[] = [];

    for await (const event of result) {
      // Capture session ID from init event
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        newSessionId = event.session_id as string;
      }

      // Capture tool results with images (screenshots)
      if (event.type === 'assistant' && (event as any).message?.content) {
        const content = (event as any).message.content;
        for (const block of content) {
          // Check for tool_result with image
          if (block.type === 'tool_result' && Array.isArray(block.content)) {
            for (const item of block.content) {
              if (item.type === 'image' && item.source?.type === 'base64') {
                try {
                  const imageData = `data:${item.source.media_type};base64,${item.source.data}`;
                  const imageUrl = await uploadBase64Image(imageData, 'screenshot.png');
                  images.push(imageUrl);
                  console.log(`[image] Uploaded screenshot`);
                } catch (err) {
                  console.error('Failed to upload image:', err);
                }
              }
            }
          }
        }
      }

      // Get the final result
      if (event.type === 'result' && event.result) {
        response = event.result as string;
        // Also try to get session_id from result
        if ((event as any).session_id) {
          newSessionId = (event as any).session_id;
        }
      }
    }

    // Store session ID for future messages
    if (newSessionId) {
      sessions.set(sessionKey, newSessionId);
      console.log(`Session stored: ${newSessionId.substring(0, 8)}...`);
    }

    // Extract title from response
    const title = titleExtractor.extract(response, input);

    console.log('Claude response:', response.substring(0, 100) + '...');
    if (images.length > 0) {
      console.log(`[images] ${images.length} image(s) captured`);
    }
    console.log(`[title] ${title}`);

    return { text: response, images, title };
  }

  // Clear session for a user/agent
  clearSession(userId: string, agentId: string): void {
    sessions.delete(getSessionKey(userId, agentId));
    console.log(`Session cleared for ${userId}/${agentId}`);
  }

  // Clear all sessions for a user (useful for /reset command)
  clearAllSessions(userId: string): void {
    const keysToDelete: string[] = [];
    for (const key of sessions.keys()) {
      if (key.startsWith(`${userId}_`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      sessions.delete(key);
    }
    console.log(`All sessions cleared for ${userId} (${keysToDelete.length} sessions)`);
  }

  // Set session ID for a user/agent (used for migration)
  setSession(userId: string, agentId: string, sessionId: string): void {
    const sessionKey = getSessionKey(userId, agentId);
    sessions.set(sessionKey, sessionId);
    console.log(`Session set for ${userId}/${agentId}: ${sessionId.substring(0, 8)}...`);
  }
}
