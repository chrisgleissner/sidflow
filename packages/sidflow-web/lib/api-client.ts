/**
 * Client-side API functions for making requests to the API routes
 */

import type {
  PlayRequest,
  RateRequest,
  ClassifyRequest,
  FetchRequest,
  TrainRequest,
  RateControlRequest,
  ApiResponse,
} from './validation';
import type { FetchProgressSnapshot } from './types/fetch-progress';
import type { ClassifyProgressSnapshot, ClassifyStorageStats } from './types/classify-progress';
import type { RateTrackInfo, RateTrackMetadata } from './types/rate-track';
import type { PlaybackSessionDescriptor } from './types/playback-session';
import type { RenderTechnology } from '@sidflow/common';

export type { RateTrackInfo, RateTrackMetadata };

export interface RatePlaybackStatus {
  active: boolean;
  isPaused: boolean;
  positionSeconds: number;
  durationSeconds?: number;
  sidPath?: string;
  track?: RateTrackInfo;
}

export interface PreferencesPayload {
  hvscRoot: string;
  defaultCollectionPath: string;
  activeCollectionPath: string;
  preferenceSource: 'default' | 'custom';
  preferences: {
    sidBasePath?: string | null;
    kernalRomPath?: string | null;
    basicRomPath?: string | null;
    chargenRomPath?: string | null;
    sidplayfpCliFlags?: string | null;
    renderEngine?: RenderTechnology;
    preferredEngines?: RenderTechnology[] | null;
  };
  sidplayfpConfig: {
    path: string;
    exists: boolean;
    contents: string;
    kernalRomPath: string | null;
    basicRomPath: string | null;
    chargenRomPath: string | null;
  };
}

export interface FolderListing {
  relativePath: string;
  absolutePath: string;
  entries: Array<{
    name: string;
    path: string;
    hasChildren: boolean;
  }>;
}

const API_BASE = '/api';

async function apiRequest<T>(
  endpoint: string,
  data: unknown
): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  return response.json();
}

export async function playTrack(request: PlayRequest): Promise<ApiResponse<{ output: string }>> {
  return apiRequest('/play', request);
}

export interface RateTrackWithSession {
  track: RateTrackInfo;
  session: PlaybackSessionDescriptor;
}

export async function playManualTrack(request: PlayRequest): Promise<ApiResponse<RateTrackWithSession>> {
  return apiRequest('/play/manual', request);
}

export async function rateTrack(request: RateRequest): Promise<ApiResponse<{ message: string; tagPath?: string }>> {
  return apiRequest('/rate', request);
}

export async function classifyPath(request: ClassifyRequest = {}): Promise<ApiResponse<{ output: string; logs: string; progress: ClassifyProgressSnapshot }>> {
  return apiRequest('/classify', request);
}

