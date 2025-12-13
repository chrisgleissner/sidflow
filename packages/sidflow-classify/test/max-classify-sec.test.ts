import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  __setClassifyTestOverrides,
  buildAudioCache,
  planClassification,
} from '@sidflow/classify';
import { clearSonglengthCaches } from '@sidflow/common';

const TEMP_PREFIX = path.join(os.tmpdir(), 'sidflow-max-classify-sec-');

const STUB_METADATA = {
  type: 'PSID',
  version: 2,
  title: 'Test',
  author: 'Test',
  released: '2025',
  songs: 1,
  startSong: 1,
  clock: 'PAL',
  sidModel1: 'MOS6581',
  loadAddress: 0x1000,
  initAddress: 0x1000,
  playAddress: 0x1003,
} as const;

describe('maxRenderSec duration capping (render)', () => {
  let root: string;
  let hvscRoot: string;
  let configPath: string;
  let sidFile: string;

  beforeEach(async () => {
    root = await mkdtemp(TEMP_PREFIX);
    hvscRoot = path.join(root, 'hvsc');

    await mkdir(path.join(hvscRoot, 'C64Music', 'Authors'), { recursive: true });
    await mkdir(path.join(hvscRoot, 'C64Music', 'DOCUMENTS'), { recursive: true });

    sidFile = path.join(hvscRoot, 'C64Music', 'Authors', 'Track.sid');
    await writeFile(sidFile, Buffer.from('PSID')); // content doesn't matter; parser is overridden

    const songlengths = [
      '; C64Music/Authors/Track.sid',
      '0123456789abcdef0123456789abcdef=0:30',
      '',
    ].join('\n');
    await writeFile(path.join(hvscRoot, 'C64Music', 'DOCUMENTS', 'Songlengths.md5'), songlengths, 'utf8');

    configPath = path.join(root, '.sidflow.json');

    __setClassifyTestOverrides({
      parseSidFile: async () => ({ ...STUB_METADATA }),
    });

    clearSonglengthCaches();

    process.env.SIDFLOW_CONFIG = configPath;
  });

  afterEach(async () => {
    __setClassifyTestOverrides();
    clearSonglengthCaches();
    delete process.env.SIDFLOW_CONFIG;
    await rm(root, { recursive: true, force: true });
  });

  async function runWithMaxRenderSec(maxRenderSec: number | undefined): Promise<number> {
    const payload: any = {
      sidPath: hvscRoot,
      audioCachePath: path.join(root, 'wav-cache'),
      tagsPath: path.join(root, 'tags'),
      threads: 1,
      classificationDepth: 1,
    };
    if (maxRenderSec !== undefined) {
      payload.maxRenderSec = maxRenderSec;
    }

    await writeFile(configPath, JSON.stringify(payload, null, 2), 'utf8');

    const plan = await planClassification({ configPath });

    let captured: number | undefined;
    await buildAudioCache(plan, {
      render: async (options) => {
        captured = options.targetDurationMs;
        await mkdir(path.dirname(options.wavFile), { recursive: true });
        await writeFile(options.wavFile, Buffer.from('RIFF')); // dummy wav
      },
      threads: 1,
    });

    expect(captured).toBeDefined();
    return captured as number;
  }

  it('defaults to 10s when maxRenderSec is absent', async () => {
    const ms = await runWithMaxRenderSec(undefined);
    expect(ms).toBe(10_000);
  });

  it('caps HVSC duration to maxRenderSec when shorter', async () => {
    const ms = await runWithMaxRenderSec(5);
    // Enforce a sensible minimum render duration so intro skipping + analysis stays viable.
    expect(ms).toBe(20_000);
  });

  it('uses HVSC duration when it is below maxRenderSec', async () => {
    const ms = await runWithMaxRenderSec(60);
    expect(ms).toBe(30_000);
  });

  it('supports fractional seconds for fast edge cases', async () => {
    const ms = await runWithMaxRenderSec(20.5);
    expect(ms).toBeCloseTo(20_500, 5);
  });
});
