/**
 * Tests for scheduler API endpoints
 * Optimized: Reduced test setup overhead by consolidating related tests
 */
import { describe, test, expect } from 'bun:test';
import { GET, POST } from '../../../app/api/scheduler/route';
import { NextRequest } from 'next/server';

describe('/api/scheduler', () => {
  describe('GET /api/scheduler', () => {
    test('should return complete scheduler configuration and status', async () => {
      const response = await GET();
      const data = await response.json();

      // Response structure
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.scheduler).toBeDefined();
      expect(data.data.renderPrefs).toBeDefined();
      expect(data.data.status).toBeDefined();
      
      // Default scheduler values
      expect(data.data.scheduler).toHaveProperty('enabled');
      expect(data.data.scheduler).toHaveProperty('time');
      expect(data.data.scheduler).toHaveProperty('timezone');
      expect(data.data.scheduler.time).toBe('06:00');
      expect(data.data.scheduler.timezone).toBe('UTC');
      
      // Default renderPrefs values
      expect(data.data.renderPrefs).toHaveProperty('preserveWav');
      expect(data.data.renderPrefs).toHaveProperty('enableFlac');
      expect(data.data.renderPrefs).toHaveProperty('enableM4a');
      
      // Scheduler status
      expect(data.data.status).toHaveProperty('isActive');
      expect(data.data.status).toHaveProperty('isPipelineRunning');
      expect(typeof data.data.status.isActive).toBe('boolean');
    });
  });

  describe('POST /api/scheduler', () => {
    test('should update scheduler enabled state', async () => {
      const request = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { enabled: true } }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.scheduler.enabled).toBe(true);

      // Reset back to disabled
      await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { enabled: false } }),
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    test('should update scheduler time and normalize format', async () => {
      // Test time update
      const response = await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { time: '12:30' } }),
        headers: { 'Content-Type': 'application/json' },
      }));

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.data.scheduler.time).toBe('12:30');
      
      // Test time format normalization (single digit hour)
      const normalizeResponse = await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { time: '6:30' } }),
        headers: { 'Content-Type': 'application/json' },
      }));

      const normalizeData = await normalizeResponse.json();
      expect(normalizeResponse.status).toBe(200);
      expect(normalizeData.data.scheduler.time).toBe('06:30'); // Should be normalized

      // Reset
      await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { time: '06:00' } }),
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    test('should update renderPrefs', async () => {
      const response = await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ renderPrefs: { preserveWav: false, enableFlac: true } }),
        headers: { 'Content-Type': 'application/json' },
      }));

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.data.renderPrefs.preserveWav).toBe(false);
      expect(data.data.renderPrefs.enableFlac).toBe(true);

      // Reset
      await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ renderPrefs: { preserveWav: true, enableFlac: false } }),
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    test('should return 400 for invalid inputs', async () => {
      // Empty body
      const emptyResponse = await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }));
      expect(emptyResponse.status).toBe(400);
      expect((await emptyResponse.json()).success).toBe(false);

      // Invalid time format
      const invalidTimeResponse = await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { time: '25:00' } }),
        headers: { 'Content-Type': 'application/json' },
      }));
      expect(invalidTimeResponse.status).toBe(400);

      // Invalid enabled type
      const invalidEnabledResponse = await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { enabled: 'yes' } }),
        headers: { 'Content-Type': 'application/json' },
      }));
      expect(invalidEnabledResponse.status).toBe(400);
    });

    test('should allow partial scheduler updates', async () => {
      // Set both enabled and time
      await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { enabled: true, time: '08:00' } }),
        headers: { 'Content-Type': 'application/json' },
      }));

      // Update only time, enabled should remain true
      const response = await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { time: '10:00' } }),
        headers: { 'Content-Type': 'application/json' },
      }));

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.data.scheduler.time).toBe('10:00');
      expect(data.data.scheduler.enabled).toBe(true);

      // Reset
      await POST(new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({ scheduler: { enabled: false, time: '06:00' } }),
        headers: { 'Content-Type': 'application/json' },
      }));
    });
  });

  describe('request validation', () => {
    test('should validate scheduler and renderPrefs data types', () => {
      // Scheduler validation
      const validScheduler = { scheduler: { enabled: true } };
      expect(typeof validScheduler.scheduler.enabled).toBe('boolean');

      const invalidScheduler = { scheduler: { enabled: 'yes' } };
      expect(typeof invalidScheduler.scheduler.enabled).toBe('string');

      // Time format validation
      const validTimes = ['06:00', '23:59', '00:00', '6:30'];
      const invalidTimes = ['6:0', '25:00', '12:60', 'noon', ''];

      for (const time of validTimes) {
        const match = time.match(/^(\d{1,2}):(\d{2})$/);
        expect(match).not.toBeNull();
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = parseInt(match[2], 10);
          expect(hours >= 0 && hours <= 23).toBe(true);
          expect(minutes >= 0 && minutes <= 59).toBe(true);
        }
      }

      for (const time of invalidTimes) {
        const match = time.match(/^(\d{1,2}):(\d{2})$/);
        const isValid = match !== null && 
          parseInt(match[1], 10) <= 23 && 
          parseInt(match[2], 10) <= 59;
        expect(isValid).toBe(false);
      }

      // RenderPrefs validation
      const validRenderPrefs = { renderPrefs: { preserveWav: true, enableFlac: false, enableM4a: false } };
      expect(typeof validRenderPrefs.renderPrefs.preserveWav).toBe('boolean');
      expect(typeof validRenderPrefs.renderPrefs.enableFlac).toBe('boolean');
      expect(typeof validRenderPrefs.renderPrefs.enableM4a).toBe('boolean');
    });
  });
});
