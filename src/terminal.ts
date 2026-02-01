import { spawn, type Subprocess } from 'bun';

export class ClaudeTerminal {
  private process: Subprocess<'pipe', 'pipe', 'pipe'> | null = null;
  private buffer = '';
  private resolveOutput: ((output: string) => void) | null = null;
  private outputTimeout: Timer | null = null;

  async start(): Promise<void> {
    if (this.process) return;

    console.log('Starting Claude Code...');

    this.process = spawn(['claude', '--chat'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Read stdout
    this.readStream(this.process.stdout);
    this.readStream(this.process.stderr);

    // Wait for initial prompt
    await this.waitForOutput(5000);
    console.log('Claude Code ready');
  }

  private async readStream(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      this.buffer += text;

      // Reset timeout on new output
      if (this.outputTimeout) {
        clearTimeout(this.outputTimeout);
      }

      // Resolve after 2s of no new output (Claude finished responding)
      this.outputTimeout = setTimeout(() => {
        if (this.resolveOutput && this.buffer) {
          this.resolveOutput(this.cleanOutput(this.buffer));
          this.buffer = '';
          this.resolveOutput = null;
        }
      }, 2000);
    }
  }

  private cleanOutput(text: string): string {
    // Remove ANSI escape codes
    return text
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][^\x07]*\x07/g, '')
      .trim();
  }

  private waitForOutput(timeout: number): Promise<string> {
    return new Promise((resolve) => {
      this.resolveOutput = resolve;
      setTimeout(() => {
        if (this.resolveOutput) {
          this.resolveOutput(this.cleanOutput(this.buffer));
          this.buffer = '';
          this.resolveOutput = null;
        }
      }, timeout);
    });
  }

  async send(input: string): Promise<string> {
    if (!this.process) {
      await this.start();
    }

    // Clear buffer
    this.buffer = '';

    // Send input
    const writer = this.process!.stdin.getWriter();
    await writer.write(new TextEncoder().encode(input + '\n'));
    writer.releaseLock();

    // Wait for response (max 60s)
    return this.waitForOutput(60000);
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
