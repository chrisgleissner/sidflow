import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Proxy that enables cross-origin isolation so SharedArrayBuffer can be used
 * for the audio worklet <-> worker ring buffer.
 */
export function proxy(_request: NextRequest) {
    const response = NextResponse.next();

    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

    return response;
}

export const config = {
    matcher: '/:path*',
};
