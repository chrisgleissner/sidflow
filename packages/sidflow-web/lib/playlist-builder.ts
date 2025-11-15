/**
 * Playlist Builder
 * 
 * Builds playlists from local SID collection folder structures with support for:
 * - Single song playback
 * - Non-recursive folder playback (current folder only)
 * - Recursive folder playback (folder + subfolders)
 * - Shuffle mode
 */

import type { HvscBrowseItem, HvscBrowseResponse } from '@/app/api/hvsc/browse/route';

export interface PlaylistOptions {
  recursive: boolean;
  shuffle: boolean;
  maxFiles?: number; // Optional limit to prevent huge playlists
}

export interface PlaylistTrackItem {
  sidPath: string;
  displayName: string;
  songs: number;
}

/**
 * Fetch folder contents from browse API
 */
async function fetchFolderContents(path: string): Promise<HvscBrowseResponse> {
  const params = new URLSearchParams();
  if (path) {
    params.set('path', path);
  }
  const response = await fetch(`/api/hvsc/browse?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch folder: ${response.statusText}`);
  }
  const data: HvscBrowseResponse = await response.json();
  if (!data.success) {
    throw new Error(data.error || 'Browse failed');
  }
  return data;
}

/**
 * Collect all SID files from a folder (non-recursive)
 */
async function collectFilesNonRecursive(folderPath: string): Promise<PlaylistTrackItem[]> {
  const data = await fetchFolderContents(folderPath);
  const files = data.items.filter((item) => item.type === 'file');
  return files.map((file) => ({
    sidPath: file.path,
    displayName: file.name,
    songs: file.songs || 1,
  }));
}

/**
 * Collect all SID files from a folder recursively
 */
async function collectFilesRecursive(
  folderPath: string,
  maxFiles: number = 1000
): Promise<PlaylistTrackItem[]> {
  const result: PlaylistTrackItem[] = [];
  const queue: string[] = [folderPath];
  const visited = new Set<string>();

  while (queue.length > 0 && result.length < maxFiles) {
    const currentPath = queue.shift()!;
    
    // Prevent infinite loops
    if (visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);

    try {
      const data = await fetchFolderContents(currentPath);
      
      // Add files to result
      const files = data.items.filter((item) => item.type === 'file');
      for (const file of files) {
        if (result.length >= maxFiles) {
          break;
        }
        result.push({
          sidPath: file.path,
          displayName: file.name,
          songs: file.songs || 1,
        });
      }

      // Add subfolders to queue
      const folders = data.items.filter((item) => item.type === 'folder');
      for (const folder of folders) {
        queue.push(folder.path);
      }
    } catch (error) {
      console.error(`Failed to fetch folder ${currentPath}:`, error);
      // Continue with other folders
    }
  }

  return result;
}

/**
 * Shuffle an array in place using Fisher-Yates algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Build a playlist from a single SID file
 */
export async function buildSongPlaylist(sidPath: string): Promise<PlaylistTrackItem[]> {
  // Extract display name from path
  const displayName = sidPath.split('/').pop() || sidPath;
  return [
    {
      sidPath,
      displayName,
      songs: 1, // Will be updated when track metadata is fetched
    },
  ];
}

/**
 * Build a playlist from a folder
 */
export async function buildFolderPlaylist(
  folderPath: string,
  options: PlaylistOptions
): Promise<PlaylistTrackItem[]> {
  const { recursive, shuffle, maxFiles = 500 } = options;

  // Collect files
  let files: PlaylistTrackItem[];
  if (recursive) {
    files = await collectFilesRecursive(folderPath, maxFiles);
  } else {
    files = await collectFilesNonRecursive(folderPath);
  }

  // Apply shuffle if requested
  if (shuffle) {
    files = shuffleArray(files);
  }

  return files;
}

/**
 * Get playlist mode description for display
 */
export function getPlaylistModeDescription(
  folderPath: string,
  recursive: boolean,
  shuffle: boolean
): string {
  const folderName = folderPath.split('/').pop() || 'HVSC Root';
  if (shuffle) {
    return `Shuffled: ${folderName}`;
  }
  if (recursive) {
    return `Folder Tree: ${folderName}`;
  }
  return `Folder: ${folderName}`;
}
