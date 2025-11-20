import { describe, it, expect } from 'bun:test';

/**
 * Unit tests for /api/search route
 * 
 * Tests the search API that allows finding SID tracks by title or artist.
 * See packages/sidflow-web/app/api/search/route.ts
 */

describe('/api/search parseSidPath helper', () => {
    /**
     * Helper extracted from route.ts for testing
     * Parse HVSC-style path to extract artist and title
     */
    function parseSidPath(sidPath: string): { artist: string; title: string } {
        const parts = sidPath.split('/');
        const filename = parts[parts.length - 1];
        const title = filename.replace('.sid', '').replace(/_/g, ' ');

        let artist = 'Unknown';
        if (parts.length >= 2) {
            const artistPart = parts[parts.length - 2];
            artist = artistPart.replace(/_/g, ' ');
        }

        return { artist, title };
    }

    it('should parse HVSC path with artist and title', () => {
        const result = parseSidPath('MUSICIANS/Hubbard_Rob/Delta.sid');
        expect(result).toEqual({ artist: 'Hubbard Rob', title: 'Delta' });
    });

    it('should parse path with underscores in filename', () => {
        const result = parseSidPath('MUSICIANS/Hubbard_Rob/Last_Ninja_Theme.sid');
        expect(result).toEqual({ artist: 'Hubbard Rob', title: 'Last Ninja Theme' });
    });

    it('should handle single-level path', () => {
        const result = parseSidPath('Delta.sid');
        expect(result).toEqual({ artist: 'Unknown', title: 'Delta' });
    });

    it('should handle nested paths', () => {
        const result = parseSidPath('MUSICIANS/Hubbard_Rob/Monty_On_The_Run/title.sid');
        expect(result).toEqual({ artist: 'Monty On The Run', title: 'title' });
    });

    it('should handle paths without .sid extension', () => {
        const result = parseSidPath('MUSICIANS/Test_Artist/track');
        expect(result).toEqual({ artist: 'Test Artist', title: 'track' });
    });
});

describe('/api/search query parameter validation', () => {
    function createMockRequest(url: string) {
        const fullUrl = new URL(url);
        return {
            nextUrl: {
                searchParams: fullUrl.searchParams
            }
        } as any;
    }

    it('should require "q" query parameter', async () => {
        const req = createMockRequest('http://localhost:3000/api/search');
        const { GET } = await import('@/app/api/search/route');
        const response = await GET(req);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.error).toBe('Invalid request');
        expect(json.details).toContain('required');
    });

    it('should reject empty query string', async () => {
        const req = createMockRequest('http://localhost:3000/api/search?q=');
        const { GET } = await import('@/app/api/search/route');
        const response = await GET(req);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
    });

    it('should reject whitespace-only query', async () => {
        const req = createMockRequest('http://localhost:3000/api/search?q=   ');
        const { GET } = await import('@/app/api/search/route');
        const response = await GET(req);
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
    });
});

describe('/api/search limit parameter', () => {
    function createMockRequest(url: string) {
        const fullUrl = new URL(url);
        return {
            nextUrl: {
                searchParams: fullUrl.searchParams
            }
        } as any;
    }

    it('should default to 50 results when no limit specified', async () => {
        const req = createMockRequest('http://localhost:3000/api/search?q=test');
        const { GET } = await import('@/app/api/search/route');
        const response = await GET(req);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.data.limit).toBe(50);
    });

    it('should enforce maximum limit of 100', async () => {
        const req = createMockRequest('http://localhost:3000/api/search?q=test&limit=500');
        const { GET } = await import('@/app/api/search/route');
        const response = await GET(req);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.data.limit).toBeLessThanOrEqual(100);
    });

    it('should accept custom limit within range', async () => {
        const req = createMockRequest('http://localhost:3000/api/search?q=test&limit=20');
        const { GET } = await import('@/app/api/search/route');
        const response = await GET(req);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.data.limit).toBe(20);
    });
});

describe('/api/search response format', () => {
    function createMockRequest(url: string) {
        const fullUrl = new URL(url);
        return {
            nextUrl: {
                searchParams: fullUrl.searchParams
            }
        } as any;
    }

    it('should return success response with proper structure', async () => {
        const req = createMockRequest('http://localhost:3000/api/search?q=test');
        const { GET } = await import('@/app/api/search/route');
        const response = await GET(req);
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.data).toBeDefined();
        expect(json.data.query).toBe('test');
        expect(json.data.results).toBeInstanceOf(Array);
        expect(json.data.total).toBeGreaterThanOrEqual(0);
        expect(json.data.limit).toBeGreaterThan(0);
    });

    it('should include matchedIn field for results', async () => {
        const req = createMockRequest('http://localhost:3000/api/search?q=theme');
        const { GET } = await import('@/app/api/search/route');
        const response = await GET(req);
        const json = await response.json();

        if (json.data.results.length > 0) {
            const firstResult = json.data.results[0];
            expect(firstResult).toHaveProperty('sidPath');
            expect(firstResult).toHaveProperty('displayName');
            expect(firstResult).toHaveProperty('artist');
            expect(firstResult).toHaveProperty('matchedIn');
            expect(Array.isArray(firstResult.matchedIn)).toBe(true);
        }
    });

    it('should normalize query to lowercase for matching', async () => {
        const req1 = createMockRequest('http://localhost:3000/api/search?q=THEME');
        const req2 = createMockRequest('http://localhost:3000/api/search?q=theme');
        const { GET } = await import('@/app/api/search/route');

        const response1 = await GET(req1);
        const response2 = await GET(req2);
        const json1 = await response1.json();
        const json2 = await response2.json();

        // Results should be identical regardless of case
        expect(json1.data.total).toBe(json2.data.total);
    });
});
