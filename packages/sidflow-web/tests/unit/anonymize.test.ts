import { describe, test, expect } from 'bun:test';
import {
  anonymizeSessionId,
  anonymizeFilePath,
  anonymizeUserAgent,
  anonymizeTelemetryEvent,
  type TelemetryEvent,
} from '@/lib/server/anonymize';

describe('anonymizeSessionId', () => {
  test('hashes session ID deterministically', () => {
    const sessionId = 'user-12345-session-67890';
    const hashed1 = anonymizeSessionId(sessionId);
    const hashed2 = anonymizeSessionId(sessionId);

    expect(hashed1).toBe(hashed2);
    expect(hashed1).not.toBe(sessionId);
    expect(hashed1).toHaveLength(16); // Truncated to 16 chars
  });

  test('produces different hashes for different session IDs', () => {
    const hash1 = anonymizeSessionId('session-1');
    const hash2 = anonymizeSessionId('session-2');

    expect(hash1).not.toBe(hash2);
  });

  test('handles empty session ID', () => {
    const result = anonymizeSessionId('');
    expect(result).toBe('');
  });

  test('hash is hex-encoded string', () => {
    const hashed = anonymizeSessionId('test-session');
    expect(/^[0-9a-f]{16}$/.test(hashed)).toBe(true);
  });
});

describe('anonymizeFilePath', () => {
  test('extracts relative path from MUSICIANS marker', () => {
    const path = '/home/user/workspace/hvsc/C64Music/MUSICIANS/H/Hubbard_Rob/Commando.sid';
    const anonymized = anonymizeFilePath(path);

    expect(anonymized).toBe('MUSICIANS/H/Hubbard_Rob/Commando.sid');
  });

  test('extracts relative path from DEMOS marker', () => {
    const path = '/workspace/hvsc/C64Music/DEMOS/A-F/Crest/Uncensored.sid';
    const anonymized = anonymizeFilePath(path);

    expect(anonymized).toBe('DEMOS/A-F/Crest/Uncensored.sid');
  });

  test('extracts relative path from GAMES marker', () => {
    const path = 'C:\\Users\\Admin\\hvsc\\C64Music\\GAMES\\A-F\\Arkanoid.sid';
    const anonymized = anonymizeFilePath(path);

    expect(anonymized).toBe('GAMES/A-F/Arkanoid.sid');
  });

  test('hashes path when no marker found', () => {
    const path = '/some/random/path/to/file.sid';
    const anonymized = anonymizeFilePath(path);

    expect(anonymized).toMatch(/^hashed_[0-9a-f]{12}$/);
  });

  test('hashes same path consistently', () => {
    const path = '/random/path.sid';
    const hash1 = anonymizeFilePath(path);
    const hash2 = anonymizeFilePath(path);

    expect(hash1).toBe(hash2);
  });

  test('handles empty path', () => {
    const result = anonymizeFilePath('');
    expect(result).toBe('');
  });

  test('preserves directory structure after marker', () => {
    const path = '/home/chris/dev/C64Music/MUSICIANS/S/Scarzix/Tune.sid';
    const anonymized = anonymizeFilePath(path);

    expect(anonymized).toContain('MUSICIANS/S/Scarzix/Tune.sid');
    expect(anonymized).not.toContain('chris');
    expect(anonymized).not.toContain('/home/');
  });
});

describe('anonymizeUserAgent', () => {
  test('extracts Chrome version', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36';
    const anonymized = anonymizeUserAgent(ua);

    expect(anonymized).toBe('Chrome/120');
  });

  test('extracts Firefox version', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Firefox/121.0';
    const anonymized = anonymizeUserAgent(ua);

    expect(anonymized).toBe('Firefox/121');
  });

  test('extracts Safari version', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15';
    const anonymized = anonymizeUserAgent(ua);

    expect(anonymized).toBe('Safari/605');
  });

  test('extracts Edge version', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/120.0.0.0';
    const anonymized = anonymizeUserAgent(ua);

    expect(anonymized).toBe('Edge/120');
  });

  test('handles null user agent', () => {
    const anonymized = anonymizeUserAgent(null);
    expect(anonymized).toBe('unknown');
  });

  test('handles unrecognized user agent', () => {
    const ua = 'Some Custom Bot/1.0';
    const anonymized = anonymizeUserAgent(ua);

    expect(anonymized).toBe('other');
  });

  test('removes detailed OS and build information', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.6099.129 Safari/537.36';
    const anonymized = anonymizeUserAgent(ua);

    expect(anonymized).not.toContain('Linux');
    expect(anonymized).not.toContain('x86_64');
    expect(anonymized).not.toContain('6099.129');
  });
});

