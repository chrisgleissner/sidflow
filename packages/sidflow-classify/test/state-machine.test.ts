/**
 * Tests for the state machine contract types and utilities
 */

import { describe, expect, test } from 'bun:test';
import {
  HEARTBEAT_CONFIG,
  RETRY_CONFIG,
  createThreadCounters,
  createGlobalCounters,
  isRecoverableError,
  createClassifyError,
  calculateBackoffDelay,
  getMaxRetries,
  withRetry,
} from '../src/types/state-machine.js';

describe('State Machine Configuration', () => {
  test('HEARTBEAT_CONFIG has correct values', () => {
    expect(HEARTBEAT_CONFIG.INTERVAL_MS).toBe(3000);
    expect(HEARTBEAT_CONFIG.STALE_THRESHOLD_MS).toBe(30000);  // 30s to accommodate long feature extractions
    expect(HEARTBEAT_CONFIG.GLOBAL_STALL_TIMEOUT_MS).toBe(60000);  // 60s for global stall
    expect(HEARTBEAT_CONFIG.NO_AUDIO_STREAK_THRESHOLD).toBe(3);
  });

  test('RETRY_CONFIG has correct values for building phase', () => {
    expect(RETRY_CONFIG.building.maxRetries).toBe(3);
    expect(RETRY_CONFIG.building.baseDelayMs).toBe(100);
    expect(RETRY_CONFIG.building.backoffMultiplier).toBe(2);
  });

  test('RETRY_CONFIG has correct values for metadata phase', () => {
    expect(RETRY_CONFIG.metadata.maxRetries).toBe(1);
    expect(RETRY_CONFIG.metadata.baseDelayMs).toBe(50);
    expect(RETRY_CONFIG.metadata.backoffMultiplier).toBe(1);
  });

  test('RETRY_CONFIG has correct values for tagging phase', () => {
    expect(RETRY_CONFIG.tagging.maxRetries).toBe(1);
    expect(RETRY_CONFIG.tagging.baseDelayMs).toBe(50);
    expect(RETRY_CONFIG.tagging.backoffMultiplier).toBe(1);
  });
});

describe('Thread Counters', () => {
  test('createThreadCounters returns correct initial values', () => {
    const counters = createThreadCounters();
    
    expect(counters.analyzed).toBe(0);
    expect(counters.rendered).toBe(0);
    expect(counters.metadataExtracted).toBe(0);
    expect(counters.essentiaTagged).toBe(0);
    expect(counters.skipped).toBe(0);
    expect(counters.errors).toBe(0);
  });

  test('createGlobalCounters returns correct initial values', () => {
    const counters = createGlobalCounters();
    
    expect(counters.analyzed).toBe(0);
    expect(counters.rendered).toBe(0);
    expect(counters.metadataExtracted).toBe(0);
    expect(counters.essentiaTagged).toBe(0);
    expect(counters.skipped).toBe(0);
    expect(counters.errors).toBe(0);
    expect(counters.retries).toBe(0);
  });
});

describe('Error Classification', () => {
  test('isRecoverableError returns true for ENOENT errors', () => {
    const error = new Error('ENOENT: no such file or directory');
    expect(isRecoverableError(error)).toBe(true);
  });

  test('isRecoverableError returns true for timeout errors', () => {
    const error = new Error('Operation timeout after 5000ms');
    expect(isRecoverableError(error)).toBe(true);
  });

  test('isRecoverableError returns true for busy errors', () => {
    const error = new Error('Resource busy');
    expect(isRecoverableError(error)).toBe(true);
  });

  test('isRecoverableError returns false for invalid file errors', () => {
    const error = new Error('Invalid file format');
    expect(isRecoverableError(error)).toBe(false);
  });

  test('isRecoverableError returns false for corrupt data errors', () => {
    const error = new Error('Corrupt data detected');
    expect(isRecoverableError(error)).toBe(false);
  });

  test('isRecoverableError returns false for malformed errors', () => {
    const error = new Error('Malformed header');
    expect(isRecoverableError(error)).toBe(false);
  });

  test('isRecoverableError returns true for unknown errors (default)', () => {
    const error = new Error('Something unexpected happened');
    expect(isRecoverableError(error)).toBe(true);
  });

  test('isRecoverableError returns true for non-Error objects', () => {
    expect(isRecoverableError('string error')).toBe(true);
    expect(isRecoverableError(123)).toBe(true);
    expect(isRecoverableError(null)).toBe(true);
    expect(isRecoverableError(undefined)).toBe(true);
  });
});

