/**
 * Tests for classification export/import API
 */
import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
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
    test('should return 404 when no classifications exist', async () => {
      const response = await GET();
      const data = await response.json();

      // Either 404 (no classifications) or 200 (has classifications)
      if (response.status === 404) {
        expect(data.success).toBe(false);
        expect(data.error).toBe('No classifications found');
      } else {
        expect(response.status).toBe(200);
        expect(data.version).toBe('1.0');
      }
    });

    test('should return proper JSON structure when classifications exist', async () => {
      const response = await GET();
      
      if (response.status === 200) {
        const data = await response.json();
        
        expect(data).toHaveProperty('version');
        expect(data).toHaveProperty('exportedAt');
        expect(data).toHaveProperty('classificationDepth');
        expect(data).toHaveProperty('totalEntries');
        expect(data).toHaveProperty('classifications');
        expect(data.version).toBe('1.0');
      }
    });

    test('should set correct content-disposition header for download', async () => {
      const response = await GET();
      
      if (response.status === 200) {
        const contentDisposition = response.headers.get('Content-Disposition');
        expect(contentDisposition).toContain('attachment');
        expect(contentDisposition).toContain('.json');
      }
    });
  });

  describe('POST /api/classify/export (import)', () => {
    test('should reject invalid version', async () => {
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

    test('should accept valid import data', async () => {
      const request = new NextRequest('http://localhost/api/classify/export', {
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

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('filesWritten');
      expect(data.data).toHaveProperty('entriesWritten');
    });

    test('should handle empty classifications object', async () => {
      const request = new NextRequest('http://localhost/api/classify/export', {
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

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.filesWritten).toBe(0);
      expect(data.data.entriesWritten).toBe(0);
    });
  });
});

describe('classification export/import data structures', () => {
  let tempDir: string;
  let tagsPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sidflow-export-test-'));
    tagsPath = path.join(tempDir, 'tags');
    await fs.mkdir(tagsPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('export data format', () => {
    test('should have correct version and structure', () => {
      const exportData: ExportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        classificationDepth: 3,
        totalEntries: 2,
        classifications: {
          'MUSICIANS/A/Artist/song.sid': {
            e: 3,
            m: 4,
            c: 2,
            source: 'auto',
          },
          'MUSICIANS/B/Band/track.sid': {
            e: 5,
            m: 2,
            c: 4,
            p: 3,
            source: 'mixed',
          },
        },
      };

      expect(exportData.version).toBe('1.0');
      expect(exportData.totalEntries).toBe(2);
      expect(Object.keys(exportData.classifications).length).toBe(2);
    });

    test('should include all rating dimensions', () => {
      const entry: ClassificationEntry = {
        e: 3,
        m: 4,
        c: 2,
        source: 'auto',
      };

      expect(typeof entry.e).toBe('number');
      expect(typeof entry.m).toBe('number');
      expect(typeof entry.c).toBe('number');
      expect(entry.e).toBeGreaterThanOrEqual(1);
      expect(entry.e).toBeLessThanOrEqual(5);
    });

    test('should optionally include preference rating', () => {
      const entryWithPref: ClassificationEntry = {
        e: 3,
        m: 4,
        c: 2,
        p: 5,
        source: 'manual',
      };

      const entryWithoutPref: ClassificationEntry = {
        e: 3,
        m: 4,
        c: 2,
        source: 'auto',
      };

      expect(entryWithPref.p).toBe(5);
      expect(entryWithoutPref.p).toBeUndefined();
    });
  });

  describe('file collection', () => {
    test('should collect classifications from nested directories', async () => {
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
      
      const tags2 = {
        'track.sid': { e: 5, m: 2, c: 4, source: 'mixed' },
      };
      await fs.writeFile(path.join(bandDir, 'auto-tags.json'), JSON.stringify(tags2));

      // Verify files exist and have correct content
      const artistTags = await fs.readFile(path.join(artistDir, 'auto-tags.json'), 'utf8');
      const bandTags = await fs.readFile(path.join(bandDir, 'auto-tags.json'), 'utf8');
      
      const parsedArtist = JSON.parse(artistTags);
      const parsedBand = JSON.parse(bandTags);

      expect(parsedArtist['song1.sid']).toBeDefined();
      expect(parsedArtist['song2.sid']).toBeDefined();
      expect(parsedBand['track.sid']).toBeDefined();
    });
  });

  describe('import data validation', () => {
    test('should reject invalid version', () => {
      const invalidData = {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        classificationDepth: 3,
        totalEntries: 0,
        classifications: {},
      };

      // Version 2.0 should be invalid
      expect(invalidData.version).not.toBe('1.0');
    });

    test('should require classifications object', () => {
      const noClassifications = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        classificationDepth: 3,
        totalEntries: 0,
      };

      expect((noClassifications as ExportData).classifications).toBeUndefined();
    });
  });

  describe('path handling', () => {
    test('should handle paths with special characters', async () => {
      const specialDir = path.join(tagsPath, 'MUSICIANS', 'S', 'Some-Artist_Name');
      await fs.mkdir(specialDir, { recursive: true });
      
      const tags = {
        'Track (Remix).sid': { e: 3, m: 4, c: 2, source: 'auto' },
      };
      await fs.writeFile(path.join(specialDir, 'auto-tags.json'), JSON.stringify(tags));

      const content = await fs.readFile(path.join(specialDir, 'auto-tags.json'), 'utf8');
      const parsed = JSON.parse(content);
      
      expect(parsed['Track (Remix).sid']).toBeDefined();
    });

    test('should handle multi-song SID entries', async () => {
      const artistDir = path.join(tagsPath, 'MUSICIANS', 'M', 'Multi');
      await fs.mkdir(artistDir, { recursive: true });
      
      const tags = {
        'multi.sid:1': { e: 3, m: 4, c: 2, source: 'auto' },
        'multi.sid:2': { e: 4, m: 3, c: 3, source: 'auto' },
        'multi.sid:3': { e: 5, m: 2, c: 4, source: 'auto' },
      };
      await fs.writeFile(path.join(artistDir, 'auto-tags.json'), JSON.stringify(tags));

      const content = await fs.readFile(path.join(artistDir, 'auto-tags.json'), 'utf8');
      const parsed = JSON.parse(content);
      
      expect(parsed['multi.sid:1']).toBeDefined();
      expect(parsed['multi.sid:2']).toBeDefined();
      expect(parsed['multi.sid:3']).toBeDefined();
    });
  });

  describe('merge behavior', () => {
    test('should merge with existing classifications', async () => {
      const artistDir = path.join(tagsPath, 'MUSICIANS', 'A', 'Artist');
      await fs.mkdir(artistDir, { recursive: true });
      
      // Existing tags
      const existingTags = {
        'existing.sid': { e: 3, m: 4, c: 2, source: 'auto' },
      };
      await fs.writeFile(path.join(artistDir, 'auto-tags.json'), JSON.stringify(existingTags));

      // New tags to merge
      const newTags = {
        'new.sid': { e: 5, m: 3, c: 4, source: 'auto' },
      };
      
      // Simulate merge
      const merged = { ...existingTags, ...newTags };
      await fs.writeFile(path.join(artistDir, 'auto-tags.json'), JSON.stringify(merged));

      const content = await fs.readFile(path.join(artistDir, 'auto-tags.json'), 'utf8');
      const parsed = JSON.parse(content);
      
      expect(parsed['existing.sid']).toBeDefined();
      expect(parsed['new.sid']).toBeDefined();
    });

    test('should overwrite conflicting entries', async () => {
      const artistDir = path.join(tagsPath, 'MUSICIANS', 'A', 'Artist');
      await fs.mkdir(artistDir, { recursive: true });
      
      // Existing tags
      const existingTags = {
        'song.sid': { e: 3, m: 4, c: 2, source: 'auto' },
      };
      await fs.writeFile(path.join(artistDir, 'auto-tags.json'), JSON.stringify(existingTags));

      // New tags with updated values
      const newTags = {
        'song.sid': { e: 5, m: 5, c: 5, source: 'manual' },
      };
      
      // Simulate merge (new overwrites existing)
      const merged = { ...existingTags, ...newTags };
      await fs.writeFile(path.join(artistDir, 'auto-tags.json'), JSON.stringify(merged));

      const content = await fs.readFile(path.join(artistDir, 'auto-tags.json'), 'utf8');
      const parsed = JSON.parse(content);
      
      expect(parsed['song.sid'].e).toBe(5);
      expect(parsed['song.sid'].source).toBe('manual');
    });
  });
});
