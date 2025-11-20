/**
 * CLI executor utility for invoking command-line tools via Node child_process
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface CliResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecuteOptions {
  timeout?: number; // in milliseconds, default 30000 (30s)
  cwd?: string;
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  bypassQueue?: boolean; // Skip throttling for this execution
}

/**
 * Simple concurrency queue to throttle child process spawns.
 * Prevents resource exhaustion when many CLI commands run simultaneously.
 */
class ConcurrencyQueue {
  private readonly maxConcurrent: number;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running += 1;
        resolve();
      });
    });
  }

  release(): void {
    this.running -= 1;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  getStats(): { running: number; queued: number } {
    return { running: this.running, queued: this.queue.length };
  }
}

const globalQueue = new ConcurrencyQueue(
  process.env.SIDFLOW_CLI_MAX_CONCURRENT
    ? parseInt(process.env.SIDFLOW_CLI_MAX_CONCURRENT, 10)
    : 4
);

/**
 * Get current CLI executor queue statistics
 */
export function getCliExecutorStats(): { running: number; queued: number } {
  return globalQueue.getStats();
}

function resolveWorkingDirectory(explicit?: string): string {
  if (explicit) {
    return explicit;
  }

  if (process.env.SIDFLOW_ROOT) {
    return process.env.SIDFLOW_ROOT;
  }

  let currentDir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(currentDir, '.sidflow.json'))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return process.cwd();
}

function collectSearchRoots(baseDir: string): string[] {
  const roots = new Set<string>();

  if (process.env.SIDFLOW_CLI_DIR) {
    roots.add(process.env.SIDFLOW_CLI_DIR);
  }

  let currentDir = baseDir;
  for (let depth = 0; depth < 5; depth += 1) {
    roots.add(path.join(currentDir, 'scripts'));
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return Array.from(roots);
}

function resolveCommand(command: string, baseDir: string): string {
  if (
    path.isAbsolute(command) ||
    command.startsWith('./') ||
    command.startsWith('../') ||
    command.includes('/') ||
    command.includes('\\')
  ) {
    return command;
  }

  const searchRoots = collectSearchRoots(baseDir);

  for (const root of searchRoots) {
    const candidate = path.join(root, command);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return command;
}

/**
 * Execute a CLI command and capture output
 * @param command Command to execute (e.g., 'sidflow-play')
 * @param args Command arguments
 * @param options Execution options
 * @returns Promise resolving to CliResult
 */
export async function executeCli(
  command: string,
  args: string[],
  options: ExecuteOptions = {}
): Promise<CliResult> {
  const timeout = options.timeout ?? 30000;
  const cwd = resolveWorkingDirectory(options.cwd);
  const resolvedCommand = resolveCommand(command, cwd);
  const env = {
    ...process.env,
    ...options.env,
  };

  // Acquire slot from queue unless bypassed
  if (!options.bypassQueue) {
    await globalQueue.acquire();
  }

  try {
    return await new Promise<CliResult>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const finish = (result: CliResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const proc = spawn(resolvedCommand, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(Buffer.from(chunk));
        if (options.onStdout) {
          options.onStdout(chunk.toString());
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(Buffer.from(chunk));
        if (options.onStderr) {
          options.onStderr(chunk.toString());
        }
      });

      proc.on('error', (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        finish({
          success: false,
          stdout: '',
          stderr: `Failed to execute command: ${errorMessage}`,
          exitCode: -1,
        });
      });

      proc.on('close', (code) => {
        finish({
          success: code === 0,
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: Buffer.concat(stderrChunks).toString(),
          exitCode: code ?? -1,
        });
      });

      const timer = setTimeout(() => {
        proc.kill();
        finish({
          success: false,
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: `Command timed out after ${timeout}ms`,
          exitCode: -1,
        });
      }, timeout);
    });
  } finally {
    // Always release queue slot
    if (!options.bypassQueue) {
      globalQueue.release();
    }
  }
}