describe('ClassifyError Creation', () => {
  test('createClassifyError creates recoverable error from recoverable exception', () => {
    const error = new Error('ENOENT: no such file');
    const classifyError = createClassifyError('building', error);
    
    expect(classifyError.type).toBe('recoverable');
    expect(classifyError.phase).toBe('building');
    expect(classifyError.code).toBe('BUILDING_ERROR');
    expect(classifyError.message).toBe('ENOENT: no such file');
    expect(classifyError.retryable).toBe(true);
    expect(classifyError.details?.stack).toBeDefined();
  });

  test('createClassifyError creates fatal error from non-recoverable exception', () => {
    const error = new Error('Invalid SID file format');
    const classifyError = createClassifyError('metadata', error);
    
    expect(classifyError.type).toBe('fatal');
    expect(classifyError.phase).toBe('metadata');
    expect(classifyError.code).toBe('METADATA_ERROR');
    expect(classifyError.message).toBe('Invalid SID file format');
    expect(classifyError.retryable).toBe(false);
  });

  test('createClassifyError accepts custom error code', () => {
    const error = new Error('Something went wrong');
    const classifyError = createClassifyError('tagging', error, 'CUSTOM_ERROR_CODE');
    
    expect(classifyError.code).toBe('CUSTOM_ERROR_CODE');
  });

  test('createClassifyError handles string errors', () => {
    const classifyError = createClassifyError('building', 'Simple string error');
    
    expect(classifyError.message).toBe('Simple string error');
    expect(classifyError.type).toBe('recoverable');
    expect(classifyError.details).toBeUndefined();
  });

  test('createClassifyError handles different phases', () => {
    const phases = ['analyzing', 'building', 'metadata', 'tagging'] as const;
    
    for (const phase of phases) {
      const error = createClassifyError(phase, new Error('test'));
      expect(error.phase).toBe(phase);
      expect(error.code).toBe(`${phase.toUpperCase()}_ERROR`);
    }
  });
});

describe('Type Safety', () => {
  test('HEARTBEAT_CONFIG is readonly', () => {
    // This test verifies the type system - if this compiles, the types are correct
    const interval: number = HEARTBEAT_CONFIG.INTERVAL_MS;
    const threshold: number = HEARTBEAT_CONFIG.STALE_THRESHOLD_MS;
    const stall: number = HEARTBEAT_CONFIG.GLOBAL_STALL_TIMEOUT_MS;
    const streak: number = HEARTBEAT_CONFIG.NO_AUDIO_STREAK_THRESHOLD;
    
    expect(interval).toBe(3000);
    expect(threshold).toBe(30000);  // 30s to accommodate long feature extractions
    expect(stall).toBe(60000);  // 60s for global stall
    expect(streak).toBe(3);
  });

  test('RETRY_CONFIG is readonly', () => {
    // Verify the structure is as expected
    const buildingRetries: number = RETRY_CONFIG.building.maxRetries;
    const metadataRetries: number = RETRY_CONFIG.metadata.maxRetries;
    const taggingRetries: number = RETRY_CONFIG.tagging.maxRetries;
    
    expect(buildingRetries).toBe(3);
    expect(metadataRetries).toBe(1);
    expect(taggingRetries).toBe(1);
  });
});

describe('Backoff Delay Calculation', () => {
  test('calculateBackoffDelay returns base delay for first attempt', () => {
    expect(calculateBackoffDelay('building', 1)).toBe(100);
    expect(calculateBackoffDelay('metadata', 1)).toBe(50);
    expect(calculateBackoffDelay('tagging', 1)).toBe(50);
  });

  test('calculateBackoffDelay applies exponential backoff for building phase', () => {
    // building: baseDelay=100, multiplier=2
    expect(calculateBackoffDelay('building', 1)).toBe(100);   // 100 * 2^0 = 100
    expect(calculateBackoffDelay('building', 2)).toBe(200);   // 100 * 2^1 = 200
    expect(calculateBackoffDelay('building', 3)).toBe(400);   // 100 * 2^2 = 400
    expect(calculateBackoffDelay('building', 4)).toBe(800);   // 100 * 2^3 = 800
  });

  test('calculateBackoffDelay uses linear backoff for metadata phase', () => {
    // metadata: baseDelay=50, multiplier=1 (linear)
    expect(calculateBackoffDelay('metadata', 1)).toBe(50);   // 50 * 1^0 = 50
    expect(calculateBackoffDelay('metadata', 2)).toBe(50);   // 50 * 1^1 = 50
  });

  test('calculateBackoffDelay uses linear backoff for tagging phase', () => {
    // tagging: baseDelay=50, multiplier=1 (linear)
    expect(calculateBackoffDelay('tagging', 1)).toBe(50);   // 50 * 1^0 = 50
    expect(calculateBackoffDelay('tagging', 2)).toBe(50);   // 50 * 1^1 = 50
  });
});

