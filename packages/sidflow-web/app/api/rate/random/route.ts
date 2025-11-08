import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { parseSidFile, pathExists } from '@sidflow/common';
import { createTagFilePath, findUntaggedSids } from '@sidflow/rate';
import type { ApiResponse } from '@/lib/validation';
import {
  resolvePlaybackEnvironment,
  startSidPlayback,
  parseDurationSeconds,
} from '@/lib/rate-playback';
import { createPlaybackLock } from '@sidflow/common';

interface RateTrackMetadata {
  title?: string;
  author?: string;
  released?: string;
  songs: number;
  startSong: number;
  sidType: string;
  version: number;
  sidModel: string;
  sidModelSecondary?: string;
  sidModelTertiary?: string;
  clock: string;
  length?: string;
  fileSizeBytes: number;
}

interface RateTrackPayload {
  sidPath: string;
  relativePath: string;
  filename: string;
  displayName: string;
  selectedSong: number;
  metadata: RateTrackMetadata;
  durationSeconds: number;
}

interface SonglengthsData {
  map: Map<string, string>;
  paths: string[];
  lengthByPath: Map<string, string>;
}

const songlengthsCache = new Map<string, Promise<SonglengthsData>>();
const lengthCache = new Map<string, string | null>();

async function loadSonglengthsData(hvscPath: string): Promise<SonglengthsData> {
  if (songlengthsCache.has(hvscPath)) {
    return songlengthsCache.get(hvscPath)!;
  }

  const loader = (async () => {
    const candidates = [
      path.join(hvscPath, 'DOCUMENTS', 'Songlengths.md5'),
      path.join(hvscPath, 'C64Music', 'DOCUMENTS', 'Songlengths.md5'),
      path.join(hvscPath, 'update', 'DOCUMENTS', 'Songlengths.md5'),
    ];

    for (const candidate of candidates) {
      try {
        await fsp.access(candidate);
        const contents = await fsp.readFile(candidate, 'utf8');
        const map = new Map<string, string>();
        const paths: string[] = [];
        const lengthByPath = new Map<string, string>();
        let currentPath: string | null = null;
        const lines = contents.split(/\r?\n/);
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) {
            continue;
          }
          if (line.startsWith(';')) {
            const relative = line.slice(1).trim();
            if (relative.toLowerCase().endsWith('.sid')) {
              currentPath = relative.replace(/^\//, '');
            }
            continue;
          }
          if (line.startsWith('[')) {
            continue;
          }
          const match = line.match(/^([0-9a-fA-F]{32})=(.+)$/);
          if (match) {
            map.set(match[1].toLowerCase(), match[2].trim());
            if (currentPath) {
              paths.push(currentPath);
              lengthByPath.set(currentPath, match[2].trim());
              currentPath = null;
            }
          }
        }
        return { map, paths, lengthByPath };
      } catch {
        // try next candidate
      }
    }
    return { map: new Map<string, string>(), paths: [], lengthByPath: new Map() };
  })();

  songlengthsCache.set(hvscPath, loader);
  return loader;
}

async function computeFileMd5(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk as Buffer));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

async function lookupSongLength(
  filePath: string,
  hvscPath: string,
  musicRoot: string
): Promise<string | undefined> {
  if (lengthCache.has(filePath)) {
    return lengthCache.get(filePath) ?? undefined;
  }
  const { map, lengthByPath } = await loadSonglengthsData(hvscPath);
  const relativePosix = path.relative(musicRoot, filePath).split(path.sep).join('/');
  const fromCatalog = lengthByPath.get(relativePosix);
  if (fromCatalog) {
    lengthCache.set(filePath, fromCatalog);
    return fromCatalog;
  }
  if (map.size === 0) {
    lengthCache.set(filePath, null);
    return undefined;
  }
  try {
    const md5 = await computeFileMd5(filePath);
    const length = map.get(md5.toLowerCase());
    lengthCache.set(filePath, length ?? null);
    return length;
  } catch (error) {
    console.warn('[api/rate/random] Failed to compute MD5 for song length lookup', {
      filePath,
      error,
    });
    lengthCache.set(filePath, null);
    return undefined;
  }
}

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
    const relativePath = path.relative(env.hvscPath, sidPath);
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
