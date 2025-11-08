import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createPlaybackLock,
  type PlaybackLock,
  type PlaybackLockMetadata,
  type SidflowConfig,
} from '@sidflow/common';
import { getRepoRoot } from '@/lib/server-env';
import { resolveSidCollectionContext } from '@/lib/sid-collection';

export interface PlaybackEnvironment {
  config: SidflowConfig;
  root: string;
  hvscPath: string;
  musicRoot: string;
  tagsPath: string;
}

export async function resolvePlaybackEnvironment(): Promise<PlaybackEnvironment> {
  const context = await resolveSidCollectionContext();
  const root = getRepoRoot();
  return {
    config: context.config,
    root,
    hvscPath: context.hvscRoot,
    musicRoot: context.collectionRoot,
    tagsPath: context.tagsPath,
  };
}

function formatSidplayOffset(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds - mins * 60).toFixed(3);
  return `${mins}:${secs.padStart(6, '0')}`;
}

export async function startSidPlayback(options: {
  env: PlaybackEnvironment;
  playbackLock: PlaybackLock;
  sidPath: string;
  offsetSeconds?: number;
  durationSeconds?: number;
  source: string;
}): Promise<void> {
  const { env, playbackLock, sidPath, offsetSeconds = 0, durationSeconds, source } = options;
  await playbackLock.stopExistingPlayback(source);

  const args: string[] = [];
  if (offsetSeconds > 0) {
    args.push(`-b${formatSidplayOffset(offsetSeconds)}`);
  }
  args.push(sidPath);

  try {
    const child = spawn(env.config.sidplayPath, args, {
      stdio: 'ignore',
      cwd: path.dirname(sidPath),
    });

    if (child.pid) {
      const metadata: PlaybackLockMetadata = {
        pid: child.pid,
        command: source,
        sidPath,
        source,
        startedAt: new Date().toISOString(),
        offsetSeconds,
        durationSeconds,
        isPaused: false,
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
    console.error('[rate-playback] Unable to spawn sidplayfp', error);
    await playbackLock.stopExistingPlayback(source);
    throw error;
  }
}

export function computePlaybackPosition(metadata: PlaybackLockMetadata): number {
  const offset = metadata.offsetSeconds ?? 0;
  if (metadata.isPaused) {
    return offset;
  }
  const startedAt = metadata.startedAt ? Date.parse(metadata.startedAt) : Date.now();
  const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
  return offset + elapsed;
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
