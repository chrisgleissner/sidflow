import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getRepoRoot } from '@/lib/server-env';
import type { RenderTechnology } from '@sidflow/common';

const PREFERENCES_FILENAME = '.sidflow-preferences.json';

export interface SchedulerConfig {
  /** Whether the scheduler is enabled */
  enabled: boolean;
  /** Time to run in HH:MM format (e.g., "06:00") */
  time: string;
  /** Timezone (e.g., "UTC", "America/New_York") */
  timezone: string;
}

export interface RenderPreferences {
  /** Whether to preserve WAV files after classification (default: true, disable to save disk space) */
  preserveWav: boolean;
  /** Whether to generate FLAC files during classification */
  enableFlac: boolean;
  /** Whether to generate M4A/AAC files during classification */
  enableM4a: boolean;
}

export interface WebPreferences {
  sidBasePath?: string | null;
  kernalRomPath?: string | null;
  basicRomPath?: string | null;
  chargenRomPath?: string | null;
  sidplayfpCliFlags?: string | null;
  // Preferred server-side render engine for admin operations
  renderEngine?: RenderTechnology;
  preferredEngines?: RenderTechnology[] | null;
  // Default audio formats for classification (wav always included)
  defaultFormats?: string[] | null;
  // Favorites collection (stored as sid_path array)
  favorites?: string[];
  // Nightly scheduler configuration for fetch + classify
  scheduler?: SchedulerConfig;
  // Audio render preferences (preserveWav, enableFlac, enableM4a)
  renderPrefs?: RenderPreferences;
  // Background training toggle
  training?: {
    enabled?: boolean;
  };
}

const DEFAULT_PREFERENCES: WebPreferences = {
  sidBasePath: null,
  kernalRomPath: null,
  basicRomPath: null,
  chargenRomPath: null,
  sidplayfpCliFlags: null,
  renderEngine: 'wasm',
  preferredEngines: null,
  defaultFormats: null,
  favorites: [],
  scheduler: {
    enabled: false,
    time: '06:00',
    timezone: 'UTC',
  },
  renderPrefs: {
    preserveWav: true,
    enableFlac: false,
    enableM4a: false,
  },
  training: {
    enabled: false,
  },
};

function resolvePreferencesPath(): string {
  // Allow override for testing
  if (process.env.SIDFLOW_PREFS_PATH) {
    return process.env.SIDFLOW_PREFS_PATH;
  }
  const repoRoot = getRepoRoot();
  // Store preferences in /data directory which is writable, not in read-only /sidflow root
  return path.join(repoRoot, 'data', PREFERENCES_FILENAME);
}

export function getPreferencesFilePath(): string {
  return resolvePreferencesPath();
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
