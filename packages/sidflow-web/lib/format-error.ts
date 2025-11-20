import type { ApiErrorResponse } from '@/lib/validation';

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'error' in value && typeof (value as { error?: unknown }).error === 'string';
}

export function formatApiError(response: unknown): string {
  if (isApiErrorResponse(response)) {
    if (response.details) {
      return `${response.error} – ${response.details}`;
    }
    return response.error;
  }

  if (response instanceof Error) {
    return response.message;
  }

  if (typeof response === 'string') {
    return response;
  }

  if (response && typeof response === 'object') {
    const summary = JSON.stringify(response);
    return summary.length > 0 ? summary : 'Unknown error';
  }

  return 'Unknown error';
}
