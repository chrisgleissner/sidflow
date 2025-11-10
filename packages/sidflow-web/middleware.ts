import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware to enable cross-origin isolation for SharedArrayBuffer support.
 * 
 * This is required for:
 * - AudioWorklet with SharedArrayBuffer ring buffers
 * - High-performance lock-free audio streaming
 * 
 * These headers enable `crossOriginIsolated` in the browser, which is required
 * for SharedArrayBuffer to be available in modern browsers.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Enable cross-origin isolation
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

  return response;
}

// Apply to all routes
export const config = {
  matcher: '/:path*',
};
