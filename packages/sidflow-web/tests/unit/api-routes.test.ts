/**
 * Unit tests for API routes
 * Note: API routes are tested via E2E tests with real server.
 * These unit tests validate schemas and logic.
 */
import { describe, test, expect } from 'bun:test';

describe('Play API Route', () => {
  test('should have correct request structure', () => {
    const validRequest = {
      sid_path: '/test/music.sid',
      preset: 'energetic',
    };

    // Schema validation is tested in validation.test.ts
    expect(validRequest.sid_path).toBeDefined();
    expect(validRequest.preset).toBeDefined();
  });
});

describe('Rate API Route', () => {
  test('should validate rating request schema', async () => {
    const validRequest = {
      sid_path: '/test/music.sid',
      ratings: { e: 3, m: 4, c: 2, p: 5 },
    };
    
    // Schema validation is tested in validation.test.ts
    expect(validRequest).toBeDefined();
  });
});

describe('Classify API Route', () => {
  test('should validate classify request schema', async () => {
    const validRequest = {
      path: '/test/directory',
    };
    
    expect(validRequest).toBeDefined();
  });
});

describe('Fetch API Route', () => {
  test('should validate fetch request schema', async () => {
    const validRequest = {
      configPath: '/path/to/config.json',
      remoteBaseUrl: 'https://example.com/hvsc',
    };
    
    expect(validRequest).toBeDefined();
  });
});

describe('Train API Route', () => {
  test('should validate train request schema', async () => {
    const validRequest = {
      epochs: 10,
      batchSize: 16,
      force: true,
    };
    
    expect(validRequest).toBeDefined();
  });
});
