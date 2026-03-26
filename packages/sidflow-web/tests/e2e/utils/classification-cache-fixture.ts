import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_RENDER_SEC = 30;
const DEFAULT_INTRO_SKIP_SEC = 15;
const DEFAULT_MAX_CLASSIFY_SEC = 15;

interface SeedClassificationCacheEntryOptions {
  sidBuffer: Buffer;
  wavFile: string;
  wavBuffer: Buffer;
}

export async function seedClassificationCacheEntry({
  sidBuffer,
  wavFile,
  wavBuffer,
}: SeedClassificationCacheEntryOptions): Promise<void> {
  await fs.mkdir(path.dirname(wavFile), { recursive: true });
  await fs.writeFile(wavFile, wavBuffer);

  const sidHash = crypto.createHash('sha256').update(sidBuffer).digest('hex');
  await fs.writeFile(`${wavFile}.sha256`, sidHash, 'utf8');

  await fs.writeFile(
    `${wavFile}.render.json`,
    `${JSON.stringify({
      v: 3,
      maxRenderSec: DEFAULT_MAX_RENDER_SEC,
      introSkipSec: DEFAULT_INTRO_SKIP_SEC,
      maxClassifySec: DEFAULT_MAX_CLASSIFY_SEC,
      sourceOffsetSec: 0,
      renderEngine: 'wasm',
      traceCaptureEnabled: true,
      traceSidecarVersion: 1,
    })}\n`,
    'utf8',
  );

  await fs.writeFile(
    `${wavFile}.trace.jsonl`,
    `${JSON.stringify({
      v: 1,
      clock: 'PAL',
      skipSeconds: DEFAULT_INTRO_SKIP_SEC,
      analysisSeconds: DEFAULT_MAX_CLASSIFY_SEC,
      traces: [],
    })}\n`,
    'utf8',
  );
}