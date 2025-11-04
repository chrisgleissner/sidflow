/**
 * Client-side API functions for making requests to the API routes
 */

import type {
  PlayRequest,
  RateRequest,
  ClassifyRequest,
  FetchRequest,
  TrainRequest,
  ApiResponse,
} from './validation';

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

export async function rateTrack(request: RateRequest): Promise<ApiResponse<{ message: string }>> {
  return apiRequest('/rate', request);
}

export async function classifyPath(request: ClassifyRequest): Promise<ApiResponse<{ output: string }>> {
  return apiRequest('/classify', request);
}

export async function fetchHvsc(request: FetchRequest = {}): Promise<ApiResponse<{ output: string }>> {
  return apiRequest('/fetch', request);
}

export async function trainModel(request: TrainRequest = {}): Promise<ApiResponse<{ output: string }>> {
  return apiRequest('/train', request);
}
