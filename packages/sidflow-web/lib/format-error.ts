import type { ApiErrorResponse } from '@/lib/validation';

export function formatApiError(response: ApiErrorResponse): string {
  if (response.details) {
    return `${response.error} – ${response.details}`;
  }
  return response.error;
}
