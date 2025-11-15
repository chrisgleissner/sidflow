import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_BROWSER_PREFERENCES,
  BROWSER_PREFERENCES_VERSION,
  BrowserPreferencesSchema,
  migratePreferences,
} from '@/lib/preferences/schema';

const BASELINE = DEFAULT_BROWSER_PREFERENCES;

describe('BrowserPreferences schema', () => {
  it('parses default preferences', () => {
    const parsed = BrowserPreferencesSchema.parse(BASELINE);
    expect(parsed.version).toBe(BROWSER_PREFERENCES_VERSION);
    expect(parsed.theme).toBeDefined();
    expect(parsed.font).toBeDefined();
  });

  it('migrates empty object to defaults', () => {
    const migrated = migratePreferences({});
    expect(migrated.version).toBe(BROWSER_PREFERENCES_VERSION);
    expect(migrated.theme).toBe(BASELINE.theme);
    expect(migrated.migratedFrom).toBe(0);
  });

  it('migrates v0 legacy fields', () => {
    const migrated = migratePreferences({ theme: 'classic', font: 'c64' });
    expect(migrated.theme).toBe('classic');
    expect(migrated.font).toBe('c64');
    expect(migrated.playbackEngine).toBe(BASELINE.playbackEngine);
  });

  it('migrates v1 payload and clamps invalid values', () => {
    const migrated = migratePreferences({
      version: 1,
      theme: 'c64-dark',
      font: 'mono',
      playbackEngine: 'stream-m4a',
      training: { iterationBudget: 12000, syncCadenceMinutes: 1, enabled: true },
      localCache: { maxEntries: 999, maxBytes: 999999999, preferOffline: true },
    });
    expect(migrated.version).toBe(BROWSER_PREFERENCES_VERSION);
    expect(migrated.playbackEngine).toBe('stream-m4a');
    expect(migrated.training.iterationBudget).toBeLessThanOrEqual(10000);
    expect(migrated.training.syncCadenceMinutes).toBeGreaterThanOrEqual(5);
    expect(migrated.localCache.maxEntries).toBeLessThanOrEqual(500);
    expect(migrated.localCache.maxBytes).toBeLessThanOrEqual(512 * 1024 * 1024);
  });

  it('keeps rom bundle identifier when provided', () => {
    const migrated = migratePreferences({
      version: BROWSER_PREFERENCES_VERSION,
      romBundleId: 'test-bundle',
      theme: 'system',
      font: 'mono',
      playbackEngine: 'wasm',
      ultimate64: null,
      training: BASELINE.training,
      localCache: BASELINE.localCache,
      lastSeenModelVersion: null,
      migratedFrom: null,
    });
    expect(migrated.romBundleId).toBe('test-bundle');
  });

  it('maps legacy stream-mp3 engine to stream-m4a', () => {
    const migrated = migratePreferences({ playbackEngine: 'stream-mp3' });
    expect(migrated.playbackEngine).toBe('stream-m4a');
    expect(migrated.migratedFrom).toBe(0);
  });
});
