import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { parseSidFile } from '@sidflow/common';
import { findUntaggedSids } from '@sidflow/rate';
import type { ApiResponse } from '@/lib/validation';
import { getRepoRoot, getSidflowConfig } from '@/lib/server-env';

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
}

let untaggedQueue: string[] = [];
let playbackProcess: ChildProcess | null = null;
let songlengthsPromise: Promise<Map<string, string>> | null = null;
const lengthCache = new Map<string, string | null>();

async function ensureUntaggedQueue(hvscPath: string, tagsPath: string): Promise<void> {
  if (untaggedQueue.length === 0) {
    untaggedQueue = await findUntaggedSids(hvscPath, tagsPath);
  }
}

function popRandomTrack(): string | null {
  if (untaggedQueue.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * untaggedQueue.length);
  const [track] = untaggedQueue.splice(index, 1);
  return track ?? null;
}

function parseSonglengths(contents: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = contents.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('[') || line.startsWith(';')) {
      continue;
    }
    const match = line.match(/^([0-9a-fA-F]{32})=(.+)$/);
    if (match) {
      map.set(match[1].toLowerCase(), match[2].trim());
    }
  }
  return map;
}

async function loadSonglengthsMap(hvscPath: string): Promise<Map<string, string>> {
  if (songlengthsPromise) {
    return songlengthsPromise;
  }
  songlengthsPromise = (async () => {
    const candidates = [
      path.join(hvscPath, 'DOCUMENTS', 'Songlengths.md5'),
      path.join(hvscPath, 'C64Music', 'DOCUMENTS', 'Songlengths.md5'),
      path.join(hvscPath, 'update', 'DOCUMENTS', 'Songlengths.md5'),
    ];

    for (const candidate of candidates) {
      try {
        await fsp.access(candidate);
        const contents = await fsp.readFile(candidate, 'utf8');
        return parseSonglengths(contents);
      } catch {
        // try next candidate
      }
    }
    return new Map<string, string>();
  })();

  return songlengthsPromise;
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

async function lookupSongLength(filePath: string, hvscPath: string): Promise<string | undefined> {
  if (lengthCache.has(filePath)) {
    return lengthCache.get(filePath) ?? undefined;
  }
  const map = await loadSonglengthsMap(hvscPath);
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

function stopPlayback(): void {
  if (playbackProcess && !playbackProcess.killed) {
    playbackProcess.kill();
  }
  playbackProcess = null;
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

function startPlayback(sidPath: string, sidplayPath: string, root: string): void {
  stopPlayback();
  try {
    playbackProcess = spawn(resolveExecutable(sidplayPath, root), [sidPath], {
      stdio: 'ignore',
      cwd: path.dirname(sidPath),
    });
    playbackProcess.once('exit', () => {
      playbackProcess = null;
    });
    playbackProcess.once('error', (error) => {
      console.error('[api/rate/random] sidplayfp error', error);
    });
  } catch (error) {
    console.error('[api/rate/random] Unable to spawn sidplayfp', error);
    playbackProcess = null;
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

async function resolveEnvironment() {
  const config = await getSidflowConfig();
  const root = getRepoRoot();
  return {
    config,
    root,
    hvscPath: path.resolve(root, config.hvscPath),
    tagsPath: path.resolve(root, config.tagsPath),
  };
}

export async function POST() {
  try {
    const { config, root, hvscPath, tagsPath } = await resolveEnvironment();
    await ensureUntaggedQueue(hvscPath, tagsPath);

    if (untaggedQueue.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: 'No SID files to rate',
        details: 'All SID files appear to be tagged already.',
      };
      return NextResponse.json(response, { status: 404 });
    }

    const sidPath = popRandomTrack();
    if (!sidPath) {
      const response: ApiResponse = {
        success: false,
        error: 'Unable to select SID',
        details: 'Failed to pick a random SID file from the queue.',
      };
      return NextResponse.json(response, { status: 500 });
    }

    const metadata = await parseSidFile(sidPath);
    const fileStats = await stat(sidPath);
    const length = await lookupSongLength(sidPath, hvscPath);
    const relativePath = path.relative(hvscPath, sidPath);
    const filename = path.basename(sidPath);
    const selectedSong = metadata.startSong;

    startPlayback(sidPath, config.sidplayPath, root);

    const payload: RateTrackPayload = {
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
