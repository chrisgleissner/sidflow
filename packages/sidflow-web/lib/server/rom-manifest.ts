import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { pathExists, stringifyDeterministic } from '@sidflow/common';
import type { RomManifest, RomManifestBundle, RomManifestFile, SupportedChip } from '@/lib/preferences/types';
import { resolveFromRepoRoot } from '@/lib/server-env';

interface InternalRomFile extends RomManifestFile {
  absolutePath: string;
  role: 'basic' | 'kernal' | 'chargen';
}

interface InternalRomBundle extends Omit<RomManifestBundle, 'files'> {
  files: {
    basic: InternalRomFile;
    kernal: InternalRomFile;
    chargen: InternalRomFile;
  };
}

interface BundleConfigFile {
  id?: string;
  label?: string;
  description?: string;
  defaultChip?: SupportedChip;
  kind?: 'curated' | 'manual';
  files?: Partial<Record<'basic' | 'kernal' | 'chargen', string>>;
}

const DEFAULT_BUNDLE_FILES: Record<'basic' | 'kernal' | 'chargen', string> = {
  basic: 'basic.rom',
  kernal: 'kernal.rom',
  chargen: 'chargen.rom',
};

const ROM_BUNDLE_ROOT = resolveFromRepoRoot('workspace', 'roms');

function formatLabel(dirName: string): string {
  return dirName
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

async function readBundleConfig(bundleDir: string): Promise<BundleConfigFile | null> {
  const descriptorPath = path.join(bundleDir, 'bundle.json');
  if (!(await pathExists(descriptorPath))) {
    return null;
  }
  try {
    const raw = await fs.readFile(descriptorPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Bundle descriptor must be an object');
    }
    return parsed as BundleConfigFile;
  } catch (error) {
    console.warn('[rom-manifest] Failed to parse bundle descriptor', descriptorPath, error);
    return null;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

async function buildRomFile(bundleDir: string, role: 'basic' | 'kernal' | 'chargen', fileName: string): Promise<InternalRomFile | null> {
  const absolutePath = path.join(bundleDir, fileName);
  let stats: Stats;
  try {
    stats = await fs.stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[rom-manifest] Unable to stat ROM file', absolutePath, error);
    }
    return null;
  }
  if (!stats.isFile()) {
    return null;
  }
  const sha256 = await hashFile(absolutePath);
  const descriptor: InternalRomFile = {
    role,
    fileName,
    size: stats.size,
    sha256,
    modifiedAt: stats.mtime.toISOString(),
    absolutePath,
  };
  return descriptor;
}

async function collectRomBundles(): Promise<InternalRomBundle[]> {
  if (!(await pathExists(ROM_BUNDLE_ROOT))) {
    return [];
  }

  const dirEntries = (await fs.readdir(ROM_BUNDLE_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const bundles: InternalRomBundle[] = [];

  for (const entry of dirEntries) {
    const bundleDir = path.join(ROM_BUNDLE_ROOT, entry.name);
    const config = await readBundleConfig(bundleDir);

    const fileNames = {
      basic: config?.files?.basic ?? DEFAULT_BUNDLE_FILES.basic,
      kernal: config?.files?.kernal ?? DEFAULT_BUNDLE_FILES.kernal,
      chargen: config?.files?.chargen ?? DEFAULT_BUNDLE_FILES.chargen,
    } as Record<'basic' | 'kernal' | 'chargen', string>;

    const files = await Promise.all([
      buildRomFile(bundleDir, 'basic', fileNames.basic),
      buildRomFile(bundleDir, 'kernal', fileNames.kernal),
      buildRomFile(bundleDir, 'chargen', fileNames.chargen),
    ]);

    if (files.some((file) => file === null)) {
      console.warn('[rom-manifest] Skipping bundle due to missing files', bundleDir);
      continue;
    }

    const typedFiles = files as [InternalRomFile, InternalRomFile, InternalRomFile];
    const updatedAtEpoch = Math.max(
      Date.parse(typedFiles[0].modifiedAt),
      Date.parse(typedFiles[1].modifiedAt),
      Date.parse(typedFiles[2].modifiedAt)
    );

    const bundle: InternalRomBundle = {
      id: config?.id ?? entry.name,
      label: config?.label ?? formatLabel(entry.name),
      description: config?.description,
      defaultChip: coerceChip(config?.defaultChip),
      kind: coerceKind(config?.kind),
      updatedAt: new Date(updatedAtEpoch).toISOString(),
      files: {
        basic: typedFiles[0],
        kernal: typedFiles[1],
        chargen: typedFiles[2],
      },
    };

    bundles.push(bundle);
  }

  return bundles;
}

function publicBundle(bundle: InternalRomBundle): RomManifestBundle {
  return {
    id: bundle.id,
    label: bundle.label,
    description: bundle.description,
    defaultChip: bundle.defaultChip,
    kind: bundle.kind,
    updatedAt: bundle.updatedAt,
    files: {
      basic: stripInternalFields(bundle.files.basic),
      kernal: stripInternalFields(bundle.files.kernal),
      chargen: stripInternalFields(bundle.files.chargen),
    },
  };
}

function stripInternalFields(file: InternalRomFile): RomManifestFile {
  const { fileName, size, sha256, modifiedAt } = file;
  return { fileName, size, sha256, modifiedAt };
}

function computeManifestVersion(bundles: InternalRomBundle[]): string {
  const core = bundles.map((bundle) => ({
    id: bundle.id,
    updatedAt: bundle.updatedAt,
    files: {
      basic: { sha256: bundle.files.basic.sha256, size: bundle.files.basic.size },
      kernal: { sha256: bundle.files.kernal.sha256, size: bundle.files.kernal.size },
      chargen: { sha256: bundle.files.chargen.sha256, size: bundle.files.chargen.size },
    },
  }));
  const payload = stringifyDeterministic(core, 0);
  return createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

function shouldAllowManualSelection(): boolean {
  if (process.env.SIDFLOW_ALLOW_MANUAL_ROM === '0') {
    return false;
  }
  if (process.env.SIDFLOW_ALLOW_MANUAL_ROM === '1') {
    return true;
  }
  return true;
}

function coerceChip(value: unknown): SupportedChip {
  return value === '8580r5' ? '8580r5' : '6581';
}

function coerceKind(value: unknown): 'curated' | 'manual' {
  return value === 'manual' ? 'manual' : 'curated';
}

export async function loadRomManifest(): Promise<RomManifest> {
  const bundles = await collectRomBundles();
  const manifest: RomManifest = {
    version: computeManifestVersion(bundles),
    generatedAt: new Date().toISOString(),
    bundles: bundles.map(publicBundle),
    allowManualSelection: shouldAllowManualSelection(),
  };
  return manifest;
}

export async function resolveCuratedRomFile(
  bundleId: string,
  fileName: string
): Promise<InternalRomFile | null> {
  const sanitizedBundleId = path.basename(bundleId);
  if (sanitizedBundleId !== bundleId) {
    return null;
  }

  const sanitizedFileName = path.basename(fileName);
  if (sanitizedFileName !== fileName) {
    return null;
  }

  const bundles = await collectRomBundles();
  const matched = bundles.find((bundle) => bundle.id === sanitizedBundleId);
  if (!matched) {
    return null;
  }

  const candidates = [matched.files.basic, matched.files.kernal, matched.files.chargen];
  return candidates.find((file) => file.fileName === sanitizedFileName) ?? null;
}

export { ROM_BUNDLE_ROOT };