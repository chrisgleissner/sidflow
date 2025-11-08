/**
 * Unit tests for API validation schemas
 */
import { describe, test, expect } from 'bun:test';
import { 
  PlayRequestSchema, 
  RateRequestSchema, 
  ClassifyRequestSchema, 
  FetchRequestSchema, 
  TrainRequestSchema 
} from '../../lib/validation';

describe('PlayRequestSchema', () => {
  test('validates valid play request', () => {
    const valid = { sid_path: '/path/to/file.sid', preset: 'energetic' as const };
    const result = PlayRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('validates play request without preset', () => {
    const valid = { sid_path: '/path/to/file.sid' };
    const result = PlayRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects empty sid_path', () => {
    const invalid = { sid_path: '' };
    const result = PlayRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects invalid preset', () => {
    const invalid = { sid_path: '/path/to/file.sid', preset: 'invalid' };
    const result = PlayRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('accepts all valid presets', () => {
    const presets = ['quiet', 'ambient', 'energetic', 'dark', 'bright', 'complex'];
    for (const preset of presets) {
      const valid = { sid_path: '/path/to/file.sid', preset };
      const result = PlayRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    }
  });
});

describe('RateRequestSchema', () => {
  test('validates valid rate request', () => {
    const valid = {
      sid_path: '/path/to/file.sid',
      ratings: { e: 3, m: 4, c: 2, p: 5 }
    };
    const result = RateRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects ratings outside 1-5 range', () => {
    const invalid = {
      sid_path: '/path/to/file.sid',
      ratings: { e: 0, m: 3, c: 3, p: 3 }
    };
    const result = RateRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects ratings above 5', () => {
    const invalid = {
      sid_path: '/path/to/file.sid',
      ratings: { e: 3, m: 6, c: 3, p: 3 }
    };
    const result = RateRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects non-integer ratings', () => {
    const invalid = {
      sid_path: '/path/to/file.sid',
      ratings: { e: 3.5, m: 3, c: 3, p: 3 }
    };
    const result = RateRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects missing rating dimensions', () => {
    const invalid = {
      sid_path: '/path/to/file.sid',
      ratings: { e: 3, m: 3, c: 3 } // missing p
    };
    const result = RateRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('ClassifyRequestSchema', () => {
  test('validates valid classify request', () => {
    const valid = { path: '/path/to/directory' };
    const result = ClassifyRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects empty path', () => {
    const invalid = { path: '' };
    const result = ClassifyRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('allows missing path for auto-detection', () => {
    const valid = {};
    const result = ClassifyRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe('FetchRequestSchema', () => {
  test('validates empty fetch request', () => {
    const valid = {};
    const result = FetchRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('validates fetch request with all options', () => {
    const valid = {
      configPath: '/path/to/config.json',
      remoteBaseUrl: 'https://example.com/hvsc',
      hvscVersionPath: '/path/to/version.json'
    };
    const result = FetchRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects invalid URL', () => {
    const invalid = { remoteBaseUrl: 'not-a-url' };
    const result = FetchRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('validates partial fetch request', () => {
    const valid = { configPath: '/path/to/config.json' };
    const result = FetchRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

describe('TrainRequestSchema', () => {
  test('validates empty train request', () => {
    const valid = {};
    const result = TrainRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('validates train request with all options', () => {
    const valid = {
      configPath: '/path/to/config.json',
      epochs: 10,
      batchSize: 16,
      learningRate: 0.001,
      evaluate: true,
      force: false
    };
    const result = TrainRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test('rejects negative epochs', () => {
    const invalid = { epochs: -5 };
    const result = TrainRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects zero batch size', () => {
    const invalid = { batchSize: 0 };
    const result = TrainRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects negative learning rate', () => {
    const invalid = { learningRate: -0.01 };
    const result = TrainRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects non-integer epochs', () => {
    const invalid = { epochs: 5.5 };
    const result = TrainRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('validates partial train request', () => {
    const valid = { epochs: 20, force: true };
    const result = TrainRequestSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});