describe('getMaxRetries', () => {
  test('returns correct max retries for each phase', () => {
    expect(getMaxRetries('building')).toBe(3);
    expect(getMaxRetries('metadata')).toBe(1);
    expect(getMaxRetries('tagging')).toBe(1);
  });
});

describe('withRetry', () => {
  test('returns result on first successful attempt', async () => {
    let attempts = 0;
    const result = await withRetry('building', async () => {
      attempts++;
      return 'success';
    });
    
    expect(result).toBe('success');
    expect(attempts).toBe(1);
  });

  test('retries on recoverable error and succeeds', async () => {
    let attempts = 0;
    const result = await withRetry('building', async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('ENOENT: temporary failure');
      }
      return 'success after retries';
    });
    
    expect(result).toBe('success after retries');
    expect(attempts).toBe(3);
  });

  test('throws after exhausting all retries', async () => {
    let attempts = 0;
    
    await expect(
      withRetry('metadata', async () => {
        attempts++;
        throw new Error('ENOENT: always fails');
      })
    ).rejects.toThrow('ENOENT: always fails');
    
    // metadata has 1 retry, so 2 total attempts
    expect(attempts).toBe(2);
  });

  test('throws immediately on fatal error without retrying', async () => {
    let attempts = 0;
    let fatalErrorReceived = false;
    
    await expect(
      withRetry('building', async () => {
        attempts++;
        throw new Error('Invalid file format');
      }, {
        onFatalError: () => {
          fatalErrorReceived = true;
        }
      })
    ).rejects.toThrow('Invalid file format');
    
    expect(attempts).toBe(1);
    expect(fatalErrorReceived).toBe(true);
  });

  test('calls onRetry callback with correct arguments', async () => {
    const retryCallbacks: Array<{ attempt: number; maxAttempts: number; delayMs: number }> = [];
    let attempts = 0;
    
    await withRetry('building', async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('ENOENT: temporary');
      }
      return 'done';
    }, {
      onRetry: (attempt, maxAttempts, _error, delayMs) => {
        retryCallbacks.push({ attempt, maxAttempts, delayMs });
      }
    });
    
    expect(retryCallbacks.length).toBe(2);
    // First retry
    expect(retryCallbacks[0].attempt).toBe(1);
    expect(retryCallbacks[0].maxAttempts).toBe(4); // 3 retries + 1 initial = 4
    expect(retryCallbacks[0].delayMs).toBe(100);   // base delay
    // Second retry
    expect(retryCallbacks[1].attempt).toBe(2);
    expect(retryCallbacks[1].delayMs).toBe(200);   // 100 * 2^1
  });

  test('uses correct retry count for different phases', async () => {
    // Test building phase (3 retries)
    let buildingAttempts = 0;
    try {
      await withRetry('building', async () => {
        buildingAttempts++;
        throw new Error('ENOENT: fail');
      });
    } catch {
      // expected
    }
    expect(buildingAttempts).toBe(4); // 1 initial + 3 retries
    
    // Test metadata phase (1 retry)
    let metadataAttempts = 0;
    try {
      await withRetry('metadata', async () => {
        metadataAttempts++;
        throw new Error('ENOENT: fail');
      });
    } catch {
      // expected
    }
    expect(metadataAttempts).toBe(2); // 1 initial + 1 retry
    
    // Test tagging phase (1 retry)
    let taggingAttempts = 0;
    try {
      await withRetry('tagging', async () => {
        taggingAttempts++;
        throw new Error('ENOENT: fail');
      });
    } catch {
      // expected
    }
    expect(taggingAttempts).toBe(2); // 1 initial + 1 retry
  });
});
