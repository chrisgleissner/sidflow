import { describe, expect, it } from 'bun:test';
import { executeCli } from '@/lib/cli-executor';

describe('executeCli', () => {
  it('captures stdout/stderr for successful commands', async () => {
    const seenStdout: string[] = [];
    const seenStderr: string[] = [];

    const result = await executeCli('node', ['-e', 'console.log("ok"); console.error("warn");'], {
      onStdout: (chunk) => seenStdout.push(chunk.trim()),
      onStderr: (chunk) => seenStderr.push(chunk.trim()),
      timeout: 2000,
      env: {
        SIDFLOW_TEST_CLI: 'true',
      },
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('ok');
    expect(result.stderr).toContain('warn');
    expect(seenStdout.some((line) => line.includes('ok'))).toBe(true);
    expect(seenStderr.some((line) => line.includes('warn'))).toBe(true);
  });

  it('returns timeout result when command exceeds limit', async () => {
    const result = await executeCli('node', ['-e', 'setTimeout(() => {}, 2000);'], {
      timeout: 50,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('Command timed out');
  });
});
