import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, type SidflowConfig } from '@sidflow/common';

let cachedRoot: string | null = null;
let cachedConfigPath: string | null = null;
let cachedConfig: SidflowConfig | null = null;

export function getRepoRoot(): string {
  if (cachedRoot) {
    return cachedRoot;
  }

  if (process.env.SIDFLOW_ROOT) {
    cachedRoot = process.env.SIDFLOW_ROOT;
    return cachedRoot;
  }

  let currentDir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(currentDir, '.sidflow.json'))) {
      cachedRoot = currentDir;
      return currentDir;
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  const configFromEnv = process.env.SIDFLOW_CONFIG;
  if (configFromEnv) {
    const resolvedConfig = path.isAbsolute(configFromEnv)
      ? configFromEnv
      : path.resolve(configFromEnv);
    cachedRoot = path.dirname(resolvedConfig);
    return cachedRoot;
  }

  cachedRoot = process.cwd();
  return cachedRoot;
}

export function resolveFromRepoRoot(...segments: string[]): string {
  return path.resolve(getRepoRoot(), ...segments);
}

export function resolveConfigPath(explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }

  const root = getRepoRoot();
  const configFile = (process.env.SIDFLOW_CONFIG ?? '.sidflow.json').trim();

  if (configFile.length === 0) {
    return path.resolve(root, '.sidflow.json');
  }

  return path.isAbsolute(configFile) ? configFile : path.resolve(root, configFile);
}

export async function getSidflowConfig(configPath?: string): Promise<SidflowConfig> {
  const resolvedPath = resolveConfigPath(configPath);

  if (cachedConfig && cachedConfigPath === resolvedPath) {
    return cachedConfig;
  }

  const config = await loadConfig(resolvedPath);
  cachedConfig = config;
  cachedConfigPath = resolvedPath;
  return config;
}

export function resetServerEnvCacheForTests(): void {
  cachedRoot = null;
  cachedConfig = null;
  cachedConfigPath = null;
}
