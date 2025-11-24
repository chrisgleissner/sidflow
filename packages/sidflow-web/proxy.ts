import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  buildUnauthorizedResponseBody,
  getAdminConfig,
  issueSessionToken,
  parseBasicAuth,
  shouldRenewSession,
  validateSessionToken,
  verifyAdminCredentials,
} from '@/lib/server/admin-auth';
import {
  adminRateLimiter,
  defaultRateLimiter,
  getClientIp,
} from '@/lib/server/rate-limiter';

const ADMIN_ROUTE_PATTERN = /^\/(?:admin|api\/admin)(?:\/|$)/;
const API_ROUTE_PATTERN = /^\/api\//;
const MODULE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.wasm']);

function shouldApplyDocumentHeaders(request: NextRequest): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html');
}

function shouldApplyModuleHeaders(pathname: string): boolean {
  const dotIndex = pathname.lastIndexOf('.');
  if (dotIndex === -1) {
    return false;
  }
  const extension = pathname.slice(dotIndex).toLowerCase();
  return MODULE_EXTENSIONS.has(extension);
}

function applySecurityHeaders(request: NextRequest, response: NextResponse): NextResponse {
  const { pathname } = request.nextUrl;

  // Apply Cross-Origin headers for SharedArrayBuffer support
  if (shouldApplyDocumentHeaders(request)) {
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }

  if (shouldApplyModuleHeaders(pathname)) {
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }

  // Cache control for immutable assets
  if (pathname.endsWith('.wasm')) {
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  // Content Security Policy
  // In development we relax script-src/connect-src to allow Next.js dev client and hydration.
  // IMPORTANT: Next.js standalone production builds inject inline hydration scripts that require
  // 'unsafe-inline'. Without it, React won't mount and the app appears broken. In production,
  // set SIDFLOW_RELAXED_CSP=1 for environments that need inline scripts (testing, specific deployments).
  // For maximum security, consider using nonces or hashes instead of 'unsafe-inline' in the future.
  
  // Next.js standalone builds always set NODE_ENV=production internally, even if we pass NODE_ENV=development
  // Therefore, we must use SIDFLOW_RELAXED_CSP=1 to allow inline scripts in testing/CI environments
  const relaxedCsp = process.env.SIDFLOW_RELAXED_CSP === '1';
  const allowInline = relaxedCsp;
  const allowWebSockets = relaxedCsp;
  const scriptSrc = allowInline
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-eval'";
  const connectSrc = allowWebSockets
    ? "connect-src 'self' data: ws: wss:"
    : "connect-src 'self' data:";
  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'", // allow inline styles for Tailwind
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'", // Prevent clickjacking
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  response.headers.set('Content-Security-Policy', csp);

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Referrer policy - send only origin for cross-origin requests
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy - restrict sensitive features
  const permissions = [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
  ].join(', ');
  response.headers.set('Permissions-Policy', permissions);

  // HSTS - enforce HTTPS in production (skip in relaxed CSP mode for testing)
  if (!relaxedCsp) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  return response;
}

async function enforceAdminAuthentication(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  if (!ADMIN_ROUTE_PATTERN.test(pathname)) {
    return null;
  }

  let config;
  try {
    config = getAdminConfig();
  } catch (error) {
    console.error('[admin-auth] Misconfigured admin credentials:', error);
    return applySecurityHeaders(
      request,
      NextResponse.json(
        { error: 'server_error', reason: 'admin-auth-misconfigured' },
        { status: 500 }
      )
    );
  }

  const now = Date.now();
  const existingCookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const sessionValidation = await validateSessionToken(existingCookie, config, now);

  if (sessionValidation.valid && sessionValidation.payload) {
    const response = NextResponse.next();
    if (shouldRenewSession(sessionValidation.payload, config, now)) {
      const { token } = await issueSessionToken(config, now);
      response.cookies.set({
        name: ADMIN_SESSION_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/admin',
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
    }
    return response;
  }

  const credentials = parseBasicAuth(request.headers.get('authorization'));
  if (verifyAdminCredentials(credentials, config)) {
    const { token } = await issueSessionToken(config, now);
    const response = NextResponse.next();
    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/admin',
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });
    return response;
  }

  const response = NextResponse.json(
    buildUnauthorizedResponseBody(sessionValidation.reason ?? 'invalid-credentials'),
    { status: 401 }
  );
  response.headers.set('WWW-Authenticate', 'Basic realm="SIDFlow Admin", charset="UTF-8"');
  if (existingCookie) {
    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: '',
      path: '/admin',
      maxAge: 0,
    });
  }
  return response;
}

/**
 * Enforce rate limiting for API routes.
 */
function enforceRateLimit(request: NextRequest): NextResponse | null {
  const pathname = request.nextUrl.pathname;

  // Only rate limit API routes
  if (!API_ROUTE_PATTERN.test(pathname)) {
    return null;
  }

  // Use stricter rate limit for admin endpoints
  const rateLimiter = ADMIN_ROUTE_PATTERN.test(pathname)
    ? adminRateLimiter
    : defaultRateLimiter;

  const clientIp = getClientIp(request.headers);
  const result = rateLimiter.check(clientIp);

  if (!result.allowed) {
    const response = NextResponse.json(
      {
        error: 'rate_limit_exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter: result.retryAfter,
      },
      { status: 429 }
    );

    response.headers.set('X-RateLimit-Limit', String(rateLimiter['config'].maxRequests));
    response.headers.set('X-RateLimit-Remaining', '0');
    response.headers.set('X-RateLimit-Reset', String(result.resetTime));
    if (result.retryAfter !== undefined) {
      response.headers.set('Retry-After', String(result.retryAfter));
    }

    return response;
  }

  return null;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Check rate limits first
  const rateLimitResponse = enforceRateLimit(request);
  if (rateLimitResponse) {
    return applySecurityHeaders(request, rateLimitResponse);
  }

  // Then enforce authentication
  const conditional = await enforceAdminAuthentication(request);
  if (conditional) {
    return applySecurityHeaders(request, conditional);
  }

  return applySecurityHeaders(request, NextResponse.next());
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
