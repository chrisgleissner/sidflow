import { describe, it, expect } from 'bun:test';

/**
 * Unit tests for /api/charts route
 * 
 * Tests the charts API that shows top played tracks from feedback data.
 * See packages/sidflow-web/app/api/charts/route.ts
 */

describe('/api/charts parseSidPath helper', () => {
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
});

describe('/api/charts range parameter validation', () => {
  function createMockRequest(url: string) {
    const fullUrl = new URL(url);
    return {
      nextUrl: {
        searchParams: fullUrl.searchParams
      }
    } as any;
  }

  it('should default to "week" when no range specified', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.data.range).toBe('week');
  });

  it('should accept valid range: week', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts?range=week');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.data.range).toBe('week');
  });

  it('should accept valid range: month', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts?range=month');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.data.range).toBe('month');
  });

  it('should accept valid range: all', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts?range=all');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.data.range).toBe('all');
  });

  it('should reject invalid range', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts?range=invalid');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Invalid request');
    expect(json.details).toContain('Range must be one of');
  });
});

describe('/api/charts limit parameter', () => {
  function createMockRequest(url: string) {
    const fullUrl = new URL(url);
    return {
      nextUrl: {
        searchParams: fullUrl.searchParams
      }
    } as any;
  }

  it('should default to 20 results when no limit specified', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.data.charts.length).toBeLessThanOrEqual(20);
  });

  it('should enforce maximum limit of 100', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts?limit=500');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.data.charts.length).toBeLessThanOrEqual(100);
  });

  it('should accept custom limit within range', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts?limit=10');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.data.charts.length).toBeLessThanOrEqual(10);
  });
});

describe('/api/charts response format', () => {
  function createMockRequest(url: string) {
    const fullUrl = new URL(url);
    return {
      nextUrl: {
        searchParams: fullUrl.searchParams
      }
    } as any;
  }

  it('should return success response with proper structure', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data.range).toBeDefined();
    expect(json.data.charts).toBeInstanceOf(Array);
  });

  it('should include required fields in chart entries', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    if (json.data.charts.length > 0) {
      const firstEntry = json.data.charts[0];
      expect(firstEntry).toHaveProperty('sidPath');
      expect(firstEntry).toHaveProperty('playCount');
      expect(firstEntry).toHaveProperty('displayName');
      expect(firstEntry).toHaveProperty('artist');
      expect(typeof firstEntry.playCount).toBe('number');
      expect(firstEntry.playCount).toBeGreaterThan(0);
    }
  });

  it('should return charts sorted by play count descending', async () => {
    const req = createMockRequest('http://localhost:3000/api/charts');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    const charts = json.data.charts;
    if (charts.length > 1) {
      for (let i = 0; i < charts.length - 1; i++) {
        expect(charts[i].playCount).toBeGreaterThanOrEqual(charts[i + 1].playCount);
      }
    }
  });

  it('should handle empty feedback gracefully', async () => {
    // When no feedback exists, should return empty charts
    const req = createMockRequest('http://localhost:3000/api/charts?range=all');
    const { GET } = await import('@/app/api/charts/route');
    const response = await GET(req);
    const json = await response.json();
    
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.charts)).toBe(true);
  });
});
