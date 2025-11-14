import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./fs.js";
import {
  writeCanonicalJsonFile,
  type CanonicalJsonFileOptions
} from "./canonical-writer.js";
import type { JsonValue } from "./json.js";
import type { RenderEngine, RenderFormat } from "./config.js";
import type { RenderMode } from "./render-matrix.js";
import type { CaptureStatistics } from "./ultimate64-capture.js";

export const AVAILABILITY_MANIFEST_VERSION = "1.0.0";

export type AvailabilityFormat = RenderFormat | "hls";

export interface AvailabilityCaptureMetadata
  extends Partial<CaptureStatistics> {
  bufferTimeMs?: number;
  sampleRate?: number;
  channels?: number;
}

export interface AvailabilityAsset {
  readonly id: string;
  readonly relativeSidPath: string;
  readonly songIndex: number;
  readonly format: AvailabilityFormat;
  readonly engine: RenderEngine;
  readonly renderMode: RenderMode;
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly sizeBytes: number;
  readonly bitrateKbps?: number;
  readonly codec?: string;
  readonly storagePath: string;
  readonly publicPath?: string;
  readonly checksum?: string;
  readonly capture?: AvailabilityCaptureMetadata;
  readonly metadata?: Record<string, unknown>;
  readonly generatedAt: string;
}

export interface AvailabilityManifest {
  version: string;
  generatedAt: string;
  assets: AvailabilityAsset[];
}

export function createAvailabilityAssetId(input: {
  relativeSidPath: string;
  songIndex: number;
  format: AvailabilityFormat;
  engine: RenderEngine;
  renderMode: RenderMode;
}): string {
  const hash = createHash("sha1");
  hash.update(normalizeRelativePath(input.relativeSidPath));
  hash.update("#");
  hash.update(String(input.songIndex));
  hash.update(":");
  hash.update(input.format);
  hash.update(":");
  hash.update(input.engine);
  hash.update(":");
  hash.update([input.renderMode.location, input.renderMode.time, input.renderMode.technology, input.renderMode.target].join("/"));
  return hash.digest("hex");
}

export async function loadAvailabilityManifest(manifestPath: string): Promise<AvailabilityManifest> {
  if (!manifestPath) {
    throw new Error("Availability manifest path is required");
  }

  if (!(await pathExists(manifestPath))) {
    return createEmptyManifest();
  }

  const content = await readFile(manifestPath, "utf8");
  const parsed = JSON.parse(content) as AvailabilityManifest;
  return normalizeManifest(parsed);
}

export async function registerAvailabilityAsset(
  manifestPath: string,
  asset: AvailabilityAsset,
  options?: CanonicalJsonFileOptions
): Promise<AvailabilityManifest> {
  const manifest = await loadAvailabilityManifest(manifestPath);
  const normalized = normalizeAsset(asset);
  const key = assetKeyOf(normalized);
  const existingIndex = manifest.assets.findIndex((entry) => assetKeyOf(entry) === key);

  if (existingIndex >= 0) {
    manifest.assets[existingIndex] = normalized;
  } else {
    manifest.assets.push(normalized);
  }

  manifest.assets.sort(compareAssets);
  manifest.generatedAt = new Date().toISOString();

  await saveAvailabilityManifest(manifestPath, manifest, {
    ...options,
    details: {
      ...(options?.details ?? {}),
      assetKey: key,
      format: normalized.format,
      songIndex: normalized.songIndex,
    },
  });

  return manifest;
}

export async function saveAvailabilityManifest(
  manifestPath: string,
  manifest: AvailabilityManifest,
  options?: CanonicalJsonFileOptions
): Promise<void> {
  const payload: AvailabilityManifest = {
    ...manifest,
    version: manifest.version ?? AVAILABILITY_MANIFEST_VERSION,
    assets: manifest.assets.map(normalizeAsset),
  };

  await writeCanonicalJsonFile(
    manifestPath,
    payload as unknown as JsonValue,
    {
      ...options,
      details: {
        ...(options?.details ?? {}),
        assetCount: payload.assets.length,
      },
    }
  );
}

export function findAvailabilityAsset(
  manifest: AvailabilityManifest,
  relativeSidPath: string,
  songIndex: number,
  format: AvailabilityFormat
): AvailabilityAsset | null {
  const normalizedPath = normalizeRelativePath(relativeSidPath);
  const key = assetKeyFromParts(normalizedPath, songIndex, format);
  return manifest.assets.find((entry) => assetKeyOf(entry) === key) ?? null;
}

export function listAvailabilityAssets(
  manifest: AvailabilityManifest,
  relativeSidPath: string,
  songIndex?: number
): AvailabilityAsset[] {
  const normalizedPath = normalizeRelativePath(relativeSidPath);
  return manifest.assets.filter((entry) => {
    if (entry.relativeSidPath !== normalizedPath) {
      return false;
    }
    if (typeof songIndex === "number") {
      return entry.songIndex === songIndex;
    }
    return true;
  });
}

function createEmptyManifest(): AvailabilityManifest {
  return {
    version: AVAILABILITY_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    assets: [],
  };
}

function normalizeManifest(manifest: AvailabilityManifest): AvailabilityManifest {
  return {
    version: manifest.version ?? AVAILABILITY_MANIFEST_VERSION,
    generatedAt: manifest.generatedAt ?? new Date().toISOString(),
    assets: manifest.assets.map(normalizeAsset).sort(compareAssets),
  };
}

function normalizeAsset(asset: AvailabilityAsset): AvailabilityAsset {
  return {
    ...asset,
    relativeSidPath: normalizeRelativePath(asset.relativeSidPath),
    storagePath: normalizePath(asset.storagePath),
    publicPath: asset.publicPath ? normalizeRelativePath(asset.publicPath) : undefined,
  };
}

function assetKeyOf(asset: Pick<AvailabilityAsset, "relativeSidPath" | "songIndex" | "format">): string {
  return assetKeyFromParts(
    normalizeRelativePath(asset.relativeSidPath),
    asset.songIndex,
    asset.format
  );
}

function assetKeyFromParts(
  relativePath: string,
  songIndex: number,
  format: AvailabilityFormat
): string {
  return `${relativePath}#${songIndex}.${format}`;
}

function compareAssets(a: AvailabilityAsset, b: AvailabilityAsset): number {
  const pathCompare = a.relativeSidPath.localeCompare(b.relativeSidPath);
  if (pathCompare !== 0) {
    return pathCompare;
  }
  if (a.songIndex !== b.songIndex) {
    return a.songIndex - b.songIndex;
  }
  const formatCompare = a.format.localeCompare(b.format);
  if (formatCompare !== 0) {
    return formatCompare;
  }
  return a.generatedAt.localeCompare(b.generatedAt);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\+/g, "/").replace(/^\.\/+/, "");
}

function normalizePath(value: string): string {
  const normalized = path.normalize(value);
  return normalized.replace(/\\+/g, "/");
}
