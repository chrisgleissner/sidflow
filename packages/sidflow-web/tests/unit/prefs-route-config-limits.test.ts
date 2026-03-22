import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/prefs/route';

const serverEnvModule = await import('@/lib/server-env');
const { resetServerEnvCacheForTests, resetSidflowConfigCache } = serverEnvModule;

function buildPostRequest(payload: unknown): NextRequest {
  const url = new URL('http://localhost/api/prefs');
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return new NextRequest(request);
}

describe('/api/prefs config limits', () => {
  let tempRoot: string;
  let configPath: string;
  let originalSidflowRoot: string | undefined;
  let originalSidflowConfig: string | undefined;
  let originalSidplayfpConfigPath: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sidflow-prefs-route-'));
    await mkdir(path.join(tempRoot, 'data'), { recursive: true });

    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    originalSidflowConfig = process.env.SIDFLOW_CONFIG;
    originalSidplayfpConfigPath = process.env.SIDPLAYFP_CONFIG_PATH;

    process.env.SIDFLOW_ROOT = tempRoot;
    configPath = path.join(tempRoot, '.sidflow.json');
    process.env.SIDFLOW_CONFIG = configPath;

    process.env.SIDPLAYFP_CONFIG_PATH = path.join(tempRoot, 'sidplayfp.ini');

    const payload = {
      sidPath: './hvsc',
      audioCachePath: './wav-cache',
      tagsPath: './tags',
      threads: 1,
      classificationDepth: 1,
      maxRenderSec: 20,
      maxClassifySec: 7,
      introSkipSec: 10,
    };
    await writeFile(configPath, JSON.stringify(payload, null, 2), 'utf8');

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
    if (originalSidplayfpConfigPath === undefined) {
      delete process.env.SIDPLAYFP_CONFIG_PATH;
    } else {
      process.env.SIDPLAYFP_CONFIG_PATH = originalSidplayfpConfigPath;
    }

    resetServerEnvCacheForTests();
    resetSidflowConfigCache();

    await rm(tempRoot, { recursive: true, force: true });
  });

  test('GET includes config maxRenderSec/maxClassifySec snapshot', async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.config.maxRenderSec).toBe(20);
    expect(json.data.config.maxClassifySec).toBe(7);
    expect(json.data.config.introSkipSec).toBe(10);
  });

  test('POST updates config limits and persists to .sidflow.json', async () => {
    const response = await POST(buildPostRequest({ maxRenderSec: 25, maxClassifySec: 9, introSkipSec: 15 }));
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.config.maxRenderSec).toBe(25);
    expect(json.data.config.maxClassifySec).toBe(9);
    expect(json.data.config.introSkipSec).toBe(15);

    const contents = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(contents) as any;
    expect(parsed.maxRenderSec).toBe(25);
    expect(parsed.maxClassifySec).toBe(9);
    expect(parsed.introSkipSec).toBe(15);

    const roundTrip = await GET();
    const roundTripJson = await roundTrip.json();
    expect(roundTripJson.data.config.maxRenderSec).toBe(25);
    expect(roundTripJson.data.config.maxClassifySec).toBe(9);
    expect(roundTripJson.data.config.introSkipSec).toBe(15);
  });

  test('POST rejects maxRenderSec that is too small for representative-window intro skipping', async () => {
    // For maxClassifySec=9 and introSkipSec=10, minimum render is max(20, 10 + 9) = 20.
    const response = await POST(buildPostRequest({ maxRenderSec: 19, maxClassifySec: 9, introSkipSec: 10 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('maxRenderSec');
    expect(String(json.details)).toContain('>=');
  });

  test('POST accepts null to reset (removes keys)', async () => {
    const response = await POST(buildPostRequest({ maxRenderSec: null, maxClassifySec: null, introSkipSec: null }));
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.config.maxRenderSec).toBeUndefined();
    expect(json.data.config.maxClassifySec).toBeUndefined();
    expect(json.data.config.introSkipSec).toBeUndefined();

    const contents = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(contents) as any;
    expect(parsed.maxRenderSec).toBeUndefined();
    expect(parsed.maxClassifySec).toBeUndefined();
    expect(parsed.introSkipSec).toBeUndefined();
  });

  test('POST rejects non-positive values', async () => {
    const response = await POST(buildPostRequest({ maxRenderSec: 0 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('maxRenderSec');

    const response2 = await POST(buildPostRequest({ maxClassifySec: -1 }));
    expect(response2.status).toBe(400);
    const json2 = await response2.json();
    expect(json2.success).toBe(false);
    expect(String(json2.details)).toContain('maxClassifySec');
  });

  test('POST rejects wrong types', async () => {
    const response = await POST(buildPostRequest({ maxRenderSec: '10' }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('maxRenderSec');
  });

  test('POST rejects empty body (no fields provided)', async () => {
    const response = await POST(buildPostRequest({}));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.details).toBeTruthy();
  });

  test('POST rejects invalid renderEngine', async () => {
    const response = await POST(buildPostRequest({ renderEngine: 'turbo-sid' }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('renderEngine');
  });

  test('POST rejects renderEngine non-string', async () => {
    const response = await POST(buildPostRequest({ renderEngine: 42 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('renderEngine');
  });

  test('POST rejects preferredEngines non-array', async () => {
    const response = await POST(buildPostRequest({ preferredEngines: 'wasm' }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('preferredEngines');
  });

  test('POST rejects preferredEngines with non-string element', async () => {
    const response = await POST(buildPostRequest({ preferredEngines: [42] }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('preferredEngines');
  });

  test('POST rejects preferredEngines with invalid engine', async () => {
    const response = await POST(buildPostRequest({ preferredEngines: ['mega-sid'] }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('preferredEngines');
  });

  test('POST rejects empty preferredEngines array', async () => {
    const response = await POST(buildPostRequest({ preferredEngines: [] }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('preferredEngines');
  });

  test('POST accepts null renderEngine (reset to default)', async () => {
    const response = await POST(buildPostRequest({ renderEngine: null }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts null preferredEngines (reset to default)', async () => {
    const response = await POST(buildPostRequest({ preferredEngines: null }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST rejects defaultFormats non-array', async () => {
    const response = await POST(buildPostRequest({ defaultFormats: 'wav' }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('defaultFormats');
  });

  test('POST rejects defaultFormats with non-string element', async () => {
    const response = await POST(buildPostRequest({ defaultFormats: [42] }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('defaultFormats');
  });

  test('POST rejects defaultFormats with unsupported format', async () => {
    const response = await POST(buildPostRequest({ defaultFormats: ['mp3'] }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('defaultFormats');
  });

  test('POST rejects empty defaultFormats array', async () => {
    const response = await POST(buildPostRequest({ defaultFormats: [] }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('defaultFormats');
  });

  test('POST accepts null defaultFormats (reset to default)', async () => {
    const response = await POST(buildPostRequest({ defaultFormats: null }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts valid defaultFormats', async () => {
    const response = await POST(buildPostRequest({ defaultFormats: ['wav', 'flac'] }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST rejects sidplayfpCliFlags non-string', async () => {
    const response = await POST(buildPostRequest({ sidplayfpCliFlags: 42 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('sidplayfpCliFlags');
  });

  test('POST accepts sidplayfpCliFlags string', async () => {
    const response = await POST(buildPostRequest({ sidplayfpCliFlags: '--gain 90' }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts null sidplayfpCliFlags (reset)', async () => {
    const response = await POST(buildPostRequest({ sidplayfpCliFlags: null }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts whitespace sidplayfpCliFlags (treated as null)', async () => {
    const response = await POST(buildPostRequest({ sidplayfpCliFlags: '   ' }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts valid renderEngine', async () => {
    const response = await POST(buildPostRequest({ renderEngine: 'wasm' }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts valid preferredEngines combination', async () => {
    const response = await POST(buildPostRequest({ preferredEngines: ['sidplayfp-cli', 'wasm'] }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST deduplicates preferredEngines', async () => {
    const response = await POST(buildPostRequest({ preferredEngines: ['wasm', 'wasm', 'sidplayfp-cli'] }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST rejects maxRenderSec smaller than intro-skip minimum (>= 20 but below window minimum)', async () => {
    // maxClassifySec=30, introSkipSec=20 → minRender = max(20, 20+30) = 50; send maxRenderSec=35
    const response = await POST(buildPostRequest({ maxRenderSec: 35, maxClassifySec: 30, introSkipSec: 20 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(String(json.details)).toContain('maxRenderSec must be >=');
    expect(String(json.details)).toContain('introSkipSec');
  });

  test('POST accepts sidBasePath as a valid directory path', async () => {
    // Create a subdirectory to use as sidBasePath
    const sidDir = path.join(tempRoot, 'hvsc');
    await mkdir(sidDir, { recursive: true });
    const response = await POST(buildPostRequest({ sidBasePath: sidDir }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts sidBasePath as null to clear it', async () => {
    const response = await POST(buildPostRequest({ sidBasePath: null }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts sidBasePath as empty string (treated as null)', async () => {
    const response = await POST(buildPostRequest({ sidBasePath: '   ' }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST rejects sidBasePath that is not a directory', async () => {
    // Create a file (not a dir) to use as sidBasePath
    const filePath = path.join(tempRoot, 'notadir.txt');
    await writeFile(filePath, 'hello', 'utf8');
    const response = await POST(buildPostRequest({ sidBasePath: filePath }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
  });

  test('POST rejects sidBasePath that is a non-string non-null', async () => {
    const response = await POST(buildPostRequest({ sidBasePath: 42 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
  });

  test('POST accepts kernalRomPath as a valid file path', async () => {
    // Create a temp file to use as a ROM
    const romFile = path.join(tempRoot, 'kernal.rom');
    await writeFile(romFile, 'fake rom data', 'utf8');
    const response = await POST(buildPostRequest({ kernalRomPath: romFile }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST accepts kernalRomPath as null to clear it', async () => {
    const response = await POST(buildPostRequest({ kernalRomPath: null }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
  });

  test('POST rejects kernalRomPath that is not a file', async () => {
    const dirPath = path.join(tempRoot, 'notafile');
    await mkdir(dirPath, { recursive: true });
    const response = await POST(buildPostRequest({ kernalRomPath: dirPath }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
  });
});
