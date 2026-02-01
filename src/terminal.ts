import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { uploadBase64Image, uploadFileToKapso, getWhatsAppMediaType } from './storage';
import { TitleExtractor } from './title-extractor';

export type Model = 'haiku' | 'opus';

export type CreatedFile = {
  path: string;
  mediaId: string;
  filename: string;
  mimeType: string;
  mediaType: 'image' | 'video' | 'audio' | 'document';
};

export type ClaudeResponse = {
  text: string;
  images: string[]; // URLs of uploaded images (legacy, for screenshots)
  files: CreatedFile[]; // Files created by Claude via Write tool
  title?: string;   // Auto-extracted title from response
};

// Session persistence file
const SESSIONS_FILE = './.claude-terminal-sessions.json';

// Store session IDs per user per agent
const sessions = new Map<string, string>();

// Title extractor instance
const titleExtractor = new TitleExtractor();

/**
 * Load sessions from disk on startup
 */
function loadSessionsFromDisk(): void {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const data = readFileSync(SESSIONS_FILE, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, string>;
      for (const [key, value] of Object.entries(parsed)) {
        sessions.set(key, value);
      }
      console.log(`Loaded ${sessions.size} sessions from disk`);
    }
  } catch (err) {
    console.error('Failed to load sessions from disk:', err);
  }
}

/**
 * Save sessions to disk
 */
function saveSessionsToDisk(): void {
  try {
    const data: Record<string, string> = {};
    for (const [key, value] of sessions) {
      data[key] = value;
    }
    writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save sessions to disk:', err);
  }
}

// Load sessions on module initialization
loadSessionsFromDisk();

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
 * Removes the old sessions from the map and persists the change
 */
export function migrateOldSessions(userId: string): { haiku?: string; opus?: string } {
  const haiku = sessions.get(`${userId}_haiku`);
  const opus = sessions.get(`${userId}_opus`);

  // Remove old sessions and persist
  const hadOldSessions = haiku || opus;
  sessions.delete(`${userId}_haiku`);
  sessions.delete(`${userId}_opus`);

  if (hadOldSessions) {
    saveSessionsToDisk();
  }

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
    const createdFilePaths: string[] = [];

    for await (const event of result) {
      // Debug: log all event types
      console.log(`[event] type=${event.type}${event.subtype ? ` subtype=${event.subtype}` : ''}`);

      // Capture session ID from init event
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        newSessionId = event.session_id as string;
      }

      // Capture tool_use events for Write tool to track created files
      if (event.type === 'assistant' && (event as any).message?.content) {
        const content = (event as any).message.content;
        for (const block of content) {
          // Debug: log all content blocks
          console.log(`[block] type=${block.type}${block.name ? ` name=${block.name}` : ''}`);

          // Check for tool_use with Write tool
          if (block.type === 'tool_use' && block.name === 'Write' && block.input?.file_path) {
            const filePath = block.input.file_path as string;
            if (!createdFilePaths.includes(filePath)) {
              createdFilePaths.push(filePath);
              console.log(`[file] Detected file creation: ${filePath}`);
            }
          }

          // Check for tool_result with image (screenshots)
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

    // Upload created files to Kapso
    const files: CreatedFile[] = [];
    for (const filePath of createdFilePaths) {
      try {
        if (existsSync(filePath)) {
          const { mediaId, filename, mimeType } = await uploadFileToKapso(filePath);
          const mediaType = getWhatsAppMediaType(mimeType);
          files.push({ path: filePath, mediaId, filename, mimeType, mediaType });
          console.log(`[file] Uploaded ${filename} (${mediaType})`);
        } else {
          console.warn(`[file] File not found after creation: ${filePath}`);
        }
      } catch (err) {
        console.error(`Failed to upload file ${filePath}:`, err);
      }
    }

    // Store session ID for future messages (and persist to disk)
    if (newSessionId) {
      sessions.set(sessionKey, newSessionId);
      saveSessionsToDisk();
      console.log(`Session stored: ${newSessionId.substring(0, 8)}...`);
    }

    // Extract title from response
    const title = titleExtractor.extract(response, input);

    console.log('Claude response:', response.substring(0, 100) + '...');
    if (images.length > 0) {
      console.log(`[images] ${images.length} image(s) captured`);
    }
    if (files.length > 0) {
      console.log(`[files] ${files.length} file(s) created and uploaded`);
    }
    console.log(`[title] ${title}`);

    return { text: response, images, files, title };
  }

  // Clear session for a user/agent
  clearSession(userId: string, agentId: string): void {
    sessions.delete(getSessionKey(userId, agentId));
    saveSessionsToDisk();
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
    if (keysToDelete.length > 0) {
      saveSessionsToDisk();
    }
    console.log(`All sessions cleared for ${userId} (${keysToDelete.length} sessions)`);
  }

  // Set session ID for a user/agent (used for migration)
  setSession(userId: string, agentId: string, sessionId: string): void {
    const sessionKey = getSessionKey(userId, agentId);
    sessions.set(sessionKey, sessionId);
    saveSessionsToDisk();
    console.log(`Session set for ${userId}/${agentId}: ${sessionId.substring(0, 8)}...`);
  }
}
