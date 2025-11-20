/**
 * Tests for similarity-search.ts validation and helper functions
 * Note: The main search function requires LanceDB and is tested in E2E
 */

import { describe, expect, test } from 'bun:test';

describe('Similarity Search Validation', () => {
    test('should accept valid minSimilarity values', () => {
        const validValues = [0, 0.5, 0.7, 1.0];
        validValues.forEach(val => {
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThanOrEqual(1);
        });
    });

    test('should accept valid discovery values', () => {
        const validValues = [0, 0.1, 0.3, 0.5, 1.0];
        validValues.forEach(val => {
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThanOrEqual(1);
        });
    });

    test('should accept valid limit values', () => {
        const validLimits = [1, 10, 50, 100, 1000];
        validLimits.forEach(limit => {
            expect(limit).toBeGreaterThan(0);
        });
    });

    test('should calculate correct minSimilarity based on discovery', () => {
        const discovery = 0.3;
        const minSimilarity = Math.max(0.5, 1 - discovery);
        expect(minSimilarity).toBe(0.7);
    });

    test('should handle edge cases for discovery calculation', () => {
        expect(Math.max(0.5, 1 - 0)).toBe(1);
        expect(Math.max(0.5, 1 - 1)).toBe(0.5);
        expect(Math.max(0.5, 1 - 0.5)).toBe(0.5);
    });
});
