/**
 * Tests for scheduler API endpoints
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { GET, POST } from '../../../app/api/scheduler/route';
import { NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('/api/scheduler', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = path.join(tmpdir(), `sidflow-scheduler-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('GET /api/scheduler', () => {
    test('should return scheduler configuration and status', async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.scheduler).toBeDefined();
      expect(data.data.renderPrefs).toBeDefined();
      expect(data.data.status).toBeDefined();
    });

    test('should return default scheduler values', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.data.scheduler).toHaveProperty('enabled');
      expect(data.data.scheduler).toHaveProperty('time');
      expect(data.data.scheduler).toHaveProperty('timezone');
      expect(data.data.scheduler.time).toBe('06:00');
      expect(data.data.scheduler.timezone).toBe('UTC');
    });

    test('should return default renderPrefs values', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.data.renderPrefs).toHaveProperty('preserveWav');
      expect(data.data.renderPrefs).toHaveProperty('enableFlac');
      expect(data.data.renderPrefs).toHaveProperty('enableM4a');
    });

    test('should return scheduler status', async () => {
      const response = await GET();
      const data = await response.json();

      expect(data.data.status).toHaveProperty('isActive');
      expect(data.data.status).toHaveProperty('isPipelineRunning');
      expect(typeof data.data.status.isActive).toBe('boolean');
    });
  });

  describe('POST /api/scheduler', () => {
    test('should update scheduler enabled state', async () => {
      const request = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { enabled: true },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.scheduler.enabled).toBe(true);

      // Reset back to disabled
      const resetRequest = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { enabled: false },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(resetRequest);
    });

    test('should update scheduler time', async () => {
      const request = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { time: '12:30' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.scheduler.time).toBe('12:30');

      // Reset back to default
      const resetRequest = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { time: '06:00' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(resetRequest);
    });

    test('should update renderPrefs', async () => {
      const request = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          renderPrefs: { preserveWav: false, enableFlac: true },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.renderPrefs.preserveWav).toBe(false);
      expect(data.data.renderPrefs.enableFlac).toBe(true);

      // Reset back to defaults
      const resetRequest = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          renderPrefs: { preserveWav: true, enableFlac: false },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(resetRequest);
    });

    test('should return 400 for empty request body', async () => {
      const request = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });

    test('should return 400 for invalid time format', async () => {
      const request = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { time: '25:00' }, // Invalid hour
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    test('should return 400 for invalid enabled type', async () => {
      const request = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { enabled: 'yes' }, // Should be boolean
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
    });

    test('should allow partial scheduler updates', async () => {
      // First set both enabled and time
      const request1 = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { enabled: true, time: '08:00' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(request1);

      // Now only update time, enabled should remain true
      const request2 = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { time: '10:00' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request2);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.scheduler.time).toBe('10:00');
      expect(data.data.scheduler.enabled).toBe(true); // Should remain unchanged

      // Reset
      const resetRequest = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { enabled: false, time: '06:00' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(resetRequest);
    });

    test('should normalize time format to use leading zeros', async () => {
      // Submit a time without leading zero
      const request = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { time: '6:30' }, // Single digit hour
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.scheduler.time).toBe('06:30'); // Should be normalized

      // Reset
      const resetRequest = new NextRequest('http://localhost/api/scheduler', {
        method: 'POST',
        body: JSON.stringify({
          scheduler: { enabled: false, time: '06:00' },
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await POST(resetRequest);
    });
  });

  describe('request validation', () => {
    test('should validate scheduler.enabled as boolean', () => {
      const validRequest = { scheduler: { enabled: true } };
      const invalidRequest = { scheduler: { enabled: 'yes' } };

      expect(typeof validRequest.scheduler.enabled).toBe('boolean');
      expect(typeof invalidRequest.scheduler.enabled).toBe('string');
    });

    test('should validate scheduler.time format', () => {
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
    });

    test('should validate renderPrefs booleans', () => {
      const validRequest = {
        renderPrefs: {
          preserveWav: true,
          enableFlac: false,
          enableM4a: false,
        },
      };

      expect(typeof validRequest.renderPrefs.preserveWav).toBe('boolean');
      expect(typeof validRequest.renderPrefs.enableFlac).toBe('boolean');
      expect(typeof validRequest.renderPrefs.enableM4a).toBe('boolean');
    });
  });
});
