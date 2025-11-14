import { describe, test, expect, beforeEach } from 'bun:test';
import {
  RateLimiter,
  getClientIp,
  type RateLimitConfig,
} from '@/lib/server/rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      maxRequests: 5,
      windowMs: 1000, // 1 second for faster tests
    });
  });

  test('allows requests under limit', () => {
    const result1 = limiter.check('192.168.1.1');
    expect(result1.allowed).toBe(true);
    expect(result1.remaining).toBe(4);

    const result2 = limiter.check('192.168.1.1');
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(3);
  });

  test('blocks requests over limit', () => {
    // Make 5 requests (at limit)
    for (let i = 0; i < 5; i++) {
      const result = limiter.check('192.168.1.1');
      expect(result.allowed).toBe(true);
    }

    // 6th request should be blocked
    const result = limiter.check('192.168.1.1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test('tracks different IPs independently', () => {
    // IP 1 uses up its limit
    for (let i = 0; i < 5; i++) {
      limiter.check('192.168.1.1');
    }
    const result1 = limiter.check('192.168.1.1');
    expect(result1.allowed).toBe(false);

    // IP 2 should still have full quota
    const result2 = limiter.check('192.168.1.2');
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(4);
  });

  test('resets after window expires', async () => {
    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      limiter.check('192.168.1.1');
    }

    // Should be blocked
    const result1 = limiter.check('192.168.1.1');
    expect(result1.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should be allowed again
    const result2 = limiter.check('192.168.1.1');
    expect(result2.allowed).toBe(true);
    expect(result2.remaining).toBe(4);
  });

  test('implements sliding window correctly', async () => {
    // Make 3 requests at t=0
    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1');

    // Wait 500ms
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Make 2 more requests at t=500 (total 5)
    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1');

    // Should be at limit
    const result1 = limiter.check('192.168.1.1');
    expect(result1.allowed).toBe(false);

    // Wait another 600ms (total 1100ms from start)
    // First 3 requests should have expired
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Should now have 3 requests available (5 - 2 remaining from t=500)
    const result2 = limiter.check('192.168.1.1');
    expect(result2.allowed).toBe(true);
  });

  test('skips rate limiting for whitelisted IPs', () => {
    const limiter = new RateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      skipIps: ['127.0.0.1', '::1'],
    });

    // Make 10 requests from localhost (way over limit)
    for (let i = 0; i < 10; i++) {
      const result = limiter.check('127.0.0.1');
      expect(result.allowed).toBe(true);
    }

    // Regular IP should still be rate limited
    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1');
    const result = limiter.check('192.168.1.1');
    expect(result.allowed).toBe(false);
  });

  test('reset clears specific client', () => {
    // Fill up limit for IP 1
    for (let i = 0; i < 5; i++) {
      limiter.check('192.168.1.1');
    }

    // Should be blocked
    const result1 = limiter.check('192.168.1.1');
    expect(result1.allowed).toBe(false);

    // Reset IP 1
    limiter.reset('192.168.1.1');

    // Should now be allowed
    const result2 = limiter.check('192.168.1.1');
    expect(result2.allowed).toBe(true);
  });

  test('reset without IP clears all clients', () => {
    // Fill up limit for multiple IPs
    for (let i = 0; i < 5; i++) {
      limiter.check('192.168.1.1');
      limiter.check('192.168.1.2');
    }

    // Both should be blocked
    expect(limiter.check('192.168.1.1').allowed).toBe(false);
    expect(limiter.check('192.168.1.2').allowed).toBe(false);

    // Reset all
    limiter.reset();

    // Both should be allowed
    expect(limiter.check('192.168.1.1').allowed).toBe(true);
    expect(limiter.check('192.168.1.2').allowed).toBe(true);
  });

  test('cleanup removes expired logs', async () => {
    // Create some logs
    limiter.check('192.168.1.1');
    limiter.check('192.168.1.2');

    const stats1 = limiter.getStats();
    expect(stats1.totalClients).toBe(2);
    expect(stats1.totalRequests).toBe(2);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Cleanup should remove expired logs
    limiter.cleanup();

    const stats2 = limiter.getStats();
    expect(stats2.totalClients).toBe(0);
    expect(stats2.totalRequests).toBe(0);
  });

  test('getStats returns accurate counts', () => {
    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1');
    limiter.check('192.168.1.2');

    const stats = limiter.getStats();
    expect(stats.totalClients).toBe(2);
    expect(stats.totalRequests).toBe(3);
  });

  test('calculates correct retry-after time', () => {
    // Fill up limit
    for (let i = 0; i < 5; i++) {
      limiter.check('192.168.1.1');
    }

    // Get blocked result
    const result = limiter.check('192.168.1.1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(1); // Should be <= 1 second

    // Verify resetTime is in the future
    expect(result.resetTime).toBeGreaterThan(Date.now());
  });

  test('handles concurrent requests correctly', () => {
    // Simulate concurrent requests from same IP
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(limiter.check('192.168.1.1'));
    }

    // First 5 should be allowed
    for (let i = 0; i < 5; i++) {
      expect(results[i]?.allowed).toBe(true);
    }

    // Next 5 should be blocked
    for (let i = 5; i < 10; i++) {
      expect(results[i]?.allowed).toBe(false);
    }
  });
});

