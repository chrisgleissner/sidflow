/**
 * Playback history management using localStorage
 * Stores the last 100 played tracks in a circular buffer
 */

export interface PlaybackHistoryEntry {
  sidPath: string;
  displayName: string;
  timestamp: number;
  metadata?: {
    author?: string;
    released?: string;
    length?: string;
  };
}

const HISTORY_KEY = 'sidflow-playback-history';
const MAX_HISTORY_SIZE = 100;

/**
 * Get playback history from localStorage
 */
export function getPlaybackHistory(): PlaybackHistoryEntry[] {
  if (typeof window === 'undefined') {
    return [];
  }
  
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) {
      return [];
    }
    
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load playback history:', error);
    return [];
  }
}

/**
 * Add a track to playback history
 * Maintains circular buffer of MAX_HISTORY_SIZE entries
 */
export function addToPlaybackHistory(entry: Omit<PlaybackHistoryEntry, 'timestamp'>): void {
  if (typeof window === 'undefined') {
    return;
  }
  
  try {
    const history = getPlaybackHistory();
    
    // Add timestamp
    const newEntry: PlaybackHistoryEntry = {
      ...entry,
      timestamp: Date.now(),
    };
    
    // Remove duplicates of the same track (keep most recent)
    const filtered = history.filter(h => h.sidPath !== entry.sidPath);
    
    // Add new entry at the beginning
    const updated = [newEntry, ...filtered];
    
    // Limit to MAX_HISTORY_SIZE
    const trimmed = updated.slice(0, MAX_HISTORY_SIZE);
    
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error('Failed to add to playback history:', error);
  }
}

/**
 * Clear all playback history
 */
export function clearPlaybackHistory(): void {
  if (typeof window === 'undefined') {
    return;
  }
  
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (error) {
    console.error('Failed to clear playback history:', error);
  }
}

/**
 * Get recent playback history (last N entries)
 */
export function getRecentHistory(limit: number = 20): PlaybackHistoryEntry[] {
  const history = getPlaybackHistory();
  return history.slice(0, limit);
}

/**
 * Remove a specific entry from history
 */
export function removeFromHistory(sidPath: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  
  try {
    const history = getPlaybackHistory();
    const filtered = history.filter(h => h.sidPath !== sidPath);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to remove from history:', error);
  }
}

/**
 * Check if a track is in history
 */
export function isInHistory(sidPath: string): boolean {
  const history = getPlaybackHistory();
  return history.some(h => h.sidPath === sidPath);
}

/**
 * Get history count
 */
export function getHistoryCount(): number {
  const history = getPlaybackHistory();
  return history.length;
}
