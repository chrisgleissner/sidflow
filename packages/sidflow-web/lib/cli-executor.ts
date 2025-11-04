/**
 * CLI executor utility for invoking command-line tools via Bun.spawn
 */

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

  try {
    const proc = Bun.spawn([command, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        proc.kill();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    const execPromise = (async () => {
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      return {
        success: exitCode === 0,
        stdout,
        stderr,
        exitCode,
      };
    })();

    return await Promise.race([execPromise, timeoutPromise]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      stdout: '',
      stderr: `Failed to execute command: ${errorMessage}`,
      exitCode: -1,
    };
  }
}
