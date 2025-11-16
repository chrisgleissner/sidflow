import path from 'node:path';
import { stat } from 'node:fs/promises';
import { parseSidFile, pathExists, type SidflowConfig } from '@sidflow/common';
import { getRepoRoot } from '@/lib/server-env';
import { resolveSidCollectionContext } from '@/lib/sid-collection';
import type { RateTrackInfo } from '@/lib/types/rate-track';

export interface PlaybackEnvironment {
  config: SidflowConfig;
  root: string;
  sidPath: string; // physical HVSC root
  collectionRoot: string;
  musicRoot: string;
  tagsPath: string;
  kernalRomPath: string | null;
  basicRomPath: string | null;
  chargenRomPath: string | null;
}

export async function resolvePlaybackEnvironment(): Promise<PlaybackEnvironment> {
  const context = await resolveSidCollectionContext();
  const root = getRepoRoot();
  return {
    config: context.config,
    root,
    sidPath: context.hvscRoot,
    collectionRoot: context.collectionRoot,
    musicRoot: context.collectionRoot,
    tagsPath: context.tagsPath,
    kernalRomPath: context.kernalRomPath ?? null,
    basicRomPath: context.basicRomPath ?? null,
    chargenRomPath: context.chargenRomPath ?? null,
  };
}

export function parseDurationSeconds(length?: string): number {
  if (!length) {
    return 180;
  }

  if (length.includes(':')) {
    const [minutes, secondsPart] = length.split(':');
    const mins = Number(minutes);
    const secs = Number(secondsPart);
    if (!Number.isNaN(mins) && !Number.isNaN(secs)) {
      return Math.max(15, mins * 60 + secs);
    }
  }

  const numeric = Number(length);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return Math.max(15, numeric);
  }

  return 180;
}

export async function resolveSidPath(
  input: string,
  env: PlaybackEnvironment
): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('SID path is required');
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/^\.\/+/, '');
  const direct = path.join(env.sidPath, normalized);
  if (await pathExists(direct)) {
    return direct;
  }

  const withoutPrefix = normalized.replace(/^c64music[\/]/i, '');
  const musicCandidate = path.join(env.musicRoot, withoutPrefix);
  if (await pathExists(musicCandidate)) {
    return musicCandidate;
  }

  return direct;
}

export async function createRateTrackInfo(options: {
  env: PlaybackEnvironment;
  sidPath: string;
  relativeBase: 'hvsc' | 'collection';
  lengthHint?: string;
}): Promise<RateTrackInfo> {
  const { env, sidPath, relativeBase, lengthHint } = options;
  const metadata = await parseSidFile(sidPath);
  const durationSeconds = parseDurationSeconds(lengthHint);
  const fileSize = (await stat(sidPath)).size;
  const relativeRoot = relativeBase === 'hvsc' ? env.sidPath : env.collectionRoot;
  const relativePath = path.relative(relativeRoot, sidPath);
  return {
    sidPath,
    relativePath,
    filename: path.basename(sidPath),
    displayName: metadata.title || path.basename(sidPath).replace(/\.sid$/i, ''),
    selectedSong: metadata.startSong,
    metadata: {
      title: metadata.title,
      author: metadata.author,
      released: metadata.released,
      songs: metadata.songs,
      startSong: metadata.startSong,
      sidType: metadata.type,
      version: metadata.version,
      sidModel: metadata.sidModel1,
      sidModelSecondary: metadata.sidModel2,
      sidModelTertiary: metadata.sidModel3,
      clock: metadata.clock,
      length: lengthHint,
      fileSizeBytes: fileSize,
    },
    durationSeconds,
  };
}
