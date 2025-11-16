/**
 * Personal rating storage using browser localStorage.
 * Stores user's ratings without requiring server-side authentication.
 */

export interface PersonalRating {
  rating: number; // 1-5
  timestamp: string;
  dimensions?: {
    e?: number;
    m?: number;
    c?: number;
  };
}

const STORAGE_KEY = 'sidflow-personal-ratings';

/**
 * Gets all personal ratings from localStorage.
 */
function getAllRatings(): Record<string, PersonalRating> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {};
    }
    return JSON.parse(stored) as Record<string, PersonalRating>;
  } catch (error) {
    console.error('[personal-ratings] Failed to load ratings:', error);
    return {};
  }
}

/**
 * Saves all ratings to localStorage.
 */
function saveAllRatings(ratings: Record<string, PersonalRating>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
  } catch (error) {
    console.error('[personal-ratings] Failed to save ratings:', error);
  }
}

/**
 * Gets the personal rating for a specific track.
 */
export function getPersonalRating(sidPath: string): PersonalRating | null {
  const ratings = getAllRatings();
  return ratings[sidPath] ?? null;
}

/**
 * Sets the personal rating for a specific track.
 */
export function setPersonalRating(
  sidPath: string,
  rating: number,
  dimensions?: { e?: number; m?: number; c?: number }
): void {
  const ratings = getAllRatings();
  ratings[sidPath] = {
    rating,
    timestamp: new Date().toISOString(),
    dimensions,
  };
  saveAllRatings(ratings);
}

/**
 * Removes the personal rating for a specific track.
 */
export function removePersonalRating(sidPath: string): void {
  const ratings = getAllRatings();
  delete ratings[sidPath];
  saveAllRatings(ratings);
}

/**
 * Gets all tracks that have been rated.
 */
export function getAllRatedTracks(): Array<{ sidPath: string; rating: PersonalRating }> {
  const ratings = getAllRatings();
  return Object.entries(ratings).map(([sidPath, rating]) => ({ sidPath, rating }));
}

/**
 * Clears all personal ratings.
 */
export function clearAllRatings(): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}
