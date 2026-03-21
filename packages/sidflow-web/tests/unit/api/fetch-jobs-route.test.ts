import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as postFetch } from '@/app/api/fetch/route';
import { GET as getFetchProgress } from '@/app/api/fetch/progress/route';
import { resetServerEnvCacheForTests } from '@/lib/server-env';
import { findLatestJobByType, buildFetchProgressSnapshot, buildClassifyProgressSnapshot } from '@/lib/server/jobs';
import type { JobDescriptor } from '@sidflow/common';

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

describe('jobs utility functions coverage', () => {
  function makeJob(id: string, type: 'fetch' | 'classify', status: 'pending' | 'running' | 'completed' | 'failed' | 'paused', extra: Record<string, unknown> = {}): JobDescriptor {
    const now = new Date().toISOString();
    return {
      id,
      type,
      status,
      params: {},
      metadata: { id, type, status, createdAt: now, ...extra },
    } as JobDescriptor;
  }

  test('findLatestJobByType returns null when no matching type', () => {
    const jobs = [makeJob('j1', 'classify', 'pending'), makeJob('j2', 'classify', 'running')];
    const result = findLatestJobByType(jobs, 'fetch');
    expect(result).toBeNull();
  });

  test('findLatestJobByType returns null when no matching status filter', () => {
    const jobs = [makeJob('j1', 'fetch', 'pending'), makeJob('j2', 'fetch', 'running')];
    const result = findLatestJobByType(jobs, 'fetch', ['completed']);
    expect(result).toBeNull();
  });

  test('findLatestJobByType returns latest job when multiple match sorted by createdAt', () => {
    const earlier = new Date(Date.now() - 10000).toISOString();
    const j1 = makeJob('j1', 'fetch', 'completed', { createdAt: earlier });
    const j2 = makeJob('j2', 'fetch', 'completed');
    const result = findLatestJobByType([j1, j2], 'fetch', ['completed']);
    expect(result?.id).toBe('j2');
  });

  test('buildFetchProgressSnapshot returns idle snapshot for null job', () => {
    const snap = buildFetchProgressSnapshot(null);
    expect(snap.phase).toBe('idle');
    expect(snap.isActive).toBe(false);
    expect(snap.percent).toBe(0);
  });

  test('buildFetchProgressSnapshot returns error snapshot for failed job', () => {
    const job = makeJob('j-fail', 'fetch', 'failed', { error: 'network error' });
    const snap = buildFetchProgressSnapshot(job);
    expect(snap.phase).toBe('error');
    expect(snap.isActive).toBe(false);
    expect(snap.error).toBe('network error');
  });

  test('buildFetchProgressSnapshot returns completed snapshot for completed job', () => {
    const now = new Date().toISOString();
    const job = makeJob('j-done', 'fetch', 'completed', { completedAt: now });
    const snap = buildFetchProgressSnapshot(job);
    expect(snap.phase).toBe('completed');
    expect(snap.percent).toBe(100);
    expect(snap.isActive).toBe(false);
  });

  test('buildClassifyProgressSnapshot returns null for null job', () => {
    const snap = buildClassifyProgressSnapshot(null);
    expect(snap).toBeNull();
  });
});