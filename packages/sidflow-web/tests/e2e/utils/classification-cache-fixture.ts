import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_RENDER_SEC = 30;
const DEFAULT_INTRO_SKIP_SEC = 15;
const DEFAULT_MAX_CLASSIFY_SEC = 15;

/**
 * The render settings sidecar a pre-rendered WAV needs in order to count as a cache hit.
 *
 * Built here rather than by calling `writeWavRenderSettingsSidecar` because these fixtures
 * load under Playwright's Node loader, and `@sidflow/classify` reaches `bun:sqlite`, which
 * that loader cannot resolve. The copy is pinned instead: the Bun unit test
 * `tests/unit/classification-cache-fixture.test.ts` writes a sidecar with the production
 * writer and fails if this object stops matching it.
 *
 * Without that pin, a deliberate cache invalidation — such as the v3 to v4 bump that added
 * `sidEngine` — silently stops these fixtures counting as cache hits. The specs then try to
 * render a synthetic SID for real, every render fails, and the failure names the renderer
 * rather than the fixture.
 */
export const CACHE_HIT_RENDER_SETTINGS = {
  v: 4,
  maxRenderSec: DEFAULT_MAX_RENDER_SEC,
  introSkipSec: DEFAULT_INTRO_SKIP_SEC,
  maxClassifySec: DEFAULT_MAX_CLASSIFY_SEC,
  sourceOffsetSec: 0,
  renderEngine: 'wasm',
  sidEngine: 'sidlite',
  traceCaptureEnabled: true,
  traceSidecarVersion: 1,
} as const;

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
    `${JSON.stringify(CACHE_HIT_RENDER_SETTINGS)}\n`,
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
