/**
 * Playlist types for SIDFlow
 */

export interface PlaylistTrackItem {
    sidPath: string;
    title?: string;
    artist?: string;
    year?: number;
    game?: string;
    lengthSeconds?: number;
    order: number; // Position in playlist (0-indexed)
}

export interface Playlist {
    id: string; // UUID
    name: string;
    description?: string;
    tracks: PlaylistTrackItem[];
    createdAt: string; // ISO timestamp
    updatedAt: string; // ISO timestamp
    trackCount: number;
    totalDuration?: number; // Total seconds
}

export interface CreatePlaylistRequest {
    name: string;
    description?: string;
    tracks: Omit<PlaylistTrackItem, 'order'>[];
}

export interface UpdatePlaylistRequest {
    name?: string;
    description?: string;
    tracks?: Omit<PlaylistTrackItem, 'order'>[];
}

export interface PlaylistsResponse {
    playlists: Playlist[];
    total: number;
}

export interface PlaylistResponse {
    playlist: Playlist;
}

export interface PlaylistErrorResponse {
    error: string;
    details?: string;
}
