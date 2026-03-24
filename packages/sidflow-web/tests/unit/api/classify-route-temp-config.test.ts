import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

let mockClassifyResult: { success: boolean; stdout: string; stderr: string; exitCode: number } = {
  success: true,
  stdout: 'ok',
  stderr: '',
  exitCode: 0,
};

let mockStdoutChunks: string[] = [];
let mockStderrChunks: string[] = [];

mock.module('@/lib/classify-runner', () => ({
  getClassificationRunnerPid: () => null,
  requestClassificationPause: () => false,
  runClassificationProcess: async (options: { onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void }) => {
    for (const chunk of mockStdoutChunks) {
      options.onStdout?.(chunk);
    }
    for (const chunk of mockStderrChunks) {
      options.onStderr?.(chunk);
    }

    return {
      result: mockClassifyResult,
      reason: mockClassifyResult.success ? 'completed' : 'failed',
    };
  },
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
    mockClassifyResult = { success: true, stdout: 'ok', stderr: '', exitCode: 0 };
    mockStdoutChunks = [];
    mockStderrChunks = [];

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

  test('returns 400 when request body fails Zod validation', async () => {
    const response = await POST(buildPostRequest({ limit: 'not-a-number' }));
    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain('Validation');
  });

  test('returns 500 when classify CLI fails', async () => {
    mockClassifyResult = { success: false, stdout: '', stderr: 'Error!', exitCode: 1 };
    try {
      const response = await POST(buildPostRequest({}));
      expect(response.status).toBe(500);
      const body = await response.json() as any;
      expect(body.success).toBe(false);
    } finally {
      mockClassifyResult = { success: true, stdout: 'ok', stderr: '', exitCode: 0 };
    }
  });

  test('returns 500 when classify output reports failure despite zero exit code', async () => {
    mockStdoutChunks = [
      'Starting classification (threads: 2)\n',
      '[Extracting Features] 80/100 files (80.0%)\n',
    ];
    mockClassifyResult = {
      success: true,
      stdout: 'Starting classification\nClassification failed: Out of memory\n',
      stderr: '',
      exitCode: 0,
    };

    const response = await POST(buildPostRequest({}));
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.success).toBe(false);
    expect(body.details).toContain('Classification failed: Out of memory');
    expect(body.progress.phase).toBe('error');
    expect(body.progress.taggedFiles).toBe(80);
    expect(body.progress.totalFiles).toBe(100);
  });

  test('passes limit, forceRebuild, skipAlreadyClassified, deleteWavAfterClassification flags', async () => {
    const response = await POST(buildPostRequest({
      limit: 5,
      forceRebuild: true,
      skipAlreadyClassified: true,
      deleteWavAfterClassification: true,
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.success).toBe(true);
  });

  test('returns 500 for non-ZodError exceptions', async () => {
    // Pass a path that does not exist → fs.stat throws ENOENT → generic error handler
    const response = await POST(buildPostRequest({ path: 'NonExistent/Dir/Songs' }));
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.success).toBe(false);
  });
});
