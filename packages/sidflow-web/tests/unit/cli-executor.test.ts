/**
 * Unit tests for CLI executor
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect } from 'bun:test';
import { executeCli } from '../../lib/cli-executor';

describe('executeCli', () => {
  test('executes successful command and captures stdout', async () => {
    const result = await executeCli('echo', ['hello world']);
    
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.stderr).toBe('');
  });

  test('captures stderr from command', async () => {
    // Write to stderr using sh
    const result = await executeCli('sh', ['-c', 'echo error message >&2']);
    
    expect(result.success).toBe(true); // sh exits 0
    expect(result.stderr.trim()).toBe('error message');
  });

  test('handles command failure with non-zero exit code', async () => {
    const result = await executeCli('sh', ['-c', 'exit 1']);
    
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test('handles timeout for long-running command', async () => {
    const result = await executeCli('sleep', ['10'], { timeout: 100 });
    
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('timed out');
  });

  test('handles non-existent command', async () => {
    const result = await executeCli('nonexistent-command-xyz', []);
    
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('Failed to execute command');
  });

  test('passes arguments correctly', async () => {
    const result = await executeCli('echo', ['arg1', 'arg2', 'arg3']);
    
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe('arg1 arg2 arg3');
  });

  test('respects custom timeout', async () => {
    const startTime = Date.now();
    const result = await executeCli('sleep', ['2'], { timeout: 500 });
    const duration = Date.now() - startTime;
    
    expect(result.success).toBe(false);
    expect(duration).toBeLessThan(1000); // Should timeout before sleep completes
  });

  test('captures multiline output', async () => {
    const result = await executeCli('sh', ['-c', 'echo line1; echo line2; echo line3']);
    
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('line1');
    expect(result.stdout).toContain('line2');
    expect(result.stdout).toContain('line3');
  });

  test('falls back to SIDFLOW_CLI_DIR when command is not in PATH', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidflow-cli-'));
    const scriptPath = path.join(tempDir, 'sidflow-test');
    await fs.writeFile(scriptPath, '#!/usr/bin/env bash\necho cli-works\n', { mode: 0o755 });
    await fs.chmod(scriptPath, 0o755);

    const originalCliDir = process.env.SIDFLOW_CLI_DIR;
    process.env.SIDFLOW_CLI_DIR = tempDir;

    try {
      const result = await executeCli('sidflow-test', []);
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('cli-works');
    } finally {
      process.env.SIDFLOW_CLI_DIR = originalCliDir;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
