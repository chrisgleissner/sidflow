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

  it('handles Error instances gracefully', () => {
    const err = new Error('Network unreachable');
    expect(formatApiError(err)).toBe('Network unreachable');
  });

  it('returns string inputs verbatim', () => {
    expect(formatApiError('Timed out')).toBe('Timed out');
  });

  it('falls back to summary for arbitrary objects', () => {
    const result = formatApiError({ code: 503, message: 'Overloaded' });
    expect(result).toContain('503');
    expect(result).toContain('Overloaded');
  });

  it('returns generic message for nullish inputs', () => {
    expect(formatApiError(null)).toBe('Unknown error');
    expect(formatApiError(undefined)).toBe('Unknown error');
  });
});
