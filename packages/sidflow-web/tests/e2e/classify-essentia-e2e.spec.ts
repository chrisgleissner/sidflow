/**
 * E2E Test: Classification API with Essentia.js Feature Extraction
 *
 * This test is self-contained and runs classification on synthetic SID + pre-rendered WAV
 * fixtures under test-workspace/, then verifies that the output contains rich audio features.
 */

import { test, expect } from './test-hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { withClassificationLock } from './utils/classification-lock';

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const TEST_WORKSPACE = path.join(REPO_ROOT, 'test-workspace');
const CLASSIFIED_DIR = path.join(TEST_WORKSPACE, 'classified');
const AUDIO_CACHE_DIR = path.join(TEST_WORKSPACE, 'audio-cache');
const TAGS_DIR = path.join(TEST_WORKSPACE, 'tags');
const SID_BASE_DIR = path.join(TEST_WORKSPACE, 'hvsc');

const TEST_DIR = 'C64Music/MUSICIANS/E/Essentia_E2E';
const TEST_DIR_REL = TEST_DIR.replace(/^C64Music[\\/]/, '');
const TEST_SONG = { name: 'Essentia_Test_01', freq: 440, duration: 1 };

function createSidFile(title: string, author: string): Buffer {
  const headerSize = 124;
  const codeSize = 4;
  const buffer = Buffer.alloc(headerSize + codeSize);

  buffer.write('PSID', 0);
  buffer.writeUInt16BE(0x0002, 4);
  buffer.writeUInt16BE(headerSize, 6);
  buffer.writeUInt16BE(0x1000, 8);
  buffer.writeUInt16BE(0x1000, 10);
  buffer.writeUInt16BE(0x1003, 12);
  buffer.writeUInt16BE(0x0001, 14);
  buffer.writeUInt16BE(0x0001, 16);
  buffer.writeUInt32BE(0x00000001, 18);
  buffer.write(title.slice(0, 31), 22);
  buffer.write(author.slice(0, 31), 54);
  buffer.write('2025 Essentia E2E', 86);
  buffer.writeUInt16BE(0x0000, 118);
  buffer.writeUInt8(0x60, headerSize);
  buffer.writeUInt8(0x4c, headerSize + 1);
  buffer.writeUInt8(0x03, headerSize + 2);
  buffer.writeUInt8(0x10, headerSize + 3);

  return buffer;
}

function createWavFile(durationSec: number, freq: number): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buffer = Buffer.alloc(fileSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * freq * t);
    buffer.writeInt16LE(Math.floor(value * 32767), 44 + i * 2);
  }

  return buffer;
}

async function waitForClassificationIdle(request: any, maxWaitMs = 30_000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const response = await request.get('/api/classify/progress');
    if (response.ok()) {
      const body = await response.json();
      const status = body.data ?? body;
      if (!status.isActive) {
        return;
      }
    } else {
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Timed out waiting for classification to become idle');
}

test.describe('Classification Output with Essentia.js Features', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'API tests only run in chromium');
  test.describe.configure({ mode: 'serial' });
  // Allow extra time for lock acquisition (90s) + classification (30s) + idle wait (30s)
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    const sidDir = path.join(SID_BASE_DIR, TEST_DIR);
    await fs.mkdir(sidDir, { recursive: true });

    const sidPath = path.join(sidDir, `${TEST_SONG.name}.sid`);
    await fs.writeFile(sidPath, createSidFile(TEST_SONG.name, 'Essentia E2E'));

    const wavCachePath = path.join(AUDIO_CACHE_DIR, TEST_DIR_REL, `${TEST_SONG.name}.wav`);
    await fs.mkdir(path.dirname(wavCachePath), { recursive: true });
    await fs.writeFile(wavCachePath, createWavFile(TEST_SONG.duration, TEST_SONG.freq));
  });

  test.afterAll(async () => {
    const sidDir = path.join(SID_BASE_DIR, TEST_DIR);
    const wavDir = path.join(AUDIO_CACHE_DIR, TEST_DIR_REL);
    await fs.rm(sidDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(wavDir, { recursive: true, force: true }).catch(() => {});
  });

  test('runs classification and verifies JSONL contains rich audio features', async ({ request }) => {
    await withClassificationLock(async () => {
      const jsonlBefore = await fs.readdir(CLASSIFIED_DIR).catch(() => []);
      await waitForClassificationIdle(request, 60_000);

      const response = await request.post('/api/classify', {
        data: {
          path: TEST_DIR,
          forceRebuild: false,
          deleteWavAfterClassification: false,
          skipAlreadyClassified: false,
        },
        timeout: 90_000,
      });

      const body = await response.json().catch(() => ({}));
      expect(response.ok(), JSON.stringify(body)).toBe(true);

      const jsonlAfter = await fs.readdir(CLASSIFIED_DIR).catch(() => []);
      const newFiles = jsonlAfter.filter((f) => f.endsWith('.jsonl') && !jsonlBefore.includes(f)).sort();
      expect(newFiles.length).toBeGreaterThan(0);

      const jsonlPath = path.join(CLASSIFIED_DIR, newFiles[newFiles.length - 1]!);
      const content = await fs.readFile(jsonlPath, 'utf8');
      const lines = content.trim().split('\n').filter((l) => l.trim());
      expect(lines.length).toBeGreaterThan(0);

      const match = lines
        .map((line) => {
          try {
            return JSON.parse(line) as any;
          } catch {
            return null;
          }
        })
        .find((entry) => entry && String(entry.sid_path ?? entry.sidPath ?? '').includes(TEST_SONG.name));

      expect(match).toBeTruthy();
      const f = match.features;
      expect(f).toBeTruthy();
      expect(f.energy).toBeGreaterThanOrEqual(0);
      expect(f.rms).toBeGreaterThanOrEqual(0);
      expect(f.spectralCentroid).toBeGreaterThan(0);
      expect(f.bpm).toBeGreaterThan(0);
      expect(f.duration).toBeGreaterThan(0);
      expect(f.sampleRate).toBe(44100);
    });
  });

  test('writes auto-tags.json with ratings for the classified SID', async () => {
    // Depending on the configured sidPathPrefix, keys can be written either:
    // - under tagsPath/<depth-folders>/auto-tags.json, or
    // - directly under tagsPath/auto-tags.json (when the relative SID path has no folders).
    const candidatePaths = [
      path.join(TAGS_DIR, 'MUSICIANS', 'E', 'Essentia_E2E', 'auto-tags.json'),
      path.join(TAGS_DIR, 'auto-tags.json'),
    ];
    const autoTagsPath = candidatePaths.find((p) => existsSync(p));
    expect(autoTagsPath, `Expected auto-tags.json at one of: ${candidatePaths.join(', ')}`).toBeTruthy();

    const content = await fs.readFile(autoTagsPath!, 'utf8');
    const autoTags = JSON.parse(content) as Record<string, any>;
    const entries = Object.entries(autoTags);
    expect(entries.length).toBeGreaterThan(0);

    const matchingEntry = entries.find(([key]) => key.includes(TEST_SONG.name));
    expect(matchingEntry).toBeTruthy();
    const value = matchingEntry![1];

    expect(value.e).toBeGreaterThanOrEqual(1);
    expect(value.e).toBeLessThanOrEqual(5);
    expect(value.m).toBeGreaterThanOrEqual(1);
    expect(value.m).toBeLessThanOrEqual(5);
    expect(value.c).toBeGreaterThanOrEqual(1);
    expect(value.c).toBeLessThanOrEqual(5);
  });
});
