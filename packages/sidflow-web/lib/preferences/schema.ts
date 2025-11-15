import { z } from 'zod';

export const BROWSER_PREFERENCES_VERSION = 2 as const;

export const THEME_OPTIONS = ['system', 'c64-light', 'c64-dark', 'classic'] as const;
export const FONT_OPTIONS = ['c64', 'mono', 'sans'] as const;
export const PLAYBACK_ENGINES = ['wasm', 'sidplayfp-cli', 'stream-wav', 'stream-m4a', 'ultimate64'] as const;

const ultimate64Schema = z
  .object({
    host: z.string().trim().min(1, 'Host is required'),
    https: z.boolean().default(false),
    secretHeader: z.string().trim().min(1).optional(),
  })
  .strict();

const trainingSchema = z
  .object({
    enabled: z.boolean().default(false),
    iterationBudget: z.number().int().min(1).max(10000).default(200),
    syncCadenceMinutes: z.number().int().min(5).max(1440).default(60),
    allowUpload: z.boolean().default(false),
  })
  .strict();

const localCacheSchema = z
  .object({
    maxEntries: z.number().int().min(0).max(500).default(25),
    maxBytes: z.number().int().min(0).max(512 * 1024 * 1024).default(32 * 1024 * 1024),
    preferOffline: z.boolean().default(false),
  })
  .strict();

export const BrowserPreferencesSchema = z
  .object({
    version: z.literal(BROWSER_PREFERENCES_VERSION),
    migratedFrom: z.number().int().min(0).nullable().default(null),
    theme: z.enum(THEME_OPTIONS).default('system'),
    font: z.enum(FONT_OPTIONS).default('mono'),
    romBundleId: z.string().min(1).nullable().default(null),
    playbackEngine: z.enum(PLAYBACK_ENGINES).default('wasm'),
    ultimate64: ultimate64Schema.nullable().default(null),
    training: trainingSchema.default(trainingSchema.parse({})),
    localCache: localCacheSchema.default(localCacheSchema.parse({})),
    lastSeenModelVersion: z.string().trim().min(1).nullable().default(null),
  })
  .strict();

export type BrowserPreferences = z.infer<typeof BrowserPreferencesSchema>;

export const DEFAULT_BROWSER_PREFERENCES: BrowserPreferences = BrowserPreferencesSchema.parse({
  version: BROWSER_PREFERENCES_VERSION,
});

type LegacyPreferencesV0 = {
  theme?: string;
  font?: string;
};

type LegacyPlaybackEngine = (typeof PLAYBACK_ENGINES)[number] | 'stream-mp3';

type LegacyPreferencesV1 = LegacyPreferencesV0 & {
  version: 1;
  romBundleId?: string | null;
  playbackEngine?: LegacyPlaybackEngine;
  ultimate64?: Partial<z.infer<typeof ultimate64Schema>> | null;
  training?: Partial<z.infer<typeof trainingSchema>>;
  localCache?: Partial<z.infer<typeof localCacheSchema>>;
  lastSeenModelVersion?: string | null;
};

function coerceTheme(value: unknown): BrowserPreferences['theme'] {
  return THEME_OPTIONS.includes(value as BrowserPreferences['theme'])
    ? (value as BrowserPreferences['theme'])
    : DEFAULT_BROWSER_PREFERENCES.theme;
}

function coerceFont(value: unknown): BrowserPreferences['font'] {
  return FONT_OPTIONS.includes(value as BrowserPreferences['font'])
    ? (value as BrowserPreferences['font'])
    : DEFAULT_BROWSER_PREFERENCES.font;
}

function coercePlaybackEngine(value: unknown): BrowserPreferences['playbackEngine'] {
  if (value === 'stream-mp3') {
    return 'stream-m4a';
  }
  return PLAYBACK_ENGINES.includes(value as BrowserPreferences['playbackEngine'])
    ? (value as BrowserPreferences['playbackEngine'])
    : DEFAULT_BROWSER_PREFERENCES.playbackEngine;
}

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function migratePreferences(raw: unknown): BrowserPreferences {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_BROWSER_PREFERENCES, migratedFrom: null };
  }

  const candidate = raw as Partial<BrowserPreferences> & Partial<LegacyPreferencesV1>;
  let version = 0;
  if (typeof candidate.version === 'number') {
    version = candidate.version;
  }

  if (version === BROWSER_PREFERENCES_VERSION) {
    const parsed = BrowserPreferencesSchema.safeParse(candidate);
    if (parsed.success) {
      return parsed.data;
    }
  }

  const base: BrowserPreferences = {
    ...DEFAULT_BROWSER_PREFERENCES,
    theme: coerceTheme((candidate as LegacyPreferencesV0).theme),
    font: coerceFont((candidate as LegacyPreferencesV0).font),
    romBundleId: coerceNullableString(candidate.romBundleId ?? null),
    playbackEngine: coercePlaybackEngine(candidate.playbackEngine),
    ultimate64: candidate.ultimate64
      ? {
          host: coerceNullableString(candidate.ultimate64.host) ?? DEFAULT_BROWSER_PREFERENCES.ultimate64?.host ?? 'localhost',
          https: Boolean(candidate.ultimate64.https),
          secretHeader: coerceNullableString(candidate.ultimate64.secretHeader ?? null) ?? undefined,
        }
      : null,
    training: {
      ...DEFAULT_BROWSER_PREFERENCES.training,
      ...candidate.training,
      enabled: Boolean(candidate.training?.enabled ?? DEFAULT_BROWSER_PREFERENCES.training.enabled),
      iterationBudget:
        typeof candidate.training?.iterationBudget === 'number'
          ? Math.min(Math.max(candidate.training.iterationBudget, 1), 10000)
          : DEFAULT_BROWSER_PREFERENCES.training.iterationBudget,
      syncCadenceMinutes:
        typeof candidate.training?.syncCadenceMinutes === 'number'
          ? Math.min(Math.max(candidate.training.syncCadenceMinutes, 5), 1440)
          : DEFAULT_BROWSER_PREFERENCES.training.syncCadenceMinutes,
      allowUpload: Boolean(candidate.training?.allowUpload ?? DEFAULT_BROWSER_PREFERENCES.training.allowUpload),
    },
    localCache: {
      ...DEFAULT_BROWSER_PREFERENCES.localCache,
      ...candidate.localCache,
      maxEntries:
        typeof candidate.localCache?.maxEntries === 'number'
          ? Math.min(Math.max(candidate.localCache.maxEntries, 0), 500)
          : DEFAULT_BROWSER_PREFERENCES.localCache.maxEntries,
      maxBytes:
        typeof candidate.localCache?.maxBytes === 'number'
          ? Math.min(Math.max(candidate.localCache.maxBytes, 0), 512 * 1024 * 1024)
          : DEFAULT_BROWSER_PREFERENCES.localCache.maxBytes,
      preferOffline: Boolean(
        candidate.localCache?.preferOffline ?? DEFAULT_BROWSER_PREFERENCES.localCache.preferOffline
      ),
    },
    lastSeenModelVersion: coerceNullableString(candidate.lastSeenModelVersion ?? null),
    migratedFrom: version,
  };

  return base;
}
