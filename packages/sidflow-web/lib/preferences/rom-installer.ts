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

async function fetchRomFile(bundleId: string, file: RomManifestFile): Promise<ArrayBuffer> {
  const response = await fetch(`/api/playback/rom/${encodeURIComponent(bundleId)}/${encodeURIComponent(file.fileName)}`);
  if (!response.ok) {
    throw new Error(`Failed to download ${file.fileName} (HTTP ${response.status})`);
  }
  return await response.arrayBuffer();
}

async function ensureFile(
  bundleId: string,
  descriptor: RomManifestFile
): Promise<RomValidationResult> {
  const cached = await loadRomBundleFile(bundleId, descriptor.fileName);
  if (cached && cached.hash === descriptor.sha256 && cached.bytes.byteLength === descriptor.size) {
    return { bundleId, fileName: descriptor.fileName, ok: true };
  }

  const bytes = await fetchRomFile(bundleId, descriptor);
  const hash = await computeSha256(bytes);
  if (hash !== descriptor.sha256) {
    throw new Error(
      `${descriptor.fileName} hash mismatch (expected ${descriptor.sha256.slice(0, 12)}, got ${hash.slice(0, 12)})`
    );
  }
  if (bytes.byteLength !== descriptor.size) {
    throw new Error(
      `${descriptor.fileName} size mismatch (expected ${descriptor.size}, got ${bytes.byteLength})`
    );
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

export async function installRomBundle(bundle: RomManifestBundle): Promise<BundleInstallResult> {
  const results: RomValidationResult[] = [];
  try {
    for (const descriptor of [bundle.files.basic, bundle.files.kernal, bundle.files.chargen]) {
      const result = await ensureFile(bundle.id, descriptor);
      results.push(result);
    }
    return { bundleId: bundle.id, success: true, results };
  } catch (error) {
    console.warn('[installRomBundle] validation failed, clearing bundle cache', error);
    await removeRomBundle(bundle.id);
    return {
      bundleId: bundle.id,
      success: false,
      results,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
