'use strict';

import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { defaultRenderWav, needsWavRefresh, planClassification, resolveWavPath } from '@sidflow/classify';
type ClassificationPlan = Awaited<ReturnType<typeof planClassification>>;
import type { RateTrackInfo } from '@/lib/types/rate-track';

interface WavPrefetchJob {
  promise: Promise<void>;
  startedAt: number;
}

const inflight = new Map<string, WavPrefetchJob>();
let planPromise: Promise<ClassificationPlan> | null = null;

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('../../../.sidflow.json', import.meta.url));
const CONFIG_PATH = process.env.SIDFLOW_CONFIG_PATH?.trim().length
  ? process.env.SIDFLOW_CONFIG_PATH
  : DEFAULT_CONFIG_PATH;

function computeKey(sidPath: string, songIndex?: number): string {
  return `${sidPath}#${songIndex ?? 0}`;
}

async function getPlan(): Promise<ClassificationPlan> {
  if (!planPromise) {
    planPromise = planClassification({ configPath: CONFIG_PATH }).catch((error: unknown) => {
      planPromise = null;
      throw error;
    });
  }
  return planPromise;
}

async function executePrefetch(track: RateTrackInfo): Promise<void> {
  const plan = await getPlan();
  const songIndex = track.metadata.songs > 1 ? track.selectedSong : undefined;
  const key = computeKey(track.sidPath, songIndex);

  const existing = inflight.get(key);
  if (existing?.promise) {
    return existing.promise;
  }

  const jobPromise = (async () => {
    try {
      const wavPath = resolveWavPath(plan, track.sidPath, songIndex);
      const needsRefresh = await needsWavRefresh(track.sidPath, wavPath, plan.forceRebuild);
      if (!needsRefresh) {
        return;
      }

      await defaultRenderWav({
        sidFile: track.sidPath,
        wavFile: wavPath,
        songIndex,
        maxRenderSeconds: track.durationSeconds > 0 ? Math.ceil(track.durationSeconds + 15) : undefined,
      });
    } catch (error) {
      console.error('[wav-cache] Failed to pre-render WAV', {
        sidPath: track.sidPath,
        selectedSong: track.selectedSong,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, { promise: jobPromise, startedAt: Date.now() });
  return jobPromise;
}

export async function scheduleWavPrefetchForTrack(track: RateTrackInfo | null | undefined): Promise<void> {
  if (!track || !track.sidPath) {
    return;
  }
  void executePrefetch(track);
}

export async function ensureWavPrefetched(track: RateTrackInfo | null | undefined): Promise<void> {
  if (!track || !track.sidPath) {
    return;
  }
  await executePrefetch(track);
}
