import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as postFetch } from '@/app/api/fetch/route';
import { GET as getFetchProgress } from '@/app/api/fetch/progress/route';
import { resetServerEnvCacheForTests } from '@/lib/server-env';

function buildPostRequest(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/fetch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('/api/fetch durable job routing', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-fetch-route-'));
    await mkdir(path.join(tempRoot, 'data', 'jobs'), { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) {
      delete process.env.SIDFLOW_ROOT;
    } else {
      process.env.SIDFLOW_ROOT = originalSidflowRoot;
    }
    resetServerEnvCacheForTests();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('queues a fetch job and exposes queued progress', async () => {
    const response = await postFetch(buildPostRequest({}));
    expect(response.status).toBe(202);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.jobId).toMatch(/^fetch-/);
    expect(body.data.progress.isActive).toBe(true);
    expect(body.data.progress.phase).toBe('initializing');

    const progressResponse = await getFetchProgress();
    expect(progressResponse.status).toBe(200);

    const progressBody = await progressResponse.json();
    expect(progressBody.success).toBe(true);
    expect(progressBody.data.isActive).toBe(true);
    expect(progressBody.data.phase).toBe('initializing');
  });

  test('rejects a second fetch job while one is pending', async () => {
    const first = await postFetch(buildPostRequest({}));
    expect(first.status).toBe(202);

    const second = await postFetch(buildPostRequest({}));
    expect(second.status).toBe(409);

    const body = await second.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Fetch already running');
  });
});