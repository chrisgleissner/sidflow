import path from 'node:path';
import { stat } from 'node:fs/promises';
import {
  loadAvailabilityManifest,
  listAvailabilityAssets,
  type AvailabilityManifest,
  type AvailabilityAsset,
  type RenderFormat,
} from '@sidflow/common';
import { pathExists } from '@sidflow/common';
import type { SessionStreamAsset } from '@/lib/playback-session';
import type { RateTrackInfo } from '@/lib/types/rate-track';
import { resolveSidCollectionContext } from '@/lib/sid-collection';

const STREAM_FORMATS: RenderFormat[] = ['wav', 'm4a', 'flac'];

type StreamFormat = (typeof STREAM_FORMATS)[number];

interface AvailabilityContext {
  manifestPath: string;
  assetRoot: string;
  repoRoot: string;
}

interface ManifestCacheEntry {
  path: string;
  mtimeMs: number;
  manifest: AvailabilityManifest;
}

let contextPromise: Promise<AvailabilityContext | null> | null = null;
let manifestCache: ManifestCacheEntry | null = null;

export interface ResolvedStreamAsset {
  readonly format: StreamFormat;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitrateKbps?: number;
  readonly codec?: string;
  readonly publicPath?: string;
}

export async function resolveStreamAssetsForTrack(track: RateTrackInfo): Promise<ResolvedStreamAsset[]> {
  const context = await getAvailabilityContext();
  if (!context) {
    return [];
  }
  const manifest = await loadManifest(context);
  if (!manifest) {
    return [];
  }

  const relativeSidPath = normalizeRelativePath(track.relativePath);
  if (!relativeSidPath) {
    return [];
  }
  const songIndex = Math.max(1, track.selectedSong || 1);

  const candidates = listAvailabilityAssets(manifest, relativeSidPath, songIndex);
  if (candidates.length === 0) {
    return [];
  }

  const assets: ResolvedStreamAsset[] = [];
  for (const asset of candidates) {
    if (!isStreamFormat(asset)) {
      continue;
    }

    const filePath = resolveStoragePath(asset, context);
    if (!filePath || !(await pathExists(filePath))) {
      continue;
    }

    assets.push({
      format: asset.format,
      filePath,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs,
      sampleRate: asset.sampleRate,
      channels: asset.channels,
      bitrateKbps: asset.bitrateKbps,
      codec: asset.codec,
      publicPath: asset.publicPath,
    });
  }

  const priority: Record<StreamFormat, number> = { wav: 0, m4a: 1, flac: 2 };
  return assets.sort((a, b) => priority[a.format] - priority[b.format]);
}

export async function hasAvailabilityAssetsForFormat(format: StreamFormat): Promise<boolean> {
  const context = await getAvailabilityContext();
  if (!context) {
    return false;
  }
  const manifest = await loadManifest(context);
  if (!manifest) {
    return false;
  }
  return manifest.assets.some((asset) => asset.format === format);
}

export async function resolveSessionStreamAssets(track: RateTrackInfo): Promise<SessionStreamAsset[]> {
  const assets = await resolveStreamAssetsForTrack(track);
  return assets.map((asset) => ({
    format: asset.format,
    filePath: asset.filePath,
    sizeBytes: asset.sizeBytes,
    durationMs: asset.durationMs,
    sampleRate: asset.sampleRate,
    channels: asset.channels,
    bitrateKbps: asset.bitrateKbps,
    codec: asset.codec,
    publicPath: asset.publicPath,
  }));
}

async function getAvailabilityContext(): Promise<AvailabilityContext | null> {
  if (!contextPromise) {
    contextPromise = (async () => {
      const collection = await resolveSidCollectionContext();
      const availability = collection.config.availability;
      if (!availability?.manifestPath || !availability.assetRoot) {
        return null;
      }
      const manifestPath = resolveConfigPath(availability.manifestPath, collection.repoRoot);
      const assetRoot = resolveConfigPath(availability.assetRoot, collection.repoRoot);
      return {
        manifestPath,
        assetRoot,
        repoRoot: collection.repoRoot,
      };
    })().catch((error) => {
      console.error('[availability-service] Failed to resolve context', error);
      return null;
    });
  }

  const context = await contextPromise;
  if (!context) {
    contextPromise = null;
  }
  return context;
}

async function loadManifest(context: AvailabilityContext): Promise<AvailabilityManifest | null> {
  const stats = await stat(context.manifestPath).catch(() => null);
  if (!stats) {
    manifestCache = null;
    return null;
  }

  if (manifestCache && manifestCache.path === context.manifestPath && manifestCache.mtimeMs === stats.mtimeMs) {
    return manifestCache.manifest;
  }

  const manifest = await loadAvailabilityManifest(context.manifestPath);
  manifestCache = {
    path: context.manifestPath,
    mtimeMs: stats.mtimeMs,
    manifest,
  };
  return manifest;
}

function normalizeRelativePath(input?: string): string | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('..')) {
    return null;
  }
  return trimmed.replace(/\\+/g, '/').replace(/^\.\/+/, '');
}

function resolveConfigPath(candidate: string, repoRoot: string): string {
  if (path.isAbsolute(candidate)) {
    return path.normalize(candidate);
  }
  return path.resolve(repoRoot, candidate);
}

function isStreamFormat(asset: AvailabilityAsset): asset is AvailabilityAsset & { format: StreamFormat } {
  return STREAM_FORMATS.includes(asset.format as StreamFormat);
}

function resolveStoragePath(asset: AvailabilityAsset, context: AvailabilityContext): string | null {
  const normalized = asset.storagePath.replace(/\\+/g, '/');
  const systemPath = path.normalize(normalized);
  if (path.isAbsolute(systemPath)) {
    return systemPath;
  }

  const candidate = path.resolve(context.assetRoot, systemPath);
  if (isWithin(context.assetRoot, candidate)) {
    return candidate;
  }

  const fallback = path.resolve(context.repoRoot, systemPath);
  if (isWithin(context.repoRoot, fallback)) {
    return fallback;
  }

  return null;
}

function isWithin(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
