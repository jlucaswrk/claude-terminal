import { describe, test, expect } from 'bun:test';
import {
  executeCommand,
  isBlockedCommand,
  formatBashResult,
  getFullOutputFilename,
} from './bash-executor';
import type { BashResult } from './types';

describe('isBlockedCommand', () => {
  test('blocks sudo commands', () => {
    expect(isBlockedCommand('sudo apt install vim').blocked).toBe(true);
    expect(isBlockedCommand('sudo rm -rf /').blocked).toBe(true);
    expect(isBlockedCommand('SUDO echo test').blocked).toBe(true);
  });

  test('blocks rm -rf /', () => {
    expect(isBlockedCommand('rm -rf /').blocked).toBe(true);
    expect(isBlockedCommand('rm -rf /*').blocked).toBe(true);
    expect(isBlockedCommand('rm -rf ~').blocked).toBe(true);
    expect(isBlockedCommand('rm -rf ~/').blocked).toBe(true);
  });

  test('blocks dangerous system commands', () => {
    expect(isBlockedCommand('shutdown now').blocked).toBe(true);
    expect(isBlockedCommand('reboot').blocked).toBe(true);
    expect(isBlockedCommand('halt').blocked).toBe(true);
    expect(isBlockedCommand('poweroff').blocked).toBe(true);
  });

  test('blocks disk operations', () => {
    expect(isBlockedCommand('mkfs.ext4 /dev/sda').blocked).toBe(true);
    expect(isBlockedCommand('dd if=/dev/zero of=/dev/sda').blocked).toBe(true);
    expect(isBlockedCommand('echo test > /dev/sda').blocked).toBe(true);
  });

  test('blocks fork bomb', () => {
    expect(isBlockedCommand(':(){ :|:& };:').blocked).toBe(true);
  });

  test('allows safe commands', () => {
    expect(isBlockedCommand('ls -la').blocked).toBe(false);
    expect(isBlockedCommand('echo hello').blocked).toBe(false);
    expect(isBlockedCommand('cat file.txt').blocked).toBe(false);
    expect(isBlockedCommand('git status').blocked).toBe(false);
    expect(isBlockedCommand('npm install').blocked).toBe(false);
    expect(isBlockedCommand('rm myfile.txt').blocked).toBe(false);
    expect(isBlockedCommand('rm -rf ./temp').blocked).toBe(false);
  });
});

describe('executeCommand', () => {
  test('executes simple command', async () => {
    const result = await executeCommand('echo hello');
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('hello');
    expect(result.truncated).toBe(false);
    expect(result.blocked).toBeUndefined();
  });

  test('captures command in result', async () => {
    const result = await executeCommand('echo test');
    expect(result.command).toBe('echo test');
  });

  test('records duration', async () => {
    const result = await executeCommand('echo fast');
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeLessThan(1000);
  });

  test('handles command with non-zero exit code', async () => {
    const result = await executeCommand('exit 1');
    expect(result.exitCode).toBe(1);
  });

  test('captures stderr', async () => {
    const result = await executeCommand('echo error >&2');
    expect(result.output).toContain('error');
  });

  test('returns blocked for dangerous commands', async () => {
    const result = await executeCommand('sudo echo test');
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('bloqueado');
    expect(result.exitCode).toBe(-1);
  });

  test('respects cwd option', async () => {
    const result = await executeCommand('pwd', { cwd: '/tmp' });
    // macOS uses /private/tmp symlink
    expect(result.output).toMatch(/\/?tmp$/);
  });

  test('handles command not found', async () => {
    const result = await executeCommand('nonexistentcommand12345');
    expect(result.exitCode).not.toBe(0);
    expect(result.output.toLowerCase()).toContain('not found');
  });

  test('handles timeout', async () => {
    const result = await executeCommand('sleep 10', { timeout: 100 });
    expect(result.output).toContain('timed out');
    expect(result.exitCode).toBe(-1);
  }, 5000);

  test('combines stdout and stderr', async () => {
    const result = await executeCommand('echo out && echo err >&2');
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });
});

describe('formatBashResult', () => {
  test('formats successful command', () => {
    const result: BashResult = {
      command: 'ls -la',
      output: 'file1.txt\nfile2.txt',
      exitCode: 0,
      duration: 45,
      truncated: false,
    };
    const formatted = formatBashResult(result);
    expect(formatted).toContain('✅');
    expect(formatted).toContain('$ ls -la');
    expect(formatted).toContain('file1.txt');
    expect(formatted).toContain('45ms');
  });

  test('formats failed command', () => {
    const result: BashResult = {
      command: 'cat missing',
      output: 'No such file',
      exitCode: 1,
      duration: 12,
      truncated: false,
    };
    const formatted = formatBashResult(result);
    expect(formatted).toContain('❌');
    expect(formatted).toContain('exit 1');
  });

  test('formats blocked command', () => {
    const result: BashResult = {
      command: 'sudo rm -rf /',
      output: '',
      exitCode: -1,
      duration: 0,
      truncated: false,
      blocked: true,
      blockReason: 'Comando bloqueado: sudo rm -rf /',
    };
    const formatted = formatBashResult(result);
    expect(formatted).toContain('🚫');
    expect(formatted).toContain('bloqueado');
    expect(formatted).toContain('máquina');
  });

  test('formats truncated output', () => {
    const result: BashResult = {
      command: 'cat bigfile',
      output: 'a'.repeat(100),
      exitCode: 0,
      duration: 100,
      truncated: true,
    };
    const formatted = formatBashResult(result);
    expect(formatted).toContain('[+');
    expect(formatted).toContain('linhas]');
  });

  test('formats duration in seconds for long commands', () => {
    const result: BashResult = {
      command: 'npm install',
      output: 'done',
      exitCode: 0,
      duration: 12400,
      truncated: false,
    };
    const formatted = formatBashResult(result);
    expect(formatted).toContain('12.4s');
  });
});

describe('getFullOutputFilename', () => {
  test('generates filename from command', () => {
    const filename = getFullOutputFilename('ls -la');
    expect(filename).toBe('ls_-la-output.txt');
  });

  test('truncates long commands', () => {
    const filename = getFullOutputFilename('cat very_long_filename_that_goes_on_forever.txt');
    expect(filename.length).toBeLessThanOrEqual(45); // 30 + '-output.txt'
  });

  test('sanitizes special characters', () => {
    const filename = getFullOutputFilename('echo "hello world" | grep hello');
    expect(filename).not.toContain('"');
    expect(filename).not.toContain('|');
    expect(filename).not.toContain(' ');
  });
});
