import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GET, POST, DELETE } from '@/app/api/favorites/route';
import { getWebPreferences, updateWebPreferences } from '@/lib/preferences-store';
import { promises as fs } from 'node:fs';
import path from 'node:path';

describe('Favorites API', () => {
  const testPrefsPath = path.join(process.cwd(), '.sidflow-preferences-test.json');

  beforeEach(async () => {
    // Clean up any existing test preferences file
    try {
      await fs.unlink(testPrefsPath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
    
    // Override preferences path for testing
    process.env.SIDFLOW_PREFS_PATH = testPrefsPath;
  });

  afterEach(async () => {
    // Clean up test preferences file
    try {
      await fs.unlink(testPrefsPath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
    
    // Restore environment
    delete process.env.SIDFLOW_PREFS_PATH;
  });

  describe('GET /api/favorites', () => {
    it('should return empty favorites array initially', async () => {
      const response = await GET();
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data.favorites).toEqual([]);
    });

    it('should return existing favorites', async () => {
      // Setup: add some favorites
      await updateWebPreferences({ favorites: ['MUSICIANS/Hubbard_Rob/Delta.sid', 'MUSICIANS/Galway_Martin/Parallax.sid'] });
      
      const response = await GET();
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data.favorites).toHaveLength(2);
      expect(data.data.favorites).toContain('MUSICIANS/Hubbard_Rob/Delta.sid');
      expect(data.data.favorites).toContain('MUSICIANS/Galway_Martin/Parallax.sid');
    });
  });

  describe('POST /api/favorites', () => {
    it('should add a new favorite', async () => {
      const request = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid' }),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const response = await POST(request as any);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data.added).toBe(true);
      expect(data.data.favorites).toContain('MUSICIANS/Hubbard_Rob/Delta.sid');
      
      // Verify it was actually saved
      const prefs = await getWebPreferences();
      expect(prefs.favorites).toContain('MUSICIANS/Hubbard_Rob/Delta.sid');
    });

    it('should not add duplicate favorites', async () => {
      // Setup: add a favorite first
      await updateWebPreferences({ favorites: ['MUSICIANS/Hubbard_Rob/Delta.sid'] });
      
      const request = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid' }),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const response = await POST(request as any);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data.added).toBe(false);
      expect(data.data.message).toBe('Already in favorites');
      expect(data.data.favorites).toHaveLength(1);
    });

    it('should return error for invalid request (missing sid_path)', async () => {
      const request = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const response = await POST(request as any);
      const data = await response.json();
      
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid request');
      expect(response.status).toBe(400);
    });

    it('should return error for invalid sid_path type', async () => {
      const request = new Request('http://localhost/api/favorites', {
        method: 'POST',
        body: JSON.stringify({ sid_path: 123 }),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const response = await POST(request as any);
      const data = await response.json();
      
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid request');
      expect(response.status).toBe(400);
    });

    it('should handle multiple favorites', async () => {
      const paths = [
        'MUSICIANS/Hubbard_Rob/Delta.sid',
        'MUSICIANS/Galway_Martin/Parallax.sid',
        'MUSICIANS/Daglish_Ben/The_Last_Ninja.sid',
      ];
      
      for (const sidPath of paths) {
        const request = new Request('http://localhost/api/favorites', {
          method: 'POST',
          body: JSON.stringify({ sid_path: sidPath }),
          headers: { 'Content-Type': 'application/json' },
        });
        await POST(request as any);
      }
      
      const prefs = await getWebPreferences();
      expect(prefs.favorites).toHaveLength(3);
      paths.forEach(p => expect(prefs.favorites).toContain(p));
    });
  });

  describe('DELETE /api/favorites', () => {
    it('should remove an existing favorite', async () => {
      // Setup: add favorites
      await updateWebPreferences({ 
        favorites: ['MUSICIANS/Hubbard_Rob/Delta.sid', 'MUSICIANS/Galway_Martin/Parallax.sid'] 
      });
      
      const request = new Request('http://localhost/api/favorites', {
        method: 'DELETE',
        body: JSON.stringify({ sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid' }),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const response = await DELETE(request as any);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data.removed).toBe(true);
      expect(data.data.favorites).toHaveLength(1);
      expect(data.data.favorites).not.toContain('MUSICIANS/Hubbard_Rob/Delta.sid');
      expect(data.data.favorites).toContain('MUSICIANS/Galway_Martin/Parallax.sid');
    });

    it('should handle removing non-existent favorite', async () => {
      await updateWebPreferences({ favorites: ['MUSICIANS/Galway_Martin/Parallax.sid'] });
      
      const request = new Request('http://localhost/api/favorites', {
        method: 'DELETE',
        body: JSON.stringify({ sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid' }),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const response = await DELETE(request as any);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data.removed).toBe(false);
      expect(data.data.favorites).toHaveLength(1);
    });

    it('should return error for invalid request (missing sid_path)', async () => {
      const request = new Request('http://localhost/api/favorites', {
        method: 'DELETE',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const response = await DELETE(request as any);
      const data = await response.json();
      
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid request');
      expect(response.status).toBe(400);
    });

    it('should clear all favorites when removing last one', async () => {
      await updateWebPreferences({ favorites: ['MUSICIANS/Hubbard_Rob/Delta.sid'] });
      
      const request = new Request('http://localhost/api/favorites', {
        method: 'DELETE',
        body: JSON.stringify({ sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid' }),
        headers: { 'Content-Type': 'application/json' },
      });
      
      const response = await DELETE(request as any);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.data.removed).toBe(true);
      expect(data.data.favorites).toHaveLength(0);
      
      const prefs = await getWebPreferences();
      expect(prefs.favorites).toEqual([]);
    });
  });
});