describe('anonymizeTelemetryEvent', () => {
  test('anonymizes all PII fields', () => {
    const event: TelemetryEvent = {
      type: 'playback.load.success',
      timestamp: Date.now(),
      sessionId: 'user-12345-session-67890',
      sidPath: '/home/user/hvsc/C64Music/MUSICIANS/H/Hubbard_Rob/Commando.sid',
    };

    const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0 Safari/537.36';
    const anonymized = anonymizeTelemetryEvent(event, userAgent);

    expect(anonymized.sessionId).not.toBe(event.sessionId);
    expect(anonymized.sessionId).toMatch(/^[0-9a-f]{16}$/);

    expect(anonymized.sidPath).not.toContain('/home/user');
    expect(anonymized.sidPath).toBe('MUSICIANS/H/Hubbard_Rob/Commando.sid');

    expect(anonymized.userAgent).toBe('Chrome/120');
  });

  test('preserves non-PII fields', () => {
    const event: TelemetryEvent = {
      type: 'playback.state.change',
      timestamp: 1234567890,
      metadata: {
        oldState: 'paused',
        newState: 'playing',
        positionSeconds: 45,
      },
    };

    const anonymized = anonymizeTelemetryEvent(event, 'Chrome/120.0.0.0');

    expect(anonymized.type).toBe('playback.state.change');
    expect(anonymized.timestamp).toBe(1234567890);
    expect(anonymized.metadata?.oldState).toBe('paused');
    expect(anonymized.metadata?.newState).toBe('playing');
    expect(anonymized.metadata?.positionSeconds).toBe(45);
  });

  test('recursively anonymizes nested metadata', () => {
    const event: TelemetryEvent = {
      type: 'playback.error',
      timestamp: Date.now(),
      metadata: {
        error: {
          message: 'Failed to load',
          stack: 'Error at /home/user/app/player.ts:123',
        },
        context: {
          sessionId: 'nested-session-id',
          sidPath: '/home/user/music/Test.sid',
        },
      },
    };

    const anonymized = anonymizeTelemetryEvent(event, 'Firefox/121.0');

    // Stack trace should have paths removed
    expect(anonymized.metadata?.error).toBeDefined();
    const errorMetadata = anonymized.metadata?.error as Record<string, unknown>;
    expect(errorMetadata.stack).not.toContain('/home/user');
    expect(errorMetadata.stack).toContain('<path>');

    // Nested session ID should be hashed
    const contextMetadata = anonymized.metadata?.context as Record<string, unknown>;
    expect(contextMetadata.sessionId).not.toBe('nested-session-id');
    expect(contextMetadata.sessionId).toMatch(/^[0-9a-f]{16}$/);

    // Nested path should be anonymized (hashed since no marker)
    expect(contextMetadata.sidPath).toMatch(/^hashed_[0-9a-f]{12}$/);
  });

  test('handles missing optional fields', () => {
    const event: TelemetryEvent = {
      type: 'playback.load.start',
      timestamp: Date.now(),
    };

    const anonymized = anonymizeTelemetryEvent(event, null);

    expect(anonymized.type).toBe('playback.load.start');
    expect(anonymized.sessionId).toBeUndefined();
    expect(anonymized.sidPath).toBeUndefined();
    expect(anonymized.userAgent).toBe('unknown');
  });

  test('handles null and undefined metadata values', () => {
    const event: TelemetryEvent = {
      type: 'test.event',
      timestamp: Date.now(),
      metadata: {
        field1: null,
        field2: undefined,
        field3: 'value',
      },
    };

    const anonymized = anonymizeTelemetryEvent(event, 'Chrome/120.0.0.0');

    expect(anonymized.metadata?.field1).toBeNull();
    expect(anonymized.metadata?.field2).toBeUndefined();
    expect(anonymized.metadata?.field3).toBe('value');
  });

  test('handles arrays in metadata', () => {
    const event: TelemetryEvent = {
      type: 'test.event',
      timestamp: Date.now(),
      metadata: {
        items: [1, 2, 3],
        tags: ['tag1', 'tag2'],
      },
    };

    const anonymized = anonymizeTelemetryEvent(event, 'Safari/605.1.15');

    expect(anonymized.metadata?.items).toEqual([1, 2, 3]);
    expect(anonymized.metadata?.tags).toEqual(['tag1', 'tag2']);
  });

  test('anonymizes multiple path fields in metadata', () => {
    const event: TelemetryEvent = {
      type: 'test.event',
      timestamp: Date.now(),
      metadata: {
        sidPath: '/home/user/C64Music/MUSICIANS/Test.sid',
        path: '/home/user/workspace/data/file.json',
        file: '/another/absolute/path.txt',
      },
    };

    const anonymized = anonymizeTelemetryEvent(event, 'Chrome/120.0.0.0');

    expect(anonymized.metadata?.sidPath).toBe('MUSICIANS/Test.sid');
    expect(anonymized.metadata?.path).toMatch(/^hashed_[0-9a-f]{12}$/);
    expect(anonymized.metadata?.file).toMatch(/^hashed_[0-9a-f]{12}$/);
  });
});

describe('Anonymization consistency', () => {
  test('same input produces same anonymized output', () => {
    const event: TelemetryEvent = {
      type: 'playback.load.success',
      timestamp: Date.now(),
      sessionId: 'test-session',
      sidPath: '/home/user/test.sid',
    };

    const anonymized1 = anonymizeTelemetryEvent(event, 'Chrome/120.0.0.0');
    const anonymized2 = anonymizeTelemetryEvent(event, 'Chrome/120.0.0.0');

    expect(anonymized1.sessionId).toBe(anonymized2.sessionId);
    expect(anonymized1.sidPath).toBe(anonymized2.sidPath);
    expect(anonymized1.userAgent).toBe(anonymized2.userAgent);
  });

  test('different inputs produce different anonymized outputs', () => {
    const event1: TelemetryEvent = {
      type: 'test',
      timestamp: Date.now(),
      sessionId: 'session-1',
    };

    const event2: TelemetryEvent = {
      type: 'test',
      timestamp: Date.now(),
      sessionId: 'session-2',
    };

    const anon1 = anonymizeTelemetryEvent(event1, 'Chrome/120.0.0.0');
    const anon2 = anonymizeTelemetryEvent(event2, 'Chrome/120.0.0.0');

    expect(anon1.sessionId).not.toBe(anon2.sessionId);
  });
});
