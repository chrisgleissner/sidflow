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
  };
  sidplayfpConfig: {
    path: string;
    exists: boolean;
    contents: string;
    kernalRomPath: string | null;
    basicRomPath: string | null;
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

export async function playManualTrack(request: PlayRequest): Promise<ApiResponse<{ track: RateTrackInfo }>> {
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

export async function requestRandomPlayTrack(preset?: string): Promise<ApiResponse<{ track: RateTrackInfo }>> {
  const response = await fetch(`${API_BASE}/play/random`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(preset ? { preset } : {}),
  });
  return response.json();
}

export async function requestRandomRateTrack(): Promise<ApiResponse<{ track: RateTrackInfo }>> {
  const response = await fetch(`${API_BASE}/rate/random`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return response.json();
}

export interface HvscPathsPayload {
  hvscPath: string;
  musicPath: string;
  activeCollectionPath: string;
  preferenceSource: 'default' | 'custom';
}

export async function getHvscPaths(): Promise<ApiResponse<HvscPathsPayload>> {
  const response = await fetch(`${API_BASE}/config/hvsc`, {
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
