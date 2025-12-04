import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { pathExists, loadSonglengthsData, lookupSongLength } from '@sidflow/common';
import type { ApiResponse } from '@/lib/validation';
import {
  resolvePlaybackEnvironment,
  createRateTrackInfo,
} from '@/lib/rate-playback';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { createPlaybackSession } from '@/lib/playback-session';
import { ensureHlsForTrack } from '@/lib/server/hls-service';
import { resolveSessionStreamAssets } from '@/lib/server/availability-service';

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
    return await pickRandomSidFromFilesystem(collectionRoot);
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
  const maxAttempts = Math.min(candidates.length, 100);
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
  return await pickRandomSidFromFilesystem(collectionRoot);
}

async function pickRandomSidFromFilesystem(collectionRoot: string): Promise<string | null> {
  let choice: string | null = null;
  let seen = 0;
  const stack = [collectionRoot];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !fullPath.toLowerCase().endsWith('.sid')) {
        continue;
      }
      seen += 1;
      if (Math.random() < 1 / seen) {
        choice = fullPath;
      }
    }
  }

  return choice;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const body = await request.json().catch(() => ({}));
    const preset = normalizePreset(body?.preset);
    const preview = Boolean(body?.preview);

    console.log('[API] /api/play/random - Request:', {
      preset,
      preview,
      timestamp: new Date().toISOString(),
    });

    const env = await resolvePlaybackEnvironment();
    const sidPath = await pickRandomSid(env.sidPath, env.collectionRoot, preset);

    if (!sidPath || !(await pathExists(sidPath))) {
      const response: ApiResponse = {
        success: false,
        error: 'No SID files available',
        details: 'Unable to locate a SID to play.',
      };
      return NextResponse.json(response, { status: 404 });
    }

    const fileStats = await stat(sidPath);
    const length = await lookupSongLength(sidPath, env.sidPath, env.musicRoot);

    const track = await createRateTrackInfo({
      env,
      sidPath,
      relativeBase: 'collection',
      lengthHint: length,
    });

    const enrichedTrack: RateTrackInfo = {
      ...track,
      metadata: {
        ...track.metadata,
        length,
        fileSizeBytes: fileStats.size,
      },
    };

    const fallbackHlsUrl = preview ? null : await ensureHlsForTrack(enrichedTrack);
    const streamAssets = preview ? [] : await resolveSessionStreamAssets(enrichedTrack);

    const session = preview
      ? null
      : createPlaybackSession({
        scope: 'play',
        sidPath,
        track: enrichedTrack,
        durationSeconds: enrichedTrack.durationSeconds,
        selectedSong: enrichedTrack.selectedSong,
        romPaths: {
          kernal: env.kernalRomPath ?? null,
          basic: env.basicRomPath ?? null,
          chargen: env.chargenRomPath ?? null,
        },
        fallbackHlsUrl,
        streamAssets,
      });

      const elapsedMs = Date.now() - startTime;
    console.log('[API] /api/play/random - Success:', {
      sessionId: session?.sessionId,
      sidPath,
      selectedSong: enrichedTrack.selectedSong,
      durationSeconds: enrichedTrack.durationSeconds,
      elapsedMs,
    });

    const response: ApiResponse<{ track: RateTrackInfo; session: typeof session | null }> = {
      success: true,
      data: { track: enrichedTrack, session },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const elapsedMs = Date.now() - startTime;
    console.error('[API] /api/play/random - Error:', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs,
    });
    const response: ApiResponse = {
      success: false,
      error: 'Failed to load random SID',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
