'use client';

import type { RomManifestBundle, RomManifestFile, RomValidationResult } from '@/lib/preferences/types';
import { loadRomBundleFile, removeRomBundle, storeRomBundleFile } from '@/lib/preferences/storage';

async function computeSha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  return Array.from(view)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

const ROM_ROLES = ['basic', 'kernal', 'chargen'] as const;
type RomRole = (typeof ROM_ROLES)[number];

async function ensureFile(
  bundleId: string,
  descriptor: RomManifestFile,
  suppliedFile?: File | null
): Promise<RomValidationResult> {
  const cached = await loadRomBundleFile(bundleId, descriptor.fileName);
  if (cached && cached.hash === descriptor.sha256 && cached.bytes.byteLength === descriptor.size) {
    return { bundleId, fileName: descriptor.fileName, ok: true };
  }

  if (!suppliedFile) {
    return {
      bundleId,
      fileName: descriptor.fileName,
      ok: false,
      reason: `${descriptor.fileName} not installed locally. Provide a ROM matching SHA-256 ${descriptor.sha256.slice(0, 12)}…`,
    };
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await suppliedFile.arrayBuffer();
  } catch (error) {
    return {
      bundleId,
      fileName: descriptor.fileName,
      ok: false,
      reason: `Failed to read ${suppliedFile.name}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const hash = await computeSha256(bytes);
  if (hash !== descriptor.sha256) {
    return {
      bundleId,
      fileName: descriptor.fileName,
      ok: false,
      reason: `Hash mismatch (expected ${descriptor.sha256.slice(0, 12)}, got ${hash.slice(0, 12)})`,
    };
  }

  if (bytes.byteLength !== descriptor.size) {
    return {
      bundleId,
      fileName: descriptor.fileName,
      ok: false,
      reason: `Size mismatch (expected ${descriptor.size} bytes, got ${bytes.byteLength})`,
    };
  }

  await storeRomBundleFile(bundleId, descriptor.fileName, bytes, hash);
  return { bundleId, fileName: descriptor.fileName, ok: true };
}

export interface BundleInstallResult {
  bundleId: string;
  success: boolean;
  results: RomValidationResult[];
  error?: string;
}

export async function installRomBundle(
  bundle: RomManifestBundle,
  suppliedFiles: Partial<Record<RomRole, File | null>> = {}
): Promise<BundleInstallResult> {
  const descriptors: Record<RomRole, RomManifestFile> = {
    basic: bundle.files.basic,
    kernal: bundle.files.kernal,
    chargen: bundle.files.chargen,
  };

  const results: RomValidationResult[] = [];
  let wroteNewFile = false;

  for (const role of ROM_ROLES) {
    const descriptor = descriptors[role];
    const supplied = suppliedFiles[role] ?? null;
    const result = await ensureFile(bundle.id, descriptor, supplied ?? null);
    if (result.ok && supplied) {
      wroteNewFile = true;
    }
    results.push(result);
  }

  const success = results.every((entry) => entry.ok);
  if (!success && wroteNewFile) {
    await removeRomBundle(bundle.id);
  }
  const error = success
    ? undefined
    : results
        .filter((entry) => !entry.ok)
        .map((entry) => `${entry.fileName}: ${entry.reason ?? 'validation failed'}`)
        .join('; ');

  return {
    bundleId: bundle.id,
    success,
    results,
    error,
  };
}
