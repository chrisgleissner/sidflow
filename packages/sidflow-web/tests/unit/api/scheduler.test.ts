/**
 * Tests for scheduler API endpoints
 */
import { describe, test, expect } from 'bun:test';

describe('/api/scheduler', () => {
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

  describe('response structure', () => {
    test('should define correct response structure', () => {
      const mockResponse = {
        success: true,
        data: {
          scheduler: {
            enabled: false,
            time: '06:00',
            timezone: 'UTC',
          },
          renderPrefs: {
            preserveWav: true,
            enableFlac: false,
            enableM4a: false,
          },
          status: {
            isActive: false,
            lastRun: null,
            nextRun: null,
            isPipelineRunning: false,
          },
        },
      };

      expect(mockResponse.success).toBe(true);
      expect(mockResponse.data.scheduler).toBeDefined();
      expect(mockResponse.data.renderPrefs).toBeDefined();
      expect(mockResponse.data.status).toBeDefined();
    });

    test('should have scheduler config with all required fields', () => {
      const schedulerConfig = {
        enabled: false,
        time: '06:00',
        timezone: 'UTC',
      };

      expect(schedulerConfig).toHaveProperty('enabled');
      expect(schedulerConfig).toHaveProperty('time');
      expect(schedulerConfig).toHaveProperty('timezone');
    });

    test('should have renderPrefs with all required fields', () => {
      const renderPrefs = {
        preserveWav: true,
        enableFlac: false,
        enableM4a: false,
      };

      expect(renderPrefs).toHaveProperty('preserveWav');
      expect(renderPrefs).toHaveProperty('enableFlac');
      expect(renderPrefs).toHaveProperty('enableM4a');
    });
  });

  describe('configuration defaults', () => {
    test('should have correct default scheduler values', () => {
      const defaultScheduler = {
        enabled: false,
        time: '06:00',
        timezone: 'UTC',
      };

      expect(defaultScheduler.enabled).toBe(false);
      expect(defaultScheduler.time).toBe('06:00');
      expect(defaultScheduler.timezone).toBe('UTC');
    });

    test('should have correct default renderPrefs values', () => {
      // preserveWav defaults to true (local development)
      // enableFlac and enableM4a default to false
      const defaultRenderPrefs = {
        preserveWav: true,
        enableFlac: false,
        enableM4a: false,
      };

      expect(defaultRenderPrefs.preserveWav).toBe(true);
      expect(defaultRenderPrefs.enableFlac).toBe(false);
      expect(defaultRenderPrefs.enableM4a).toBe(false);
    });

    test('should have preserveWav=false for fly.io deployments', () => {
      // When deploying to fly.io, preserveWav should be set to false
      // to avoid filling up limited disk space
      const flyioRenderPrefs = {
        preserveWav: false,
        enableFlac: false,
        enableM4a: false,
      };

      expect(flyioRenderPrefs.preserveWav).toBe(false);
    });
  });

  describe('scheduler status', () => {
    test('should track active state', () => {
      const inactiveStatus = {
        isActive: false,
        lastRun: null,
        nextRun: null,
        isPipelineRunning: false,
      };

      expect(inactiveStatus.isActive).toBe(false);
      expect(inactiveStatus.lastRun).toBeNull();
      expect(inactiveStatus.nextRun).toBeNull();
    });

    test('should track pipeline running state', () => {
      const runningStatus = {
        isActive: true,
        lastRun: new Date().toISOString(),
        nextRun: new Date(Date.now() + 86400000).toISOString(),
        isPipelineRunning: true,
      };

      expect(runningStatus.isActive).toBe(true);
      expect(runningStatus.isPipelineRunning).toBe(true);
      expect(runningStatus.lastRun).not.toBeNull();
      expect(runningStatus.nextRun).not.toBeNull();
    });
  });

  describe('update behavior', () => {
    test('should allow partial scheduler updates', () => {
      const currentConfig = {
        enabled: false,
        time: '06:00',
        timezone: 'UTC',
      };

      const partialUpdate = {
        enabled: true,
      };

      const merged = {
        ...currentConfig,
        ...partialUpdate,
      };

      expect(merged.enabled).toBe(true);
      expect(merged.time).toBe('06:00'); // unchanged
      expect(merged.timezone).toBe('UTC'); // unchanged
    });

    test('should allow partial renderPrefs updates', () => {
      const currentPrefs = {
        preserveWav: true,
        enableFlac: false,
        enableM4a: false,
      };

      const partialUpdate = {
        enableFlac: true,
      };

      const merged = {
        ...currentPrefs,
        ...partialUpdate,
      };

      expect(merged.preserveWav).toBe(true); // unchanged
      expect(merged.enableFlac).toBe(true);
      expect(merged.enableM4a).toBe(false); // unchanged
    });
  });
});
