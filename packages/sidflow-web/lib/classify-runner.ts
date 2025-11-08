import { spawn, type ChildProcess } from 'node:child_process';
import type { CliResult } from '@/lib/cli-executor';

interface RunOptions {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

type RunReason = 'completed' | 'failed' | 'paused' | 'timeout';

interface RunResult {
  result: CliResult;
  reason: RunReason;
}

interface RunnerState {
  child: ChildProcess | null;
  intent: 'none' | 'pause';
}

const runnerState: RunnerState = {
  child: null,
  intent: 'none',
};

export function getClassificationRunnerPid(): number | null {
  return runnerState.child?.pid ?? null;
}

export function requestClassificationPause(): boolean {
  if (!runnerState.child?.pid) {
    return false;
  }
  runnerState.intent = 'pause';
  try {
    process.kill(runnerState.child.pid, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
  }
  return true;
}

export async function runClassificationProcess(options: RunOptions): Promise<RunResult> {
  if (runnerState.child) {
    throw new Error('Classification process is already running');
  }

  const timeout = options.timeout ?? 0; // 0 = no timeout
  const args = options.args ?? [];

  return await new Promise<RunResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (reason: RunReason, exitCode: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      runnerState.child = null;
      runnerState.intent = 'none';

      const result: CliResult = {
        success: exitCode === 0,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderr: Buffer.concat(stderrChunks).toString(),
        exitCode: exitCode ?? -1,
      };
      resolve({ result, reason });
    };

    const child = spawn(options.command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    runnerState.child = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(Buffer.from(chunk));
      options.onStdout?.(chunk.toString());
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(Buffer.from(chunk));
      options.onStderr?.(chunk.toString());
    });

    child.once('error', (error) => {
      stderrChunks.push(Buffer.from(String(error)));
      finish('failed', -1);
    });

    child.once('close', (code) => {
      if (runnerState.intent === 'pause') {
        finish('paused', code ?? -1);
      } else if (timer === null && timeout > 0) {
        // Timed out earlier
        finish('timeout', code ?? -1);
      } else if (code === 0) {
        finish('completed', code ?? 0);
      } else {
        finish('failed', code ?? -1);
      }
    });

    if (timeout > 0) {
      timer = setTimeout(() => {
        timer = null;
        if (runnerState.child) {
          try {
            process.kill(runnerState.child.pid!, 'SIGTERM');
          } catch {
            // ignore
          }
        }
        finish('timeout', -1);
      }, timeout);
    }
  });
}
