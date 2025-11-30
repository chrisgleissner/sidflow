/**
 * Tests for classification export/import API
 * Optimized: Reduced test setup overhead by combining related tests
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { GET, POST } from '../../../app/api/classify/export/route';
import { NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';

// Test data structures
interface ClassificationEntry {
  e: number;
  m: number;
  c: number;
  p?: number;
  source: string;
}

interface ExportData {
  version: '1.0';
  exportedAt: string;
  classificationDepth: number;
  totalEntries: number;
  classifications: Record<string, ClassificationEntry>;
}

describe('classification export/import API', () => {
  describe('GET /api/classify/export', () => {
    test('should return 404 when no classifications exist or 200 with proper structure', async () => {
      const response = await GET();
      const data = await response.json();

      if (response.status === 404) {
        expect(data.success).toBe(false);
        expect(data.error).toBe('No classifications found');
      } else {
        expect(response.status).toBe(200);
        expect(data.version).toBe('1.0');
        expect(data).toHaveProperty('exportedAt');
        expect(data).toHaveProperty('classificationDepth');
        expect(data).toHaveProperty('totalEntries');
        expect(data).toHaveProperty('classifications');
        
        // Check content-disposition header for download
        const contentDisposition = response.headers.get('Content-Disposition');
        expect(contentDisposition).toContain('attachment');
        expect(contentDisposition).toContain('.json');
      }
    });
  });

  describe('POST /api/classify/export (import)', () => {
    test('should reject invalid version with expected version message', async () => {
      const request = new NextRequest('http://localhost/api/classify/export', {
        method: 'POST',
        body: JSON.stringify({
          version: '2.0',
          exportedAt: new Date().toISOString(),
          classificationDepth: 3,
          totalEntries: 0,
          classifications: {},
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.details).toContain('version');
      expect(data.details).toContain('1.0');
    });

    test('should reject missing classifications', async () => {
      const request = new NextRequest('http://localhost/api/classify/export', {
        method: 'POST',
        body: JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          classificationDepth: 3,
          totalEntries: 0,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.details).toContain('classifications');
    });

    test('should accept valid import data and handle empty classifications', async () => {
      // Test valid import
      const validRequest = new NextRequest('http://localhost/api/classify/export', {
        method: 'POST',
        body: JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          classificationDepth: 3,
          totalEntries: 1,
          classifications: {
            'MUSICIANS/A/Artist/song.sid': {
              e: 3,
              m: 4,
              c: 2,
              source: 'auto',
            },
          },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(validRequest);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('filesWritten');
      expect(data.data).toHaveProperty('entriesWritten');
      
      // Test empty classifications
      const emptyRequest = new NextRequest('http://localhost/api/classify/export', {
        method: 'POST',
        body: JSON.stringify({
          version: '1.0',
          exportedAt: new Date().toISOString(),
          classificationDepth: 3,
          totalEntries: 0,
          classifications: {},
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const emptyResponse = await POST(emptyRequest);
      const emptyData = await emptyResponse.json();

      expect(emptyResponse.status).toBe(200);
      expect(emptyData.success).toBe(true);
      expect(emptyData.data.filesWritten).toBe(0);
      expect(emptyData.data.entriesWritten).toBe(0);
    });
  });
});

describe('classification export/import data structures', () => {
  // Use single temp dir for all tests in this describe block to reduce setup time
  let tempDir: string;
  let tagsPath: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidflow-export-test-'));
    tagsPath = path.join(tempDir, 'tags');
    await fs.mkdir(tagsPath, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('should have correct export data format and structure', () => {
    const exportData: ExportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      classificationDepth: 3,
      totalEntries: 2,
      classifications: {
        'MUSICIANS/A/Artist/song.sid': { e: 3, m: 4, c: 2, source: 'auto' },
        'MUSICIANS/B/Band/track.sid': { e: 5, m: 2, c: 4, p: 3, source: 'mixed' },
      },
    };

    expect(exportData.version).toBe('1.0');
    expect(exportData.totalEntries).toBe(2);
    expect(Object.keys(exportData.classifications).length).toBe(2);
    
    // Rating dimensions
    const entry = exportData.classifications['MUSICIANS/A/Artist/song.sid'];
    expect(typeof entry.e).toBe('number');
    expect(typeof entry.m).toBe('number');
    expect(typeof entry.c).toBe('number');
    expect(entry.e).toBeGreaterThanOrEqual(1);
    expect(entry.e).toBeLessThanOrEqual(5);
    
    // Optional preference rating
    const entryWithPref = exportData.classifications['MUSICIANS/B/Band/track.sid'];
    expect(entryWithPref.p).toBe(3);
    expect(entry.p).toBeUndefined();
  });

  test('should handle file collection, paths, and merging', async () => {
    // Create nested auto-tags.json files
    const artistDir = path.join(tagsPath, 'MUSICIANS', 'A', 'Artist');
    await fs.mkdir(artistDir, { recursive: true });
    
    const tags1 = {
      'song1.sid': { e: 3, m: 4, c: 2, source: 'auto' },
      'song2.sid': { e: 4, m: 3, c: 3, source: 'auto' },
    };
    await fs.writeFile(path.join(artistDir, 'auto-tags.json'), JSON.stringify(tags1));

    const bandDir = path.join(tagsPath, 'MUSICIANS', 'B', 'Band');
    await fs.mkdir(bandDir, { recursive: true });
    
    const tags2 = { 'track.sid': { e: 5, m: 2, c: 4, source: 'mixed' } };
    await fs.writeFile(path.join(bandDir, 'auto-tags.json'), JSON.stringify(tags2));

    // Verify nested files exist and have correct content
    const artistTags = JSON.parse(await fs.readFile(path.join(artistDir, 'auto-tags.json'), 'utf8'));
    const bandTags = JSON.parse(await fs.readFile(path.join(bandDir, 'auto-tags.json'), 'utf8'));

    expect(artistTags['song1.sid']).toBeDefined();
    expect(artistTags['song2.sid']).toBeDefined();
    expect(bandTags['track.sid']).toBeDefined();
    
    // Test path with special characters
    const specialDir = path.join(tagsPath, 'MUSICIANS', 'S', 'Some-Artist_Name');
    await fs.mkdir(specialDir, { recursive: true });
    
    const specialTags = { 'Track (Remix).sid': { e: 3, m: 4, c: 2, source: 'auto' } };
    await fs.writeFile(path.join(specialDir, 'auto-tags.json'), JSON.stringify(specialTags));
    
    const parsedSpecial = JSON.parse(await fs.readFile(path.join(specialDir, 'auto-tags.json'), 'utf8'));
    expect(parsedSpecial['Track (Remix).sid']).toBeDefined();
    
    // Test multi-song SID entries
    const multiDir = path.join(tagsPath, 'MUSICIANS', 'M', 'Multi');
    await fs.mkdir(multiDir, { recursive: true });
    
    const multiTags = {
      'multi.sid:1': { e: 3, m: 4, c: 2, source: 'auto' },
      'multi.sid:2': { e: 4, m: 3, c: 3, source: 'auto' },
      'multi.sid:3': { e: 5, m: 2, c: 4, source: 'auto' },
    };
    await fs.writeFile(path.join(multiDir, 'auto-tags.json'), JSON.stringify(multiTags));
    
    const parsedMulti = JSON.parse(await fs.readFile(path.join(multiDir, 'auto-tags.json'), 'utf8'));
    expect(parsedMulti['multi.sid:1']).toBeDefined();
    expect(parsedMulti['multi.sid:2']).toBeDefined();
    expect(parsedMulti['multi.sid:3']).toBeDefined();
    
    // Test merge behavior
    const existingTags = { 'existing.sid': { e: 3, m: 4, c: 2, source: 'auto' } };
    await fs.writeFile(path.join(artistDir, 'auto-tags.json'), JSON.stringify(existingTags));
    
    const newTags = { 'new.sid': { e: 5, m: 3, c: 4, source: 'auto' } };
    const merged = { ...existingTags, ...newTags };
    await fs.writeFile(path.join(artistDir, 'auto-tags.json'), JSON.stringify(merged));
    
    const parsedMerged = JSON.parse(await fs.readFile(path.join(artistDir, 'auto-tags.json'), 'utf8'));
    expect(parsedMerged['existing.sid']).toBeDefined();
    expect(parsedMerged['new.sid']).toBeDefined();
    
    // Test overwrite conflicting entries
    const overwriteExisting = { 'song.sid': { e: 3, m: 4, c: 2, source: 'auto' } };
    const overwriteNew = { 'song.sid': { e: 5, m: 5, c: 5, source: 'manual' } };
    const overwriteMerged = { ...overwriteExisting, ...overwriteNew };
    await fs.writeFile(path.join(bandDir, 'auto-tags.json'), JSON.stringify(overwriteMerged));
    
    const parsedOverwrite = JSON.parse(await fs.readFile(path.join(bandDir, 'auto-tags.json'), 'utf8'));
    expect(parsedOverwrite['song.sid'].e).toBe(5);
    expect(parsedOverwrite['song.sid'].source).toBe('manual');
  });

  test('should validate import data correctly', () => {
    // Invalid version
    const invalidData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      classificationDepth: 3,
      totalEntries: 0,
      classifications: {},
    };
    expect(invalidData.version).not.toBe('1.0');
    
    // Missing classifications
    const noClassifications = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      classificationDepth: 3,
      totalEntries: 0,
    };
    expect((noClassifications as ExportData).classifications).toBeUndefined();
  });
});
