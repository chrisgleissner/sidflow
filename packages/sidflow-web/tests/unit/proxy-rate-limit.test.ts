import { describe, test, expect, beforeEach } from 'bun:test';
import { middleware as proxy } from '@/middleware';
import { NextRequest } from 'next/server';
import { adminRateLimiter, defaultRateLimiter } from '@/lib/server/rate-limiter';

describe('Proxy rate limiting', () => {
  beforeEach(() => {
    // Reset rate limiters before each test
    adminRateLimiter.reset();
    defaultRateLimiter.reset();
  });

  test('rate limits API routes', async () => {
    // Default rate limiter allows 300 requests per minute
    // Make requests up to the limit
    for (let i = 0; i < 300; i++) {
      const request = new NextRequest('http://localhost/api/health', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      });
      const response = await proxy(request);
      expect(response.status).toBe(200);
    }

    // 301st request should be rate limited
    const request = new NextRequest('http://localhost/api/health', {
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });
    const response = await proxy(request);
    expect(response.status).toBe(429);

    const body = await response.json();
    expect(body.error).toBe('rate_limit_exceeded');
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  test('applies stricter rate limit to admin routes', async () => {
    // Admin rate limiter allows 20 requests per minute
    // Make requests up to the limit
    for (let i = 0; i < 20; i++) {
      const request = new NextRequest('http://localhost/api/admin/metrics', {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          authorization: 'Basic ' + btoa('admin:password'),
        },
      });
      const response = await proxy(request);
      // May get 401 if auth fails, but should not get 429
      expect(response.status).not.toBe(429);
    }

    // 21st request should be rate limited
    const request = new NextRequest('http://localhost/api/admin/metrics', {
      headers: {
        'x-forwarded-for': '203.0.113.1',
        authorization: 'Basic ' + btoa('admin:password'),
      },
    });
    const response = await proxy(request);
    expect(response.status).toBe(429);
  });

  test('does not rate limit non-API routes', async () => {
    // Make many requests to a non-API route
    for (let i = 0; i < 150; i++) {
      const request = new NextRequest('http://localhost/some-page', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      });
      const response = await proxy(request);
      expect(response.status).not.toBe(429);
    }
  });

  test('includes rate limit headers in 429 response', async () => {
    // Exhaust rate limit
    for (let i = 0; i < 300; i++) {
      await proxy(
        new NextRequest('http://localhost/api/health', {
          headers: { 'x-forwarded-for': '203.0.113.1' },
        })
      );
    }

    // Get rate limited response
    const request = new NextRequest('http://localhost/api/health', {
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });
    const response = await proxy(request);

    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('300');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });

  test('tracks different IPs independently', async () => {
    // Exhaust limit for IP1
    for (let i = 0; i < 300; i++) {
      await proxy(
        new NextRequest('http://localhost/api/health', {
          headers: { 'x-forwarded-for': '203.0.113.1' },
        })
      );
    }

    // IP1 should be rate limited
    const request1 = new NextRequest('http://localhost/api/health', {
      headers: { 'x-forwarded-for': '203.0.113.1' },
    });
    const response1 = await proxy(request1);
    expect(response1.status).toBe(429);

    // IP2 should still have full quota
    const request2 = new NextRequest('http://localhost/api/health', {
      headers: { 'x-forwarded-for': '203.0.113.2' },
    });
    const response2 = await proxy(request2);
    expect(response2.status).toBe(200);
  });

  test('does not rate limit localhost', async () => {
    // Make many requests from localhost (should be whitelisted)
    for (let i = 0; i < 150; i++) {
      const request = new NextRequest('http://localhost/api/health', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      });
      const response = await proxy(request);
      expect(response.status).not.toBe(429);
    }
  });

  test('rate limit response includes security headers', async () => {
    // Exhaust rate limit
    for (let i = 0; i < 300; i++) {
      await proxy(
        new NextRequest('http://localhost/api/health', {
          headers: { 'x-forwarded-for': '203.0.113.1' },
        })
      );
    }

    // Get rate limited response
    const request = new NextRequest('http://localhost/api/health', {
      headers: {
        'x-forwarded-for': '203.0.113.1',
        accept: 'text/html',
      },
    });
    const response = await proxy(request);

    expect(response.status).toBe(429);
    // Verify security headers are still applied
    expect(response.headers.has('Cross-Origin-Opener-Policy')).toBe(true);
    expect(response.headers.has('Cross-Origin-Embedder-Policy')).toBe(true);
  });

  test('admin route rate limit is enforced before authentication', async () => {
    // Exhaust admin rate limit with invalid credentials
    for (let i = 0; i < 20; i++) {
      await proxy(
        new NextRequest('http://localhost/api/admin/metrics', {
          headers: {
            'x-forwarded-for': '203.0.113.1',
            authorization: 'Basic ' + btoa('wrong:credentials'),
          },
        })
      );
    }

    // 21st request should be rate limited (429, not 401)
    const request = new NextRequest('http://localhost/api/admin/metrics', {
      headers: {
        'x-forwarded-for': '203.0.113.1',
        authorization: 'Basic ' + btoa('wrong:credentials'),
      },
    });
    const response = await proxy(request);
    expect(response.status).toBe(429);
  });
});

describe('Proxy middleware integration', () => {
  beforeEach(() => {
    defaultRateLimiter.reset();
    adminRateLimiter.reset();
  });

  test('applies rate limiting, then auth, then security headers in order', async () => {
    const request = new NextRequest('http://localhost/api/health', {
      headers: {
        'x-forwarded-for': '203.0.113.1',
        accept: 'text/html',
      },
    });

    const response = await proxy(request);

    // Should pass rate limit check (first middleware)
    expect(response.status).toBe(200);

    // Should have security headers applied (last middleware)
    expect(response.headers.has('Cross-Origin-Opener-Policy')).toBe(true);
  });

  test('short-circuits on rate limit failure', async () => {
    // Set admin password for this test
    const originalPassword = process.env.SIDFLOW_ADMIN_PASSWORD;
    (process.env as any).SIDFLOW_ADMIN_PASSWORD = 'test-password';

    try {
      // Exhaust rate limit on admin endpoint
      for (let i = 0; i < 20; i++) {
        await proxy(
          new NextRequest('http://localhost/api/admin/metrics', {
            headers: {
              'x-forwarded-for': '203.0.113.2',
              authorization: 'Basic ' + btoa('admin:test-password'),
            },
          })
        );
      }

      // 21st request should be rate limited before auth check
      const request = new NextRequest('http://localhost/api/admin/metrics', {
        headers: {
          'x-forwarded-for': '203.0.113.2',
          authorization: 'Basic ' + btoa('admin:test-password'),
        },
      });

      const response = await proxy(request);

      // Should be 429 (rate limited), not proceeding to auth
      expect(response.status).toBe(429);
    } finally {
      // Restore original password
      if (originalPassword !== undefined) {
        (process.env as any).SIDFLOW_ADMIN_PASSWORD = originalPassword;
      } else {
        delete (process.env as any).SIDFLOW_ADMIN_PASSWORD;
      }
      // Reset rate limiters
      adminRateLimiter.reset();
    }
  });
});
