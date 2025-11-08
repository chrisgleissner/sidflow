import type { CliResult } from '@/lib/cli-executor';

export function formatCliLogs(command: string, stdout?: string, stderr?: string): string {
  const sanitizedStdout = stdout?.trim() ? stdout.trim() : '(no stdout output)';
  const sanitizedStderr = stderr?.trim() ? stderr.trim() : '(no stderr output)';
  return [
    `${command} logs`,
    '--- stdout ---',
    sanitizedStdout,
    '--- stderr ---',
    sanitizedStderr,
  ].join('\n');
}

export function describeCliFailure(command: string, result: CliResult): { details: string; logs: string } {
  const logs = formatCliLogs(command, result.stdout, result.stderr);
  const stderrText = result.stderr?.trim();
  const stdoutText = result.stdout?.trim();
  const surfaceDetail = stderrText || stdoutText || 'No output captured from CLI';
  const details = `Command "${command}" failed with exit code ${result.exitCode}: ${surfaceDetail}`;
  return { details, logs };
}

export function describeCliSuccess(command: string, result: CliResult): { logs: string } {
  return {
    logs: formatCliLogs(command, result.stdout, result.stderr),
  };
}
