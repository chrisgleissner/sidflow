import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as postTrain } from '@/app/api/train/route';
import { resetServerEnvCacheForTests } from '@/lib/server-env';

function buildPostRequest(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/train', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('/api/train durable job routing', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-train-route-'));
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

  test('queues a training job', async () => {
    const response = await postTrain(buildPostRequest({ epochs: 3 }));
    expect(response.status).toBe(202);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.jobId).toMatch(/^train-/);
  });

  test('rejects a second training job while one is pending', async () => {
    const first = await postTrain(buildPostRequest({}));
    expect(first.status).toBe(202);

    const second = await postTrain(buildPostRequest({}));
    expect(second.status).toBe(409);

    const body = await second.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Training already running');
  });
});