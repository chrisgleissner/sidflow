import path from 'node:path';
import { getRepoRoot, getSidflowConfig } from '@/lib/server-env';
import type { SidflowConfig } from '@sidflow/common';
import { getWebPreferences } from '@/lib/preferences-store';

export interface SidCollectionContext {
  config: SidflowConfig;
  repoRoot: string;
  hvscRoot: string;
  collectionRoot: string;
  defaultCollectionRoot: string;
  tagsPath: string;
  audioCachePath: string;
  preferenceSource: 'default' | 'custom';
  kernalRomPath?: string | null;
  basicRomPath?: string | null;
  chargenRomPath?: string | null;
}

function resolvePath(value: string, repoRoot: string): string {
  if (path.isAbsolute(value)) {
    return path.normalize(value);
  }
  return path.resolve(repoRoot, value);
}

export async function resolveSidCollectionContext(): Promise<SidCollectionContext> {
  const config = await getSidflowConfig();
  const repoRoot = getRepoRoot();
  const hvscRoot = resolvePath(config.sidPath, repoRoot);
  const defaultCollectionRoot = path.join(hvscRoot, 'C64Music');

  const prefs = await getWebPreferences();

  const preferencePath = prefs.sidBasePath;
  const collectionRoot =
    preferencePath && preferencePath.trim().length > 0
      ? resolvePath(preferencePath, repoRoot)
      : defaultCollectionRoot;
  const kernalRomPath =
    prefs.kernalRomPath && prefs.kernalRomPath.trim().length > 0
      ? resolvePath(prefs.kernalRomPath, repoRoot)
      : null;
  const basicRomPath =
    prefs.basicRomPath && prefs.basicRomPath.trim().length > 0
      ? resolvePath(prefs.basicRomPath, repoRoot)
      : null;
  const chargenRomPath =
    prefs.chargenRomPath && prefs.chargenRomPath.trim().length > 0
      ? resolvePath(prefs.chargenRomPath, repoRoot)
      : null;

  return {
    config,
    repoRoot,
    hvscRoot,
    collectionRoot,
    defaultCollectionRoot,
    tagsPath: resolvePath(config.tagsPath, repoRoot),
    audioCachePath: resolvePath(config.audioCachePath, repoRoot),
    preferenceSource:
      preferencePath && preferencePath.trim().length > 0 ? 'custom' : 'default',
    kernalRomPath,
    basicRomPath,
    chargenRomPath,
  };
}

export function buildCliEnvOverrides(
  context: SidCollectionContext
): Record<string, string> {
  return {
    SIDFLOW_SID_BASE_PATH: context.collectionRoot,
  };
}