describe('getClientIp', () => {
  test('extracts IP from x-forwarded-for header', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '203.0.113.1, 198.51.100.1');

    const ip = getClientIp(headers);
    expect(ip).toBe('203.0.113.1');
  });

  test('extracts IP from x-real-ip header', () => {
    const headers = new Headers();
    headers.set('x-real-ip', '203.0.113.1');

    const ip = getClientIp(headers);
    expect(ip).toBe('203.0.113.1');
  });

  test('prefers x-forwarded-for over x-real-ip', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '203.0.113.1');
    headers.set('x-real-ip', '198.51.100.1');

    const ip = getClientIp(headers);
    expect(ip).toBe('203.0.113.1');
  });

  test('trims whitespace from IP', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '  203.0.113.1  ');

    const ip = getClientIp(headers);
    expect(ip).toBe('203.0.113.1');
  });

  test('returns localhost when no headers present', () => {
    const headers = new Headers();
    const ip = getClientIp(headers);
    expect(ip).toBe('127.0.0.1');
  });

  test('handles empty x-forwarded-for header', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '');

    const ip = getClientIp(headers);
    expect(ip).toBe('127.0.0.1');
  });
});

describe('Rate limiter configuration', () => {
  test('accepts custom maxRequests', () => {
    const limiter = new RateLimiter({
      maxRequests: 10,
      windowMs: 1000,
    });

    // Should allow 10 requests
    for (let i = 0; i < 10; i++) {
      const result = limiter.check('192.168.1.1');
      expect(result.allowed).toBe(true);
    }

    // 11th should be blocked
    const result = limiter.check('192.168.1.1');
    expect(result.allowed).toBe(false);
  });

  test('accepts custom windowMs', async () => {
    const limiter = new RateLimiter({
      maxRequests: 2,
      windowMs: 500, // 500ms window
    });

    // Fill up limit
    limiter.check('192.168.1.1');
    limiter.check('192.168.1.1');

    // Should be blocked
    expect(limiter.check('192.168.1.1').allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Should be allowed again
    expect(limiter.check('192.168.1.1').allowed).toBe(true);
  });

  test('accepts custom skipIps', () => {
    const limiter = new RateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      skipIps: ['10.0.0.1', '10.0.0.2'],
    });

    // Custom whitelisted IPs should not be rate limited
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('10.0.0.1').allowed).toBe(true);
      expect(limiter.check('10.0.0.2').allowed).toBe(true);
    }

    // Regular IP should be rate limited
    limiter.check('192.168.1.1');
    expect(limiter.check('192.168.1.1').allowed).toBe(false);
  });
});
