import { describe, expect, it } from 'bun:test';
import { formatApiError } from '@/lib/format-error';

const baseError = {
  success: false as const,
  status: 400,
  error: 'Validation failed',
  requestId: 'req-1',
};

describe('formatApiError', () => {
  it('returns base error message when no details are present', () => {
    expect(formatApiError(baseError)).toBe('Validation failed');
  });

  it('appends details when available', () => {
    const response = {
      ...baseError,
      details: 'Missing title field',
    };

    expect(formatApiError(response)).toBe('Validation failed – Missing title field');
  });
});
