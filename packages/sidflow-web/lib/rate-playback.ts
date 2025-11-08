import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  createPlaybackLock,
  type PlaybackLock,
  type PlaybackLockMetadata,
  type SidflowConfig,
} from '@sidflow/common';
import { getRepoRoot, getSidflowConfig } from '@/lib/server-env';

export interface RatePlaybackEnvironment {
  config: SidflowConfig;
  root: string;
  hvscPath: string;
  musicRoot: string;
  tagsPath: string;
}

export async function resolveRatePlaybackEnvironment(): Promise<RatePlaybackEnvironment> {
  const config = await getSidflowConfig();
  const root = getRepoRoot();
  const hvscPath = path.resolve(root, config.hvscPath);
  return {
    config,
    root,
    hvscPath,
    musicRoot: path.join(hvscPath, 'C64Music'),
    tagsPath: path.resolve(root, config.tagsPath),
  };
}

function formatSidplayOffset(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds - mins * 60).toFixed(3);
  return `${mins}:${secs.padStart(6, '0')}`;
}

export async function startSidPlayback(options: {
  env: RatePlaybackEnvironment;
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
