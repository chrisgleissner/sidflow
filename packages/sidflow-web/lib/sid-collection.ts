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
  wavCachePath: string;
  preferenceSource: 'default' | 'custom';
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
  const hvscRoot = resolvePath(config.hvscPath, repoRoot);
  const defaultCollectionRoot = path.join(hvscRoot, 'C64Music');
  const prefs = await getWebPreferences();

  const preferencePath = prefs.sidBasePath;
  const collectionRoot =
    preferencePath && preferencePath.trim().length > 0
      ? resolvePath(preferencePath, repoRoot)
      : defaultCollectionRoot;

  return {
    config,
    repoRoot,
    hvscRoot,
    collectionRoot,
    defaultCollectionRoot,
    tagsPath: resolvePath(config.tagsPath, repoRoot),
    wavCachePath: resolvePath(config.wavCachePath, repoRoot),
    preferenceSource:
      preferencePath && preferencePath.trim().length > 0 ? 'custom' : 'default',
  };
}

export function buildCliEnvOverrides(
  context: SidCollectionContext
): NodeJS.ProcessEnv {
  return {
    SIDFLOW_SID_BASE_PATH: context.collectionRoot,
  };
}
