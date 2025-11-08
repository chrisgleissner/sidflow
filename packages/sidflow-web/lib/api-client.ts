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
import type { ClassifyProgressSnapshot } from './types/classify-progress';

export interface RateTrackMetadata {
  title?: string;
  author?: string;
  released?: string;
  songs: number;
  startSong: number;
  sidType: string;
  version: number;
  sidModel: string;
  sidModelSecondary?: string;
  sidModelTertiary?: string;
  clock: string;
  length?: string;
  fileSizeBytes: number;
}

export interface RateTrackInfo {
  sidPath: string;
  relativePath: string;
  filename: string;
  displayName: string;
  selectedSong: number;
  metadata: RateTrackMetadata;
  durationSeconds: number;
}

export interface RatePlaybackStatus {
  active: boolean;
  isPaused: boolean;
  positionSeconds: number;
  durationSeconds?: number;
  sidPath?: string;
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

export async function rateTrack(request: RateRequest): Promise<ApiResponse<{ message: string; tagPath?: string }>> {
  return apiRequest('/rate', request);
}

export async function classifyPath(request: ClassifyRequest = {}): Promise<ApiResponse<{ output: string; logs: string; progress: ClassifyProgressSnapshot }>> {
  return apiRequest('/classify', request);
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

export async function getHvscPaths(): Promise<ApiResponse<{ hvscPath: string; musicPath: string }>> {
  const response = await fetch(`${API_BASE}/config/hvsc`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return response.json();
}

export async function getClassifyProgress(): Promise<ApiResponse<ClassifyProgressSnapshot>> {
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
