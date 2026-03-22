import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GET } from '@/app/api/charts/route';
import { resetServerEnvCacheForTests } from '@/lib/server-env';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { NextRequest } from 'next/server';

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe('Charts API — GET /api/charts', () => {
  let tempRoot: string;
  let originalSidflowRoot: string | undefined;

  beforeEach(async () => {
    tempRoot = path.join(tmpdir(), `sidflow-charts-test-${Date.now()}`);
    await fs.mkdir(tempRoot, { recursive: true });
    originalSidflowRoot = process.env.SIDFLOW_ROOT;
    process.env.SIDFLOW_ROOT = tempRoot;
    resetServerEnvCacheForTests();
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    if (originalSidflowRoot === undefined) {
      delete process.env.SIDFLOW_ROOT;
    } else {
      process.env.SIDFLOW_ROOT = originalSidflowRoot;
    }
    resetServerEnvCacheForTests();
  });

  it('returns empty charts when no feedback directory exists', async () => {
    const response = await GET(makeRequest('http://localhost/api/charts?range=week'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.range).toBe('week');
    expect(data.data.charts).toEqual([]);
  });

  it('defaults to range=week when not specified', async () => {
    const response = await GET(makeRequest('http://localhost/api/charts'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.range).toBe('week');
  });

  it('returns 400 for invalid range', async () => {
    const response = await GET(makeRequest('http://localhost/api/charts?range=yesterday'));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/invalid request/i);
  });

  it('accepts range=month', async () => {
    const response = await GET(makeRequest('http://localhost/api/charts?range=month'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.range).toBe('month');
  });

  it('accepts range=all', async () => {
    const response = await GET(makeRequest('http://localhost/api/charts?range=all'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.range).toBe('all');
  });

  it('respects the limit parameter', async () => {
    // Create feedback data with many plays
    const feedbackDir = path.join(tempRoot, 'data', 'feedback', '2025', '01', '01');
    await fs.mkdir(feedbackDir, { recursive: true });
    const events = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({ ts: '2025-01-15T10:00:00Z', sid_path: `/music/track${i}.sid`, action: 'play' })
    ).join('\n');
    await fs.writeFile(path.join(feedbackDir, 'events.jsonl'), events);

    const response = await GET(makeRequest('http://localhost/api/charts?range=all&limit=5'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.charts.length).toBeLessThanOrEqual(5);
  });

  it('aggregates play counts from feedback files', async () => {
    const feedbackDir = path.join(tempRoot, 'data', 'feedback', '2025', '01', '01');
    await fs.mkdir(feedbackDir, { recursive: true });

    const events = [
      JSON.stringify({ ts: '2025-01-15T10:00:00Z', sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid', action: 'play' }),
      JSON.stringify({ ts: '2025-01-15T11:00:00Z', sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid', action: 'play' }),
      JSON.stringify({ ts: '2025-01-15T12:00:00Z', sid_path: 'MUSICIANS/Galway_Martin/Parallax.sid', action: 'play' }),
      // like events should NOT be counted
      JSON.stringify({ ts: '2025-01-15T13:00:00Z', sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid', action: 'like' }),
    ].join('\n');
    await fs.writeFile(path.join(feedbackDir, 'events.jsonl'), events);

    // Use a unique limit (97) so this test does not share chartsCache key with other tests
    const response = await GET(makeRequest('http://localhost/api/charts?range=all&limit=97'));
    const data = await response.json();

    expect(response.status).toBe(200);
    const charts = data.data.charts as Array<{ sidPath: string; playCount: number; displayName: string; artist: string }>;
    expect(charts.length).toBe(2);

    const delta = charts.find((c) => c.sidPath === 'MUSICIANS/Hubbard_Rob/Delta.sid');
    expect(delta).toBeDefined();
    expect(delta!.playCount).toBe(2);
    expect(delta!.displayName).toBe('Delta');
    expect(delta!.artist).toBe('Hubbard Rob');

    const parallax = charts.find((c) => c.sidPath === 'MUSICIANS/Galway_Martin/Parallax.sid');
    expect(parallax).toBeDefined();
    expect(parallax!.playCount).toBe(1);
  });

  it('skips malformed lines in feedback files gracefully', async () => {
    const feedbackDir = path.join(tempRoot, 'data', 'feedback', '2025', '01', '01');
    await fs.mkdir(feedbackDir, { recursive: true });

    const events = [
      'not valid json',
      JSON.stringify({ ts: '2025-01-15T10:00:00Z', sid_path: '/music/a.sid', action: 'play' }),
      '{broken:',
    ].join('\n');
    await fs.writeFile(path.join(feedbackDir, 'events.jsonl'), events);

    // Use a unique limit (98) so this test does not share chartsCache key with other tests
    const response = await GET(makeRequest('http://localhost/api/charts?range=all&limit=98'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.charts.length).toBe(1);
    expect(data.data.charts[0].sidPath).toBe('/music/a.sid');
  });

  it('includes Cache-Control header in the response', async () => {
    const response = await GET(makeRequest('http://localhost/api/charts?range=week'));

    const cacheControl = response.headers.get('Cache-Control');
    expect(cacheControl).toBeTruthy();
  });

  it('returns sorted results with most-played first', async () => {
    const feedbackDir = path.join(tempRoot, 'data', 'feedback', '2025', '01', '01');
    await fs.mkdir(feedbackDir, { recursive: true });

    // Track A: 1 play, Track B: 3 plays
    const events = [
      JSON.stringify({ ts: '2025-01-15T10:00:00Z', sid_path: '/a.sid', action: 'play' }),
      JSON.stringify({ ts: '2025-01-15T10:01:00Z', sid_path: '/b.sid', action: 'play' }),
      JSON.stringify({ ts: '2025-01-15T10:02:00Z', sid_path: '/b.sid', action: 'play' }),
      JSON.stringify({ ts: '2025-01-15T10:03:00Z', sid_path: '/b.sid', action: 'play' }),
    ].join('\n');
    await fs.writeFile(path.join(feedbackDir, 'events.jsonl'), events);

    // Use a unique limit (96) so this test does not share chartsCache key with other tests
    const response = await GET(makeRequest('http://localhost/api/charts?range=all&limit=96'));
    const data = await response.json();

    expect(data.data.charts[0].sidPath).toBe('/b.sid');
    expect(data.data.charts[0].playCount).toBe(3);
    expect(data.data.charts[1].sidPath).toBe('/a.sid');
  });

  it('handles non-ENOENT feedback dir error gracefully (e.g., feedback dir is a file)', async () => {
    // Create data/feedback as a FILE (not a directory) — readdir will throw ENOTDIR, not ENOENT
    // This triggers the non-ENOENT re-throw at line 75, caught by outer catch at line 128
    const dataDir = path.join(tempRoot, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'feedback'), 'not-a-directory');

    const response = await GET(makeRequest('http://localhost/api/charts?range=all&limit=1'));
    const data = await response.json();

    // aggregatePlayCounts catches the error and warns; GET returns success with empty charts
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.charts).toEqual([]);
  });

  it('skips unreadable day-level event files gracefully', async () => {
    // Create a valid year/month dir structure but make the events.jsonl a directory
    const yearMonthDir = path.join(tempRoot, 'data', 'feedback', '2025', '01');
    const dayDir = path.join(yearMonthDir, '10');
    await fs.mkdir(dayDir, { recursive: true });
    // Make events.jsonl a directory — readFile will throw EISDIR, not ENOENT → caught at line 121
    await fs.mkdir(path.join(dayDir, 'events.jsonl'), { recursive: true });

    const response = await GET(makeRequest('http://localhost/api/charts?range=all&limit=95'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.charts).toEqual([]);
  });
});