export async function getPreferences(): Promise<ApiResponse<PreferencesPayload>> {
  const response = await fetch(`${API_BASE}/prefs`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

export async function updatePreferences(payload: {
  sidBasePath?: string | null;
  kernalRomPath?: string | null;
  basicRomPath?: string | null;
  chargenRomPath?: string | null;
  sidplayfpCliFlags?: string | null;
  renderEngine?: RenderTechnology | null;
  preferredEngines?: RenderTechnology[] | null;
}): Promise<ApiResponse<PreferencesPayload>> {
  return apiRequest('/prefs', payload);
}

export async function listHvscFolders(relative: string = ''): Promise<ApiResponse<FolderListing>> {
  const params = new URLSearchParams();
  if (relative) {
    params.set('relative', relative);
  }
  const response = await fetch(`${API_BASE}/prefs/folders?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

export async function fetchHvsc(request: FetchRequest = {}): Promise<ApiResponse<{ output: string; logs: string; progress: FetchProgressSnapshot }>> {
  return apiRequest('/fetch', request);
}

export async function fetchHvscProgress(): Promise<ApiResponse<FetchProgressSnapshot>> {
  const response = await fetch(`${API_BASE}/fetch/progress`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });
  return response.json();
}

export async function trainModel(request: TrainRequest = {}): Promise<ApiResponse<{ output: string }>> {
  return apiRequest('/train', request);
}

export async function requestRandomPlayTrack(
  preset?: string,
  options: { preview?: boolean } = {}
): Promise<ApiResponse<{ track: RateTrackInfo; session: PlaybackSessionDescriptor | null }>> {
  const response = await fetch(`${API_BASE}/play/random`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...(preset ? { preset } : {}),
      ...(options.preview ? { preview: true } : {}),
    }),
  });
  return response.json();
}

export async function requestRandomRateTrack(): Promise<ApiResponse<RateTrackWithSession>> {
  const response = await fetch(`${API_BASE}/rate/random`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return response.json();
}

export interface StationFromSongRequest {
  sid_path: string;
  limit?: number;
  similarity?: number;
  discovery?: number;
}

export interface StationFromSongResponse {
  seedTrack: RateTrackInfo;
  similarTracks: RateTrackInfo[];
  stationName: string;
}

export async function requestStationFromSong(
  request: StationFromSongRequest
): Promise<ApiResponse<StationFromSongResponse>> {
  const response = await fetch(`${API_BASE}/play/station-from-song`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  return response.json();
}

export interface SidCollectionPathsPayload {
  sidPath: string;
  musicPath: string;
  activeCollectionPath: string;
  preferenceSource: 'default' | 'custom';
}

export async function getSidCollectionPaths(): Promise<ApiResponse<SidCollectionPathsPayload>> {
  const response = await fetch(`${API_BASE}/config/sid`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

export interface AggregateRating {
  sid_path: string;
  community: {
    averageRating: number;
    totalRatings: number;
    likes: number;
    dislikes: number;
    skips: number;
    plays: number;
    dimensions: {
      energy: number;
      mood: number;
      complexity: number;
    };
  };
  trending: {
    score: number;
    recentPlays: number;
    isTrending: boolean;
  };
  personal?: {
    rating: number;
    timestamp: string;
  };
}

export async function getAggregateRating(sidPath: string): Promise<ApiResponse<AggregateRating>> {
  const params = new URLSearchParams({ sid_path: sidPath });
  const response = await fetch(`${API_BASE}/rate/aggregate?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

export type ClassifyProgressWithStorage = ClassifyProgressSnapshot & { storage?: ClassifyStorageStats };

export async function getClassifyProgress(): Promise<ApiResponse<ClassifyProgressWithStorage>> {
  const response = await fetch(`${API_BASE}/classify/progress`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

export async function getRatePlaybackStatus(): Promise<ApiResponse<RatePlaybackStatus>> {
  const response = await fetch(`${API_BASE}/rate/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

export async function controlRatePlayback(request: RateControlRequest): Promise<ApiResponse<{ message: string }>> {
  return apiRequest('/rate/control', request);
}

export async function controlClassification(action: 'pause'): Promise<ApiResponse<{ progress: ClassifyProgressWithStorage }>> {
  return apiRequest('/classify/control', { action });
}

export interface RatingHistoryEntry {
  id: string;
  sidPath: string;
  relativePath: string;
  filename: string;
  ratings: {
    e?: number;
    m?: number;
    c?: number;
    p?: number;
  };
  timestamp?: string;
}

export interface RatingHistoryResponse {
  total: number;
  page: number;
  pageSize: number;
  items: RatingHistoryEntry[];
}

export async function getRatingHistory(params: {
  page?: number;
  pageSize?: number;
  query?: string;
} = {}): Promise<ApiResponse<RatingHistoryResponse>> {
  const searchParams = new URLSearchParams();
  if (params.page) {
    searchParams.set('page', String(params.page));
  }
  if (params.pageSize) {
    searchParams.set('pageSize', String(params.pageSize));
  }
  if (params.query) {
    searchParams.set('query', params.query);
  }
  const response = await fetch(`${API_BASE}/rate/history?${searchParams.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

/**
 * Favorites API
 */

export interface FavoritesResponse {
  favorites: string[];
}

export async function getFavorites(): Promise<ApiResponse<FavoritesResponse>> {
  const response = await fetch(`${API_BASE}/favorites`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

export async function addFavorite(sidPath: string): Promise<ApiResponse<{ favorites: string[]; added: boolean; message?: string }>> {
  const response = await fetch(`${API_BASE}/favorites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ sid_path: sidPath }),
  });
  return response.json();
}

export async function removeFavorite(sidPath: string): Promise<ApiResponse<{ favorites: string[]; removed: boolean }>> {
  const response = await fetch(`${API_BASE}/favorites`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ sid_path: sidPath }),
  });
  return response.json();
}

/**
 * Search API
 */

export interface SearchResult {
  sidPath: string;
  displayName: string;
  artist: string;
  matchedIn: string[];
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  limit: number;
}

export interface SearchFilters {
  yearMin?: number;
  yearMax?: number;
  chipModel?: string;
  sidModel?: string;
  durationMin?: number;
  durationMax?: number;
  minRating?: number;
}

export async function searchTracks(
  query: string,
  limit?: number,
  filters?: SearchFilters
): Promise<ApiResponse<SearchResponse>> {
  const params = new URLSearchParams({ q: query });
  if (limit) {
    params.set('limit', String(limit));
  }
  if (filters) {
    if (filters.yearMin !== undefined) params.set('yearMin', String(filters.yearMin));
    if (filters.yearMax !== undefined) params.set('yearMax', String(filters.yearMax));
    if (filters.chipModel) params.set('chipModel', filters.chipModel);
    if (filters.sidModel) params.set('sidModel', filters.sidModel);
    if (filters.durationMin !== undefined) params.set('durationMin', String(filters.durationMin));
    if (filters.durationMax !== undefined) params.set('durationMax', String(filters.durationMax));
    if (filters.minRating !== undefined) params.set('minRating', String(filters.minRating));
  }
  
  const response = await fetch(`${API_BASE}/search?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

/**
 * Charts API
 */

export interface ChartEntry {
  sidPath: string;
  playCount: number;
  displayName: string;
  artist: string;
}

export interface ChartsResponse {
  range: 'week' | 'month' | 'all';
  charts: ChartEntry[];
}

export async function getCharts(range: 'week' | 'month' | 'all' = 'week', limit?: number): Promise<ApiResponse<ChartsResponse>> {
  const params = new URLSearchParams({ range });
  if (limit) {
    params.set('limit', String(limit));
  }
  
  const response = await fetch(`${API_BASE}/charts?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}
