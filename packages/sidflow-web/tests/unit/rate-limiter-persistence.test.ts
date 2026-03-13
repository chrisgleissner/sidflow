import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RateLimiter } from '@/lib/server/rate-limiter';

describe('RateLimiter persistence', () => {
  let tempRoot: string;
  let persistPath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-rate-limiter-'));
    persistPath = path.join(tempRoot, 'rate-limit.json');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('persists request logs across instances', async () => {
    const first = new RateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      persistPath,
    });

    expect((await first.checkAsync('203.0.113.10')).allowed).toBe(true);
    expect((await first.checkAsync('203.0.113.10')).allowed).toBe(true);

    const second = new RateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      persistPath,
    });

    const result = await second.checkAsync('203.0.113.10');
    expect(result.allowed).toBe(false);
  });

  test('resetAsync persists cleared state', async () => {
    const first = new RateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      persistPath,
    });

    expect((await first.checkAsync('203.0.113.11')).allowed).toBe(true);
    await first.resetAsync('203.0.113.11');

    const second = new RateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      persistPath,
    });

    const result = await second.checkAsync('203.0.113.11');
    expect(result.allowed).toBe(true);
  });
});