/**
 * Utility functions for extracting and formatting SID metadata
 */

export interface SidMetadata {
  title?: string;
  artist?: string;
  year?: string;
  length?: string;
  format?: string;
  version?: string;
  songs?: number;
  startSong?: number;
  sidModel?: string;
  clockSpeed?: string;
}

/**
 * Extract simulated metadata from a SID file path
 * In production, this would parse the actual .sid file binary format
 * 
 * @param sidPath - Path to the SID file
 * @param duration - Duration in seconds (default: 180)
 * @returns SID metadata object
 */
export function extractSidMetadata(sidPath: string, duration: number = 180): SidMetadata {
  const filename = sidPath.split('/').pop() || sidPath;
  const parts = sidPath.split('/');
  const artist = parts.length >= 3 
    ? parts[parts.length - 2].replace(/_/g, ' ') 
    : 'Unknown Artist';
  
  return {
    title: filename.replace('.sid', '').replace(/_/g, ' '),
    artist: artist,
    year: '1984',
    length: formatTime(duration),
    format: 'PSID v2',
    version: '2',
    songs: 3,
    startSong: 1,
    sidModel: '6581',
    clockSpeed: 'PAL (50Hz)',
  };
}

/**
 * Format seconds as MM:SS
 * 
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Simulated upcoming songs queue
 * In production, this would query the actual playlist or recommendation engine
 */
export interface UpcomingSong {
  title: string;
  artist: string;
  year: string;
  length: string;
}

export function getUpcomingSongs(): UpcomingSong[] {
  return [
    {
      title: 'Last Ninja 2',
      artist: 'Matt Gray',
      year: '1988',
      length: '3:45',
    },
    {
      title: 'International Karate',
      artist: 'Rob Hubbard',
      year: '1986',
      length: '2:30',
    },
    {
      title: 'Monty on the Run',
      artist: 'Rob Hubbard',
      year: '1985',
      length: '4:12',
    },
  ];
}
