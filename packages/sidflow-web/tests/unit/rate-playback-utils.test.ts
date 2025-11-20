/**
 * Tests for rate-playback.ts utility functions
 */

import { describe, expect, test } from 'bun:test';
import { parseDurationSeconds } from '@/lib/rate-playback';

describe('parseDurationSeconds', () => {
    test('should return 180 for undefined/null', () => {
        expect(parseDurationSeconds()).toBe(180);
        expect(parseDurationSeconds(undefined)).toBe(180);
    });

    test('should parse MM:SS format correctly', () => {
        expect(parseDurationSeconds('3:00')).toBe(180);
        expect(parseDurationSeconds('1:30')).toBe(90);
        expect(parseDurationSeconds('5:45')).toBe(345);
    });

    test('should enforce minimum 15 seconds for MM:SS format', () => {
        expect(parseDurationSeconds('0:05')).toBe(15);
        expect(parseDurationSeconds('0:10')).toBe(15);
        expect(parseDurationSeconds('0:15')).toBe(15);
        expect(parseDurationSeconds('0:30')).toBe(30);
    });

    test('should parse numeric string as seconds', () => {
        expect(parseDurationSeconds('120')).toBe(120);
        expect(parseDurationSeconds('60')).toBe(60);
        expect(parseDurationSeconds('300')).toBe(300);
    });

    test('should enforce minimum 15 seconds for numeric format', () => {
        expect(parseDurationSeconds('5')).toBe(15);
        expect(parseDurationSeconds('10')).toBe(15);
        expect(parseDurationSeconds('15')).toBe(15);
        expect(parseDurationSeconds('20')).toBe(20);
    });

    test('should return 180 for invalid MM:SS format', () => {
        expect(parseDurationSeconds('abc:def')).toBe(180);
        // ':30' parses as minutes='', seconds='30'. Number('') = 0, so 0*60+30 = 30, Math.max(15,30) = 30
        expect(parseDurationSeconds(':30')).toBe(30);
        // '10:' parses as minutes='10', seconds=''. Number('') = 0, so 10*60+0 = 600
        expect(parseDurationSeconds('10:')).toBe(600);
        // Both parts invalid
        expect(parseDurationSeconds('abc:def')).toBe(180);
    });

    test('should return 180 for invalid numeric string', () => {
        expect(parseDurationSeconds('abc')).toBe(180);
        expect(parseDurationSeconds('not a number')).toBe(180);
    });

    test('should handle negative numbers', () => {
        // '-10' as numeric: -10 is not > 0, so returns 180
        expect(parseDurationSeconds('-10')).toBe(180);
        // '-1:30' as MM:SS: -1 * 60 + 30 = -30, Math.max(15, -30) = 15
        expect(parseDurationSeconds('-1:30')).toBe(15);
    });

    test('should return 180 for zero', () => {
        expect(parseDurationSeconds('0')).toBe(180);
    });

    test('should return 180 for empty string', () => {
        expect(parseDurationSeconds('')).toBe(180);
    });

    test('should handle large durations', () => {
        expect(parseDurationSeconds('10:00')).toBe(600);
        expect(parseDurationSeconds('60:00')).toBe(3600);
        expect(parseDurationSeconds('10000')).toBe(10000);
    });

    test('should handle decimal seconds in MM:SS and numeric formats', () => {
        // Decimal seconds in MM:SS format: 3 minutes, 30.5 seconds = 210.5
        expect(parseDurationSeconds('3:30.5')).toBe(210.5);
        // Decimal seconds as numeric string
        expect(parseDurationSeconds('210.5')).toBe(210.5);
    });

    test('should trim whitespace (implicitly through Number parsing)', () => {
        // Number() trims whitespace automatically
        expect(parseDurationSeconds('  120  ')).toBe(120);
    });
});
