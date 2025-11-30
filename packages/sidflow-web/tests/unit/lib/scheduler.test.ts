/**
 * Tests for the scheduler service
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  calculateNextRunTime,
  getMillisUntilNextRun,
} from '@/lib/scheduler';
import type { SchedulerConfig } from '@/lib/preferences-store';

describe('scheduler', () => {
  describe('calculateNextRunTime', () => {
    test('should calculate next run time for same day if time has not passed', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: '14:00',
        timezone: 'UTC',
      };
      
      // Mock current time as 10:00 UTC
      const now = new Date('2025-01-15T10:00:00Z');
      const nextRun = calculateNextRunTime(config, now);
      
      expect(nextRun.getUTCHours()).toBe(14);
      expect(nextRun.getUTCMinutes()).toBe(0);
      expect(nextRun.getUTCDate()).toBe(15); // Same day
    });

    test('should calculate next run time for next day if time has passed', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: '06:00',
        timezone: 'UTC',
      };
      
      // Mock current time as 10:00 UTC (after 06:00)
      const now = new Date('2025-01-15T10:00:00Z');
      const nextRun = calculateNextRunTime(config, now);
      
      expect(nextRun.getUTCHours()).toBe(6);
      expect(nextRun.getUTCMinutes()).toBe(0);
      expect(nextRun.getUTCDate()).toBe(16); // Next day
    });

    test('should handle invalid time format gracefully', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: 'invalid',
        timezone: 'UTC',
      };
      
      const now = new Date('2025-01-15T03:00:00Z');
      const nextRun = calculateNextRunTime(config, now);
      
      // Should fall back to 06:00
      expect(nextRun.getUTCHours()).toBe(6);
      expect(nextRun.getUTCMinutes()).toBe(0);
    });

    test('should handle edge case of exact time', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: '10:00',
        timezone: 'UTC',
      };
      
      // Current time is exactly 10:00:00
      const now = new Date('2025-01-15T10:00:00Z');
      const nextRun = calculateNextRunTime(config, now);
      
      // Should schedule for next day since we're at exactly the time
      expect(nextRun.getUTCDate()).toBe(16);
    });

    test('should handle single-digit hour format', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: '6:30',
        timezone: 'UTC',
      };
      
      const now = new Date('2025-01-15T03:00:00Z');
      const nextRun = calculateNextRunTime(config, now);
      
      expect(nextRun.getUTCHours()).toBe(6);
      expect(nextRun.getUTCMinutes()).toBe(30);
    });

    test('should handle midnight correctly', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: '00:00',
        timezone: 'UTC',
      };
      
      const now = new Date('2025-01-15T23:00:00Z');
      const nextRun = calculateNextRunTime(config, now);
      
      expect(nextRun.getUTCHours()).toBe(0);
      expect(nextRun.getUTCMinutes()).toBe(0);
      expect(nextRun.getUTCDate()).toBe(16); // Next day
    });
  });

  describe('getMillisUntilNextRun', () => {
    test('should return positive milliseconds until next run', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: '14:00',
        timezone: 'UTC',
      };
      
      const now = new Date('2025-01-15T10:00:00Z');
      const millis = getMillisUntilNextRun(config, now);
      
      // 4 hours = 4 * 60 * 60 * 1000 = 14400000ms
      expect(millis).toBe(4 * 60 * 60 * 1000);
    });

    test('should never return negative milliseconds', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: '10:00',
        timezone: 'UTC',
      };
      
      const now = new Date('2025-01-15T10:00:00Z');
      const millis = getMillisUntilNextRun(config, now);
      
      expect(millis).toBeGreaterThanOrEqual(0);
    });

    test('should calculate correct delay for next day run', () => {
      const config: SchedulerConfig = {
        enabled: true,
        time: '06:00',
        timezone: 'UTC',
      };
      
      // Current time is 20:00, so next run is 10 hours away
      const now = new Date('2025-01-15T20:00:00Z');
      const millis = getMillisUntilNextRun(config, now);
      
      // 10 hours = 10 * 60 * 60 * 1000 = 36000000ms
      expect(millis).toBe(10 * 60 * 60 * 1000);
    });
  });
});
