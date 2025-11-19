/**
 * Playlist storage using JSON file persistence
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ensureDir } from '@sidflow/common';
import type {
  Playlist,
  PlaylistTrackItem,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
} from '@/lib/types/playlist';

const PLAYLISTS_DIR = process.env.SIDFLOW_PLAYLISTS_PATH || join(process.cwd(), 'data', 'playlists');

async function getPlaylistsPath(): Promise<string> {
  await ensureDir(PLAYLISTS_DIR);
  return PLAYLISTS_DIR;
}

function getPlaylistFilePath(playlistsPath: string, id: string): string {
  return join(playlistsPath, `${id}.json`);
}

function calculateTotalDuration(tracks: PlaylistTrackItem[]): number | undefined {
  const durations = tracks.map((t) => t.lengthSeconds).filter((d): d is number => d !== undefined);
  return durations.length > 0 ? durations.reduce((sum, d) => sum + d, 0) : undefined;
}

/**
 * List all playlists
 */
export async function listPlaylists(): Promise<Playlist[]> {
  const playlistsPath = await getPlaylistsPath();

  try {
    const files = await fs.readdir(playlistsPath);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    const playlists: Playlist[] = [];
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(join(playlistsPath, file), 'utf-8');
        const playlist = JSON.parse(content) as Playlist;
        playlists.push(playlist);
      } catch (err) {
        console.warn(`[Playlist] Failed to read ${file}:`, err);
      }
    }

    // Sort by updatedAt descending (most recent first)
    return playlists.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Get a single playlist by ID
 */
export async function getPlaylist(id: string): Promise<Playlist | null> {
  const playlistsPath = await getPlaylistsPath();
  const filePath = getPlaylistFilePath(playlistsPath, id);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as Playlist;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Create a new playlist
 */
export async function createPlaylist(request: CreatePlaylistRequest): Promise<Playlist> {
  const playlistsPath = await getPlaylistsPath();
  const id = uuidv4();
  const now = new Date().toISOString();

  // Assign order to tracks
  const tracks: PlaylistTrackItem[] = request.tracks.map((track, index) => ({
    ...track,
    order: index,
  }));

  const playlist: Playlist = {
    id,
    name: request.name,
    description: request.description,
    tracks,
    createdAt: now,
    updatedAt: now,
    trackCount: tracks.length,
    totalDuration: calculateTotalDuration(tracks),
  };

  const filePath = getPlaylistFilePath(playlistsPath, id);
  await fs.writeFile(filePath, JSON.stringify(playlist, null, 2), 'utf-8');

  return playlist;
}

/**
 * Update an existing playlist
 */
export async function updatePlaylist(id: string, request: UpdatePlaylistRequest): Promise<Playlist | null> {
  const existing = await getPlaylist(id);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();

  // Update tracks if provided, re-assigning order
  let tracks = existing.tracks;
  if (request.tracks) {
    tracks = request.tracks.map((track, index) => ({
      ...track,
      order: index,
    }));
  }

  const updated: Playlist = {
    ...existing,
    name: request.name ?? existing.name,
    description: request.description ?? existing.description,
    tracks,
    updatedAt: now,
    trackCount: tracks.length,
    totalDuration: calculateTotalDuration(tracks),
  };

  const playlistsPath = await getPlaylistsPath();
  const filePath = getPlaylistFilePath(playlistsPath, id);
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');

  return updated;
}

/**
 * Delete a playlist
 */
export async function deletePlaylist(id: string): Promise<boolean> {
  const playlistsPath = await getPlaylistsPath();
  const filePath = getPlaylistFilePath(playlistsPath, id);

  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Reorder tracks within a playlist
 */
export async function reorderPlaylistTracks(
  id: string,
  trackOrder: string[] // Array of sidPaths in new order
): Promise<Playlist | null> {
  const existing = await getPlaylist(id);
  if (!existing) {
    return null;
  }

  // Create a map of sidPath to track
  const trackMap = new Map(existing.tracks.map((t) => [t.sidPath, t]));

  // Build new tracks array in specified order
  const reorderedTracks: PlaylistTrackItem[] = [];
  for (let i = 0; i < trackOrder.length; i++) {
    const sidPath = trackOrder[i];
    const track = trackMap.get(sidPath);
    if (track) {
      reorderedTracks.push({
        ...track,
        order: i,
      });
    }
  }

  // Update the playlist
  return updatePlaylist(id, { tracks: reorderedTracks });
}
