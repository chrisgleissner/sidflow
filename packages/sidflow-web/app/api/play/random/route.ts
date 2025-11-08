import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { parseSidFile } from '@sidflow/common';
import type { ApiResponse } from '@/lib/validation';
import {
  resolvePlaybackEnvironment,
  startSidPlayback,
  parseDurationSeconds,
} from '@/lib/rate-playback';
import { createPlaybackLock } from '@sidflow/common';
import { loadSonglengthsData, lookupSongLength } from '@/lib/songlengths';
import type { RateTrackInfo } from '@/lib/types/rate-track';

const PRESETS = ['quiet', 'ambient', 'energetic', 'dark', 'bright', 'complex'] as const;
type MoodPreset = (typeof PRESETS)[number];

function normalizePreset(value?: string): MoodPreset | undefined {
  if (!value) {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (PRESETS.includes(lower as MoodPreset)) {
    return lower as MoodPreset;
  }
  return undefined;
}

function moodMatchesPath(mood: MoodPreset | undefined, relativePath: string): boolean {
  if (!mood) {
    return true;
  }
  const lower = relativePath.toLowerCase();
  switch (mood) {
    case 'quiet':
      return lower.includes('ambient') || lower.includes('relax') || lower.includes('demo');
    case 'ambient':
      return lower.includes('ambient') || lower.includes('mellow');
    case 'energetic':
      return lower.includes('game') || lower.includes('action') || lower.includes('demo');
    case 'dark':
      return lower.includes('dark') || lower.includes('goth') || lower.includes('mystic');
    case 'bright':
      return lower.includes('pop') || lower.includes('happy') || lower.includes('tune');
    case 'complex':
      return lower.includes('hubbard') || lower.includes('matt') || lower.includes('complex');
    default:
      return true;
  }
}

function isWithin(baseRoot: string, target: string): boolean {
  const relative = path.relative(baseRoot, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function pickRandomSid(
  hvscRoot: string,
  collectionRoot: string,
  preset?: MoodPreset
): Promise<string | null> {
  const { paths } = await loadSonglengthsData(hvscRoot);
  if (paths.length === 0) {
    return null;
  }
  const baseRelative = path.relative(hvscRoot, collectionRoot);
  const normalizedBase = baseRelative
    .split(path.sep)
    .filter(Boolean)
    .join('/');
  const subsetSupported =
    normalizedBase === '' || (!normalizedBase.startsWith('..') && !path.isAbsolute(baseRelative));
  const basePrefix = normalizedBase ? `${normalizedBase.replace(/\/+$/, '')}/` : '';

  const filtered = paths.filter((p) => {
    if (!subsetSupported) {
      return true;
    }
    if (normalizedBase === '') {
      return moodMatchesPath(preset, p);
    }
    const matchesSubset = p === normalizedBase || p.startsWith(basePrefix);
    return matchesSubset && moodMatchesPath(preset, p);
  });
  const candidates = filtered.length > 0 ? filtered : paths;
  const maxAttempts = Math.min(candidates.length, 2000);
  const seen = new Set<number>();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let index = Math.floor(Math.random() * candidates.length);
    while (seen.has(index) && seen.size < candidates.length) {
      index = (index + 1) % candidates.length;
    }
    if (seen.has(index)) {
      break;
    }
    seen.add(index);
    const relativePosix = candidates[index].replace(/^\//, '');
    const absolutePath = path.join(hvscRoot, ...relativePosix.split('/'));
    if (!isWithin(collectionRoot, absolutePath)) {
      continue;
    }
    return absolutePath;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const preset = normalizePreset(body?.preset);

    const env = await resolvePlaybackEnvironment();
    const sidPath = await pickRandomSid(env.hvscPath, env.collectionRoot, preset);

    if (!sidPath || !(await pathExists(sidPath))) {
      const response: ApiResponse = {
        success: false,
        error: 'No SID files available',
        details: 'Unable to locate a SID to play.',
      };
      return NextResponse.json(response, { status: 404 });
    }

    const playbackLock = await createPlaybackLock(env.config);
    await playbackLock.stopExistingPlayback('api/play/random');

    const metadata = await parseSidFile(sidPath);
    const fileStats = await stat(sidPath);
    const length = await lookupSongLength(sidPath, env.hvscPath, env.musicRoot);
    const relativePath = path.relative(env.collectionRoot, sidPath);
    const filename = path.basename(sidPath);
    const selectedSong = metadata.startSong;
    const durationSeconds = parseDurationSeconds(metadata.length ?? length);

    await startSidPlayback({
      env,
      playbackLock,
      sidPath,
      offsetSeconds: 0,
      durationSeconds,
      source: 'api/play/random',
    });

    const payload: RateTrackInfo = {
      sidPath,
      relativePath,
      filename,
      displayName: metadata.title || filename.replace(/\.sid$/i, ''),
      selectedSong,
      metadata: {
        title: metadata.title || undefined,
        author: metadata.author || undefined,
        released: metadata.released || undefined,
        songs: metadata.songs,
        startSong: metadata.startSong,
        sidType: metadata.type,
        version: metadata.version,
        sidModel: metadata.sidModel1,
        sidModelSecondary: metadata.sidModel2,
        sidModelTertiary: metadata.sidModel3,
        clock: metadata.clock,
        length: length,
        fileSizeBytes: fileStats.size,
      },
      durationSeconds,
    };

    const response: ApiResponse<{ track: RateTrackInfo }> = {
      success: true,
      data: { track: payload },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[api/play/random] failed', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to load random SID',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    const stats = await stat(candidate);
    return stats.isFile();
  } catch {
    return false;
  }
}
