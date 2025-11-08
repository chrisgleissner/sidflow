import { NextResponse } from 'next/server';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { parseSidFile, pathExists } from '@sidflow/common';
import { createTagFilePath, findUntaggedSids } from '@sidflow/rate';
import type { ApiResponse } from '@/lib/validation';
import {
  resolvePlaybackEnvironment,
  startSidPlayback,
  parseDurationSeconds,
} from '@/lib/rate-playback';
import { createPlaybackLock } from '@sidflow/common';
import { loadSonglengthsData, lookupSongLength } from '@/lib/songlengths';
import type { RateTrackInfo, RateTrackMetadata } from '@/lib/types/rate-track';

type RateTrackPayload = RateTrackInfo;

type RateTrackMetadata = TrackMetadata;
type RateTrackPayload = TrackPayload;

function resolveExecutable(executable: string, root: string): string {
  if (path.isAbsolute(executable)) {
    return executable;
  }
  if (executable.startsWith('./') || executable.startsWith('../')) {
    return path.resolve(root, executable);
  }
  return executable;
}

async function pickRandomUntaggedSid(
  hvscPath: string,
  musicRoot: string,
  tagsPath: string
): Promise<string | null> {
  const { paths } = await loadSonglengthsData(hvscPath);
  if (paths.length > 0) {
    const maxAttempts = Math.min(paths.length, 2000);
    const seen = new Set<number>();

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let index = Math.floor(Math.random() * paths.length);
      while (seen.has(index) && seen.size < paths.length) {
        index = (index + 1) % paths.length;
      }
      if (seen.has(index)) {
        break;
      }
      seen.add(index);
      const relativePosix = paths[index].replace(/^\//, '');
      const absolutePath = path.join(musicRoot, ...relativePosix.split('/'));
      if (!(await pathExists(absolutePath))) {
        continue;
      }
      const tagPath = createTagFilePath(hvscPath, tagsPath, absolutePath);
      if (!(await pathExists(tagPath))) {
        return absolutePath;
      }
    }
  }

  const fallback = await findUntaggedSids(hvscPath, tagsPath);
  if (fallback.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * fallback.length);
  const candidate = fallback[index] ?? null;
  if (candidate && (await pathExists(candidate))) {
    return candidate;
  }
  return null;
}

async function startPlayback(
  sidPath: string,
  sidplayPath: string,
  root: string,
  playbackLock: PlaybackLock,
  playbackSource: string
): Promise<void> {
  try {
    const child = spawn(resolveExecutable(sidplayPath, root), [sidPath], {
      stdio: 'ignore',
      cwd: path.dirname(sidPath),
    });
    if (child.pid) {
      const metadata = {
        pid: child.pid,
        command: playbackSource,
        sidPath,
        source: playbackSource,
        startedAt: new Date().toISOString(),
      };
      await playbackLock.registerProcess(metadata);
      const pid = child.pid;
      child.once('exit', () => {
        void playbackLock.releaseIfMatches(pid);
      });
      child.once('error', () => {
        void playbackLock.releaseIfMatches(pid);
      });
    }
  } catch (error) {
    console.error('[api/rate/random] Unable to spawn sidplayfp', error);
    await playbackLock.stopExistingPlayback(playbackSource);
  }
}

function buildResponse(track: RateTrackPayload): ApiResponse<{ track: RateTrackPayload }> {
  return {
    success: true,
    data: {
      track,
    },
  };
}

export async function POST() {
  try {
    const env = await resolvePlaybackEnvironment();
    const sidPath = await pickRandomUntaggedSid(env.hvscPath, env.musicRoot, env.tagsPath);
    if (!sidPath) {
      const response: ApiResponse = {
        success: false,
        error: 'No SID files to rate',
        details: 'All SID files appear to be tagged already.',
      };
      return NextResponse.json(response, { status: 404 });
    }
    const playbackLock = await createPlaybackLock(env.config);
    await playbackLock.stopExistingPlayback('api/rate/random');

    if (!(await pathExists(sidPath))) {
      return NextResponse.json(
        {
          success: false,
          error: 'Selected SID no longer exists',
          details: `Could not find ${sidPath}`,
        },
        { status: 410 }
      );
    }

    const metadata = await parseSidFile(sidPath);
    const fileStats = await stat(sidPath);
    const length = await lookupSongLength(sidPath, env.hvscPath, env.musicRoot);
    const relativePath = path.relative(env.musicRoot, sidPath);
    const filename = path.basename(sidPath);
    const selectedSong = metadata.startSong;
    const durationSeconds = parseDurationSeconds(metadata.length ?? length);

    await startSidPlayback({
      env,
      playbackLock,
      sidPath,
      offsetSeconds: 0,
      durationSeconds,
      source: 'api/rate/random',
    });

    const payload: RateTrackPayload = {
      sidPath,
      relativePath,
      filename,
      displayName: metadata.title || filename.replace(/\.sid$/i, ''),
      selectedSong,
      durationSeconds,
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
    };

    return NextResponse.json(buildResponse(payload), { status: 200 });
  } catch (error) {
    console.error('[api/rate/random] Failed to load random SID', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to load random SID',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
