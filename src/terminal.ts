import { query } from '@anthropic-ai/claude-agent-sdk';
import { uploadBase64Image } from './storage';

export type Model = 'haiku' | 'opus';

export type ClaudeResponse = {
  text: string;
  images: string[]; // URLs of uploaded images
};

// Store session IDs per user per model
const sessions = new Map<string, string>();

function getSessionKey(userId: string, model: Model): string {
  return `${userId}_${model}`;
}

export class ClaudeTerminal {
  async send(input: string, model: Model = 'haiku', userId: string = 'default'): Promise<ClaudeResponse> {
    const sessionKey = getSessionKey(userId, model);
    const existingSessionId = sessions.get(sessionKey);

    console.log(`Running Claude (SDK) with ${model}${existingSessionId ? ' [resuming session]' : ' [new session]'}...`);

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

    console.log('Claude response:', response.substring(0, 100) + '...');
    if (images.length > 0) {
      console.log(`[images] ${images.length} image(s) captured`);
    }

    return { text: response, images };
  }

  // Clear session for a user (useful for /reset command)
  clearSession(userId: string, model?: Model): void {
    if (model) {
      sessions.delete(getSessionKey(userId, model));
    } else {
      // Clear all models for this user
      sessions.delete(getSessionKey(userId, 'haiku'));
      sessions.delete(getSessionKey(userId, 'opus'));
    }
    console.log(`Session cleared for ${userId}`);
  }
}
