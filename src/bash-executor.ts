/**
 * Bash command executor for direct terminal access
 */

import type { BashResult } from './types';
import { DEFAULTS } from './types';

/**
 * Patterns that indicate dangerous commands
 */
const BLOCKED_PATTERNS = [
  /^sudo\s/i,                           // sudo commands
  /^su\s/i,                             // switch user
  /rm\s+(-[a-z]*)?-rf?\s+\/($|\s)/i,    // rm -rf /
  /rm\s+(-[a-z]*)?-rf?\s+\/\*\s*$/i,    // rm -rf /*
  /rm\s+(-[a-z]*)?-rf?\s+~\/?$/i,       // rm -rf ~ or rm -rf ~/
  /mkfs\./i,                            // filesystem formatting
  /dd\s+if=/i,                          // dd commands
  />\s*\/dev\/sd[a-z]/i,                // writing to disk devices
  />\s*\/dev\/nvme/i,                   // writing to nvme devices
  /shutdown/i,                          // shutdown
  /reboot/i,                            // reboot
  /halt/i,                              // halt
  /poweroff/i,                          // poweroff
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,     // fork bomb
  /chmod\s+(-[a-z]+\s+)?777\s+\//i,     // chmod 777 on root
  /chown\s+(-[a-z]+\s+)?root/i,         // chown to root
];

/**
 * User-friendly message when command is blocked
 */
const BLOCKED_MESSAGE = `Esse tipo de comando é arriscado demais pra executar pelo celular.
Vá até a máquina e execute diretamente no terminal.`;

/**
 * Check if a command should be blocked
 */
export function isBlockedCommand(command: string): { blocked: boolean; reason?: string } {
  const trimmed = command.trim();

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        blocked: true,
        reason: `Comando bloqueado: ${trimmed.slice(0, 50)}${trimmed.length > 50 ? '...' : ''}`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Execute a bash command
 */
export async function executeCommand(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    maxOutput?: number;
  } = {}
): Promise<BashResult> {
  const {
    cwd = process.env.HOME || '/tmp',
    timeout = DEFAULTS.BASH_TIMEOUT,
    maxOutput = DEFAULTS.BASH_MAX_OUTPUT,
  } = options;

  const startTime = Date.now();

  // Check for blocked commands
  const blockCheck = isBlockedCommand(command);
  if (blockCheck.blocked) {
    return {
      command,
      output: '',
      exitCode: -1,
      duration: Date.now() - startTime,
      truncated: false,
      blocked: true,
      blockReason: blockCheck.reason,
    };
  }

  try {
    // Use Bun.spawn to execute the command
    const proc = Bun.spawn(['bash', '-c', command], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        // Force non-interactive mode
        TERM: 'dumb',
        // Disable colors in common tools
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    });

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error('Command timed out'));
      }, timeout);
    });

    // Wait for completion or timeout
    const exitCode = await Promise.race([proc.exited, timeoutPromise]);

    // Read output
    const stdoutReader = proc.stdout.getReader();
    const stderrReader = proc.stderr.getReader();

    let stdout = '';
    let stderr = '';
    let totalSize = 0;
    let truncated = false;

    // Read stdout
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      totalSize += chunk.length;
      if (totalSize <= maxOutput) {
        stdout += chunk;
      } else {
        truncated = true;
        break;
      }
    }

    // Read stderr
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      totalSize += chunk.length;
      if (totalSize <= maxOutput) {
        stderr += chunk;
      } else {
        truncated = true;
        break;
      }
    }

    // Combine output (stderr first if there's an error)
    const output = exitCode !== 0 && stderr ? `${stderr}${stdout}` : `${stdout}${stderr}`;

    return {
      command,
      output: output.trim(),
      exitCode: exitCode as number,
      duration: Date.now() - startTime,
      truncated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      command,
      output: `Error: ${message}`,
      exitCode: -1,
      duration: Date.now() - startTime,
      truncated: false,
    };
  }
}

/**
 * Format bash result for WhatsApp message
 */
export function formatBashResult(result: BashResult): string {
  // Blocked command
  if (result.blocked) {
    return `🚫 ${result.blockReason}\n\n${BLOCKED_MESSAGE}`;
  }

  const statusEmoji = result.exitCode === 0 ? '✅' : '❌';
  const durationStr = result.duration >= 1000
    ? `${(result.duration / 1000).toFixed(1)}s`
    : `${result.duration}ms`;

  // Truncate output for WhatsApp if needed
  let output = result.output;
  let displayTruncated = result.truncated;
  const extraLines = output.split('\n').length - (DEFAULTS.BASH_TRUNCATE_AT / 50); // rough estimate

  if (output.length > DEFAULTS.BASH_TRUNCATE_AT) {
    output = output.slice(0, DEFAULTS.BASH_TRUNCATE_AT);
    displayTruncated = true;
  }

  const truncateNote = displayTruncated
    ? `\n... [+${Math.max(1, Math.floor(extraLines))} linhas]`
    : '';

  const exitInfo = result.exitCode !== 0 ? ` | exit ${result.exitCode}` : '';

  return `${statusEmoji} $ ${result.command}
─────────────
${output}${truncateNote}
─────────────
⏱ ${durationStr}${exitInfo}`;
}

/**
 * Get the full output for file attachment
 */
export function getFullOutputFilename(command: string): string {
  // Sanitize command for filename
  const sanitized = command
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  return `${sanitized}-output.txt`;
}
