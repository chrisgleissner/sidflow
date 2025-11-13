import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getRepoRoot } from '@/lib/server-env';

const PREFERENCES_FILENAME = '.sidflow-preferences.json';

export interface WebPreferences {
  sidBasePath?: string | null;
  kernalRomPath?: string | null;
  basicRomPath?: string | null;
  chargenRomPath?: string | null;
  sidplayfpCliFlags?: string | null;
}

const DEFAULT_PREFERENCES: WebPreferences = {
  sidBasePath: null,
  kernalRomPath: null,
  basicRomPath: null,
  chargenRomPath: null,
  sidplayfpCliFlags: null,
};

function resolvePreferencesPath(): string {
  const repoRoot = getRepoRoot();
  return path.join(repoRoot, PREFERENCES_FILENAME);
}

async function readPreferencesFile(): Promise<WebPreferences | null> {
  try {
    const filePath = resolvePreferencesPath();
    const contents = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(contents) as WebPreferences;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writePreferencesFile(preferences: WebPreferences): Promise<void> {
  const filePath = resolvePreferencesPath();
  await fs.writeFile(filePath, JSON.stringify(preferences, null, 2), 'utf8');
}

export async function getWebPreferences(): Promise<WebPreferences> {
  const stored = await readPreferencesFile();
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
  };
}

export async function updateWebPreferences(
  update: Partial<WebPreferences>
): Promise<WebPreferences> {
  const current = await getWebPreferences();
  const next = {
    ...current,
    ...update,
  };
  await writePreferencesFile(next);
  return next;
}
