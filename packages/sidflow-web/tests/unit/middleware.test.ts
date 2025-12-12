import { describe, expect, it } from 'bun:test';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

function createRequest(pathname: string, headers?: Record<string, string>): NextRequest {
    const url = new URL(`http://localhost${pathname}`);
    const init: RequestInit = headers ? { headers: new Headers(headers) } : {};
    const baseRequest = new Request(url, init);
    return new NextRequest(baseRequest);
}

describe('proxy security headers', () => {
    it('applies COOP/COEP for HTML responses', async () => {
        const request = createRequest('/', { Accept: 'text/html' });
        const response = await proxy(request);
        expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
        expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    });

    it('applies resource policy for WASM assets', async () => {
        const request = createRequest('/wasm/libsidplayfp.wasm');
        const response = await proxy(request);
        expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
        expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    });

    it('does not add isolation headers for non-HTML without extensions', async () => {
        const request = createRequest('/api/status', { Accept: 'application/json' });
        const response = await proxy(request);
        expect(response.headers.get('Cross-Origin-Opener-Policy')).toBeNull();
    });
});
