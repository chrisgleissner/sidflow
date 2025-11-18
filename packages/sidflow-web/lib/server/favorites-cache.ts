import { stat } from 'node:fs/promises';
import { getPreferencesFilePath, getWebPreferences, updateWebPreferences } from '@/lib/preferences-store';

interface FavoritesCacheEntry {
  favorites: string[];
  timestamp: number;
  mtimeMs: number;
}

const CACHE_TTL_MS = Number(process.env.SIDFLOW_FAVORITES_CACHE_TTL_MS ?? 15_000);
let cache: FavoritesCacheEntry | null = null;

async function getPreferencesMtime(): Promise<number> {
  try {
    const stats = await stat(getPreferencesFilePath());
    return stats.mtimeMs;
  } catch {
    return Date.now();
  }
}

async function loadFavorites(): Promise<string[]> {
  const prefs = await getWebPreferences();
  const mtimeMs = await getPreferencesMtime();
  cache = {
    favorites: prefs.favorites ?? [],
    timestamp: Date.now(),
    mtimeMs,
  };
  return cache.favorites;
}

export async function getCachedFavorites(): Promise<string[]> {
  if (!cache || CACHE_TTL_MS === 0) {
    return loadFavorites();
  }
  const age = Date.now() - cache.timestamp;
  if (age < CACHE_TTL_MS) {
    const latestMtime = await getPreferencesMtime();
    if (latestMtime <= cache.mtimeMs) {
      return cache.favorites;
    }
  }

  return loadFavorites();
}

export async function addFavorite(sidPath: string): Promise<{ favorites: string[]; added: boolean }> {
  const current = await getCachedFavorites();
  if (current.includes(sidPath)) {
    return { favorites: current, added: false };
  }
  const updated = [...current, sidPath];
  await updateWebPreferences({ favorites: updated });
  cache = { favorites: updated, timestamp: Date.now(), mtimeMs: await getPreferencesMtime() };
  return { favorites: updated, added: true };
}

export async function removeFavorite(sidPath: string): Promise<{ favorites: string[]; removed: boolean }> {
  const current = await getCachedFavorites();
  const filtered = current.filter((entry) => entry !== sidPath);
  const removed = filtered.length !== current.length;
  if (removed) {
    await updateWebPreferences({ favorites: filtered });
    cache = { favorites: filtered, timestamp: Date.now(), mtimeMs: await getPreferencesMtime() };
  }
  return { favorites: filtered, removed };
}

export function resetFavoritesCache(): void {
  cache = null;
}
