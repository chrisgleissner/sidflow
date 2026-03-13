import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const serverEnvModule = await import('@/lib/server-env');
const { resetServerEnvCacheForTests, resetSidflowConfigCache } = serverEnvModule;

const classifyRoute = await import('@/app/api/classify/route');
const classifyProgressRoute = await import('@/app/api/classify/progress/route');

function buildPostRequest(payload: unknown): NextRequest {
  return new NextRequest('http://localhost/api/classify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

describe('/api/classify durable async job routing', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;
  let originalSidflowConfig: string | undefined;
  let originalPrefsPath: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-classify-job-route-'));
    await mkdir(path.join(tempRoot, 'data', 'jobs'), { recursive: true });
    await mkdir(path.join(tempRoot, 'hvsc', 'C64Music'), { recursive: true });
    await mkdir(path.join(tempRoot, 'wav-cache'), { recursive: true });
    await mkdir(path.join(tempRoot, 'tags'), { recursive: true });

    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    originalSidflowConfig = process.env.SIDFLOW_CONFIG;
    originalPrefsPath = process.env.SIDFLOW_PREFS_PATH;

    process.env.SIDFLOW_ROOT = tempRoot;
    process.env.SIDFLOW_CONFIG = path.join(tempRoot, '.sidflow.json');
    process.env.SIDFLOW_PREFS_PATH = path.join(tempRoot, '.prefs.json');

    await writeFile(
      process.env.SIDFLOW_CONFIG,
      JSON.stringify(
        {
          sidPath: './hvsc',
          audioCachePath: './wav-cache',
          tagsPath: './tags',
          threads: 2,
          classificationDepth: 1,
          render: {
            preferredEngines: ['wasm'],
            defaultFormats: ['wav'],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await writeFile(process.env.SIDFLOW_PREFS_PATH, JSON.stringify({ defaultFormats: ['wav'] }, null, 2), 'utf8');

    resetServerEnvCacheForTests();
    resetSidflowConfigCache();
  });

  afterEach(async () => {
    if (originalSidflowRoot === undefined) {
      delete process.env.SIDFLOW_ROOT;
    } else {
      process.env.SIDFLOW_ROOT = originalSidflowRoot;
    }
    if (originalSidflowConfig === undefined) {
      delete process.env.SIDFLOW_CONFIG;
    } else {
      process.env.SIDFLOW_CONFIG = originalSidflowConfig;
    }
    if (originalPrefsPath === undefined) {
      delete process.env.SIDFLOW_PREFS_PATH;
    } else {
      process.env.SIDFLOW_PREFS_PATH = originalPrefsPath;
    }

    resetServerEnvCacheForTests();
    resetSidflowConfigCache();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test('queues async classify requests as durable jobs', async () => {
    const response = await classifyRoute.POST(buildPostRequest({ async: true }));
    expect(response.status).toBe(202);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.jobId).toMatch(/^classify-/);
    expect(body.data.progress.isActive).toBe(true);

    const progressResponse = await classifyProgressRoute.GET();
    const progressBody = await progressResponse.json();
    expect(progressBody.success).toBe(true);
    expect(progressBody.data.isActive).toBe(true);
  });
});