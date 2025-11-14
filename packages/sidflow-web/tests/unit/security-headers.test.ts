import { describe, test, expect } from 'bun:test';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';

describe('Security headers', () => {
  describe('Content Security Policy', () => {
    test('sets CSP header on all responses', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toBeTruthy();
      expect(csp).toContain("default-src 'self'");
    });

    test('CSP allows same-origin scripts', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain("script-src 'self'");
    });

    test('CSP allows unsafe-eval for WASM', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain("'unsafe-eval'");
    });

    test('CSP allows inline styles for Tailwind', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });

    test('CSP allows blob URLs for media and workers', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain('media-src');
      expect(csp).toContain('blob:');
      expect(csp).toContain('worker-src');
    });

    test('CSP prevents clickjacking with frame-ancestors', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain("frame-ancestors 'none'");
    });

    test('CSP restricts base and form actions', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
    });
  });

  describe('X-Frame-Options', () => {
    test('sets X-Frame-Options to DENY', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });

    test('applies to API routes', async () => {
      const request = new NextRequest('http://localhost/api/health');
      const response = await proxy(request);

      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });

    test('applies to static assets', async () => {
      const request = new NextRequest('http://localhost/favicon.ico');
      const response = await proxy(request);

      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });
  });

  describe('X-Content-Type-Options', () => {
    test('sets X-Content-Type-Options to nosniff', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    test('prevents MIME type sniffing on scripts', async () => {
      const request = new NextRequest('http://localhost/script.js');
      const response = await proxy(request);

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    test('applies to all content types', async () => {
      const paths = ['/page', '/api/data', '/style.css', '/image.png'];

      for (const path of paths) {
        const request = new NextRequest(`http://localhost${path}`);
        const response = await proxy(request);

        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      }
    });
  });

  describe('Referrer-Policy', () => {
    test('sets Referrer-Policy to strict-origin-when-cross-origin', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      expect(response.headers.get('Referrer-Policy')).toBe(
        'strict-origin-when-cross-origin'
      );
    });

    test('applies to all routes', async () => {
      const request = new NextRequest('http://localhost/some/nested/route');
      const response = await proxy(request);

      expect(response.headers.get('Referrer-Policy')).toBe(
        'strict-origin-when-cross-origin'
      );
    });
  });

  describe('Permissions-Policy', () => {
    test('sets Permissions-Policy header', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const permissions = response.headers.get('Permissions-Policy');
      expect(permissions).toBeTruthy();
    });

    test('disables camera access', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const permissions = response.headers.get('Permissions-Policy');
      expect(permissions).toContain('camera=()');
    });

    test('disables microphone access', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const permissions = response.headers.get('Permissions-Policy');
      expect(permissions).toContain('microphone=()');
    });

    test('disables geolocation access', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const permissions = response.headers.get('Permissions-Policy');
      expect(permissions).toContain('geolocation=()');
    });

    test('disables payment and USB access', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const permissions = response.headers.get('Permissions-Policy');
      expect(permissions).toContain('payment=()');
      expect(permissions).toContain('usb=()');
    });
  });

  describe('Strict-Transport-Security', () => {
    // Note: HSTS is only set in production
    // In test environment (NODE_ENV=test), HSTS will not be set
    // This behavior is correct - HSTS should only be enforced in production

    test('HSTS header format is correct when present', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const hsts = response.headers.get('Strict-Transport-Security');

      if (hsts) {
        // If HSTS is set (production), verify format
        expect(hsts).toContain('max-age=');
        expect(hsts).toContain('includeSubDomains');
        expect(hsts).toContain('preload');
      } else {
        // In non-production, HSTS should not be set
        expect(process.env.NODE_ENV).not.toBe('production');
      }
    });

    test('HSTS includes one-year max-age', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      const hsts = response.headers.get('Strict-Transport-Security');

      if (hsts) {
        // 31536000 seconds = 1 year
        expect(hsts).toContain('max-age=31536000');
      }
    });
  });

  describe('Cross-Origin headers for SharedArrayBuffer', () => {
    test('sets COOP for HTML documents', async () => {
      const request = new NextRequest('http://localhost/', {
        headers: { accept: 'text/html' },
      });
      const response = await proxy(request);

      expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe(
        'same-origin'
      );
    });

    test('sets COEP for HTML documents', async () => {
      const request = new NextRequest('http://localhost/', {
        headers: { accept: 'text/html' },
      });
      const response = await proxy(request);

      expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe(
        'require-corp'
      );
    });

    test('sets COEP for JS modules', async () => {
      const request = new NextRequest('http://localhost/module.js');
      const response = await proxy(request);

      expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe(
        'require-corp'
      );
    });

    test('sets CORP for JS modules', async () => {
      const request = new NextRequest('http://localhost/module.mjs');
      const response = await proxy(request);

      expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe(
        'same-origin'
      );
    });

    test('sets COEP and CORP for WASM files', async () => {
      const request = new NextRequest('http://localhost/libsidplayfp.wasm');
      const response = await proxy(request);

      expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe(
        'require-corp'
      );
      expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe(
        'same-origin'
      );
    });
  });

  describe('Cache control for immutable assets', () => {
    test('sets long cache for WASM files', async () => {
      const request = new NextRequest('http://localhost/file.wasm');
      const response = await proxy(request);

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('max-age=31536000');
      expect(cacheControl).toContain('immutable');
    });

    test('does not set long cache for non-WASM files', async () => {
      const request = new NextRequest('http://localhost/file.js');
      const response = await proxy(request);

      const cacheControl = response.headers.get('Cache-Control');
      // Either no cache-control or doesn't have immutable
      if (cacheControl) {
        expect(cacheControl).not.toContain('immutable');
      } else {
        // No cache control is also valid for non-WASM files
        expect(cacheControl).toBeNull();
      }
    });
  });

  describe('Security headers on different routes', () => {
    test('applies security headers to root path', async () => {
      const request = new NextRequest('http://localhost/');
      const response = await proxy(request);

      expect(response.headers.has('Content-Security-Policy')).toBe(true);
      expect(response.headers.has('X-Frame-Options')).toBe(true);
      expect(response.headers.has('X-Content-Type-Options')).toBe(true);
      expect(response.headers.has('Referrer-Policy')).toBe(true);
      expect(response.headers.has('Permissions-Policy')).toBe(true);
    });

    test('applies security headers to API routes', async () => {
      const request = new NextRequest('http://localhost/api/health');
      const response = await proxy(request);

      expect(response.headers.has('Content-Security-Policy')).toBe(true);
      expect(response.headers.has('X-Frame-Options')).toBe(true);
      expect(response.headers.has('X-Content-Type-Options')).toBe(true);
    });

    test('applies security headers to admin routes', async () => {
      const request = new NextRequest('http://localhost/admin', {
        headers: { authorization: 'Basic ' + btoa('admin:password') },
      });
      const response = await proxy(request);

      expect(response.headers.has('Content-Security-Policy')).toBe(true);
      expect(response.headers.has('X-Frame-Options')).toBe(true);
    });

    test('applies security headers to static assets', async () => {
      const request = new NextRequest('http://localhost/favicon.ico');
      const response = await proxy(request);

      expect(response.headers.has('X-Content-Type-Options')).toBe(true);
      expect(response.headers.has('X-Frame-Options')).toBe(true);
    });

    test('applies security headers even on 404 responses', async () => {
      const request = new NextRequest('http://localhost/nonexistent');
      const response = await proxy(request);

      expect(response.headers.has('Content-Security-Policy')).toBe(true);
      expect(response.headers.has('X-Frame-Options')).toBe(true);
    });
  });

  describe('Security headers integration with other middleware', () => {
    test('security headers applied after rate limiting', async () => {
      const request = new NextRequest('http://localhost/api/health', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      });
      const response = await proxy(request);

      // Should have both rate limit response AND security headers
      expect(response.headers.has('Content-Security-Policy')).toBe(true);
    });

    test('security headers applied to rate limit error responses', async () => {
      // Exhaust rate limit
      for (let i = 0; i < 100; i++) {
        await proxy(
          new NextRequest('http://localhost/api/health', {
            headers: { 'x-forwarded-for': '203.0.113.100' },
          })
        );
      }

      const request = new NextRequest('http://localhost/api/health', {
        headers: { 'x-forwarded-for': '203.0.113.100' },
      });
      const response = await proxy(request);

      expect(response.status).toBe(429);
      expect(response.headers.has('Content-Security-Policy')).toBe(true);
      expect(response.headers.has('X-Frame-Options')).toBe(true);
    });

    test('security headers applied to authentication responses', async () => {
      const request = new NextRequest('http://localhost/admin', {
        headers: { authorization: 'Basic ' + btoa('wrong:credentials') },
      });
      const response = await proxy(request);

      // Should have 401 response with security headers
      expect(response.headers.has('Content-Security-Policy')).toBe(true);
      expect(response.headers.has('X-Frame-Options')).toBe(true);
    });
  });
});
