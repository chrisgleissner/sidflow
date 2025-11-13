import { spawn } from 'node:child_process';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { defaultRenderWav, needsWavRefresh, planClassification, resolveWavPath } from '@sidflow/classify';
import { ensureDir, pathExists } from '@sidflow/common';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { resolveFromRepoRoot } from '@/lib/server-env';

const HLS_ROOT = resolveFromRepoRoot('workspace', 'hls');

const inflight = new Map<string, Promise<string | null>>();
let planPromise: ReturnType<typeof planClassification> | null = null;

interface HlsAssetInfo {
    outputDir: string;
    manifestPath: string;
    segmentPattern: string;
    publicUrl: string;
}

async function getPlan() {
    if (!planPromise) {
        const configFile = (process.env.SIDFLOW_CONFIG ?? '.sidflow.json').trim();
        const resolvedConfigPath = resolveFromRepoRoot(configFile);
        const configDir = path.dirname(resolvedConfigPath);
        const absolutize = (candidate: string) => (path.isAbsolute(candidate)
            ? candidate
            : path.resolve(configDir, candidate));

        planPromise = planClassification({
            configPath: resolvedConfigPath,
        })
            .then((plan) => ({
                ...plan,
                hvscPath: absolutize(plan.hvscPath),
                wavCachePath: absolutize(plan.wavCachePath),
                tagsPath: absolutize(plan.tagsPath),
            }))
            .catch((error) => {
                planPromise = null;
                throw error;
            });
    }
    return planPromise;
}

function normalizeRelativePath(relativePath: string): string {
    return relativePath.split(/[\\/]+/).filter(Boolean).join('/');
}

function computeHlsAssetInfo(track: RateTrackInfo): HlsAssetInfo {
    const normalized = normalizeRelativePath(track.relativePath || track.filename);
    const parts = normalized.split('/');
    const fileName = parts.pop() ?? track.filename;
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const songLabel = `song-${String(Math.max(1, track.selectedSong)).padStart(2, '0')}`;
    const outputDir = path.resolve(HLS_ROOT, ...parts, baseName, songLabel);
    if (!outputDir.startsWith(HLS_ROOT)) {
        throw new Error('HLS output directory escapes configured root');
    }
    const manifestPath = path.join(outputDir, 'index.m3u8');
    const segmentPattern = path.join(outputDir, 'segment-%03d.ts');
    const relativeManifest = path.relative(HLS_ROOT, manifestPath).split(path.sep).join('/');
    const publicUrl = `/hls/${relativeManifest}`;
    return { outputDir, manifestPath, segmentPattern, publicUrl };
}

async function ensureWavAsset(track: RateTrackInfo): Promise<string> {
    const plan = await getPlan();
    const songIndex = track.metadata.songs > 1 ? track.selectedSong : undefined;
    const wavPath = resolveWavPath(plan, track.sidPath, songIndex);

    const needsRefresh = !(await pathExists(wavPath))
        || await needsWavRefresh(track.sidPath, wavPath, plan.forceRebuild);

    if (needsRefresh) {
        await defaultRenderWav({
            sidFile: track.sidPath,
            wavFile: wavPath,
            songIndex,
            maxRenderSeconds: track.durationSeconds > 0 ? Math.ceil(track.durationSeconds + 15) : undefined,
        });
    }

    return wavPath;
}

async function isManifestFresh(info: HlsAssetInfo, wavPath: string, sidPath: string): Promise<boolean> {
    if (!(await pathExists(info.manifestPath))) {
        return false;
    }
    const [manifestStat, wavStat, sidStat] = await Promise.all([
        stat(info.manifestPath),
        stat(wavPath).catch(() => ({ mtimeMs: 0 } as const)),
        stat(sidPath).catch(() => ({ mtimeMs: 0 } as const)),
    ]);

    if (manifestStat.mtimeMs < wavStat.mtimeMs || manifestStat.mtimeMs < sidStat.mtimeMs) {
        return false;
    }

    const firstSegment = path.join(path.dirname(info.segmentPattern), 'segment-000.ts');
    return pathExists(firstSegment);
}

async function runFfmpeg(wavPath: string, info: HlsAssetInfo): Promise<void> {
    const ffmpegModule = await import('ffmpeg-static');
    const ffmpegPath = (ffmpegModule.default ?? ffmpegModule) as string | undefined;
    if (!ffmpegPath) {
        throw new Error('ffmpeg-static binary unavailable for this platform');
    }

    const ensureBinaryPath = async (candidate: string): Promise<string | null> => {
        if (await pathExists(candidate)) {
            return candidate;
        }

        const rootPrefix = '/ROOT/';
        if (candidate.startsWith(rootPrefix)) {
            const relative = candidate.slice(rootPrefix.length);
            const resolved = resolveFromRepoRoot(relative);
            if (await pathExists(resolved)) {
                return resolved;
            }
        }

        if (!path.isAbsolute(candidate)) {
            const resolved = resolveFromRepoRoot(candidate);
            if (await pathExists(resolved)) {
                return resolved;
            }
        }

        return null;
    };

    const binaryPath = await ensureBinaryPath(ffmpegPath);
    if (!binaryPath) {
        throw new Error(`ffmpeg-static binary missing at ${ffmpegPath}`);
    }

    await rm(info.outputDir, { recursive: true, force: true });
    await ensureDir(info.outputDir);

    const args = [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-i', wavPath,
        '-vn',
        '-acodec', 'aac',
        '-b:a', '192k',
        '-ac', '2',
        '-ar', '44100',
        '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', info.segmentPattern,
        info.manifestPath,
    ];

    await new Promise<void>((resolve, reject) => {
        const child = spawn(binaryPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.once('error', (error) => {
            reject(error);
        });
        child.once('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`ffmpeg exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
            }
        });
    });
}

async function generateHlsForTrack(track: RateTrackInfo): Promise<string | null> {
    const wavPath = await ensureWavAsset(track);
    const info = computeHlsAssetInfo(track);

    if (await isManifestFresh(info, wavPath, track.sidPath)) {
        return info.publicUrl;
    }

    await runFfmpeg(wavPath, info);

    if (!(await pathExists(info.manifestPath))) {
        return null;
    }

    return info.publicUrl;
}

function computeKey(track: RateTrackInfo): string {
    return `${normalizeRelativePath(track.relativePath || track.filename)}#${track.selectedSong}`;
}

export async function ensureHlsForTrack(track: RateTrackInfo): Promise<string | null> {
    const key = computeKey(track);
    const existing = inflight.get(key);
    if (existing) {
        return existing;
    }

    const promise = (async () => {
        try {
            return await generateHlsForTrack(track);
        } catch (error) {
            console.error('[hls-service] Failed to build HLS assets', {
                sidPath: track.sidPath,
                error,
            });
            return null;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, promise);
    return promise;
}
