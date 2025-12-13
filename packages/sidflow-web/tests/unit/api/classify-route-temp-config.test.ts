import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

mock.module('@/lib/classify-runner', () => ({
  runClassificationProcess: async () => ({
    result: { success: true, stdout: 'ok', stderr: '', exitCode: 0 },
    reason: 'completed',
  }),
}));

const serverEnvModule = await import('@/lib/server-env');
const { resetServerEnvCacheForTests, resetSidflowConfigCache } = serverEnvModule;

const classifyRoute = await import('@/app/api/classify/route');
const { POST } = classifyRoute;

function buildPostRequest(payload: unknown): NextRequest {
  const url = new URL('http://localhost/api/classify');
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return new NextRequest(request);
}

describe('/api/classify temp config', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;
  let originalSidflowConfig: string | undefined;
  let originalPrefsPath: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-classify-route-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });

    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    originalSidflowConfig = process.env.SIDFLOW_CONFIG;
    originalPrefsPath = process.env.SIDFLOW_PREFS_PATH;

    process.env.SIDFLOW_ROOT = tempRoot;
    process.env.SIDFLOW_CONFIG = path.join(tempRoot, '.sidflow.json');
    process.env.SIDFLOW_PREFS_PATH = path.join(tempRoot, '.prefs.json');

    await mkdir(path.join(tempRoot, 'hvsc', 'C64Music'), { recursive: true });
    await mkdir(path.join(tempRoot, 'wav-cache'), { recursive: true });
    await mkdir(path.join(tempRoot, 'tags'), { recursive: true });

    await writeFile(
      process.env.SIDFLOW_CONFIG,
      JSON.stringify(
        {
          sidPath: './hvsc',
          audioCachePath: './wav-cache',
          tagsPath: './tags',
          threads: 1,
          classificationDepth: 1,
          render: {
            preferredEngines: ['wasm'],
            defaultFormats: ['wav', 'flac', 'm4a'],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    // Only WAV should be used during classification.
    await writeFile(
      process.env.SIDFLOW_PREFS_PATH,
      JSON.stringify({ defaultFormats: ['wav'] }, null, 2),
      'utf8',
    );

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

  test('writes preferredEngines and defaultFormats into temp config', async () => {
    const response = await POST(buildPostRequest({}));
    expect(response.status).toBe(200);

    const tempConfigPath = path.join(tempRoot, 'data', '.sidflow-classify-temp.json');
    const contents = await readFile(tempConfigPath, 'utf8');
    const parsed = JSON.parse(contents) as any;

    expect(parsed.render.preferredEngines).toBeDefined();
    expect(parsed.render.defaultFormats).toEqual(['wav']);
  });
});
