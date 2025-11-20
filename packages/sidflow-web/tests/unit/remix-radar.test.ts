import { describe, expect, test } from 'bun:test';
import {
    tokenizeTitle,
    calculateTitleSimilarity,
    normalizeComposerName,
    computeRemixScore,
} from '@/lib/server/remix-radar';

describe('Remix Radar helpers', () => {
    describe('tokenizeTitle', () => {
        test('removes stop words and punctuation', () => {
            const tokens = tokenizeTitle('The Last Ninja (Remix) [C64 OST]');
            expect(tokens).toEqual(['last', 'ninja']);
        });

        test('handles empty string', () => {
            expect(tokenizeTitle('')).toEqual([]);
        });

        test('handles only stop words', () => {
            expect(tokenizeTitle('the and or of')).toEqual([]);
        });

        test('filters single character tokens', () => {
            expect(tokenizeTitle('A B C Game')).toEqual(['game']);
        });

        test('returns sorted tokens', () => {
            const tokens = tokenizeTitle('Zebra Apple Banana');
            expect(tokens).toEqual(['apple', 'banana', 'zebra']);
        });

        test('handles numbers', () => {
            const tokens = tokenizeTitle('Track 123 Version 2');
            expect(tokens).toContain('123');
            expect(tokens).not.toContain('version'); // stop word
        });

        test('normalizes case', () => {
            const tokens = tokenizeTitle('COMMANDO Commando commando');
            expect(tokens).toEqual(['commando', 'commando', 'commando']);
        });

        test('removes remix-related stop words', () => {
            const tokens = tokenizeTitle('Extended Mix Remix Version');
            expect(tokens).toEqual([]);
        });
    });

    describe('calculateTitleSimilarity', () => {
        test('returns high score for related titles', () => {
            const similarity = calculateTitleSimilarity('Last Ninja Remix', 'The Last Ninja');
            expect(similarity).toBeGreaterThan(0.6);
        });

        test('returns low score for different titles', () => {
            const similarity = calculateTitleSimilarity('Monty on the Run', 'Comic Bakery');
            expect(similarity).toBeLessThan(0.3);
        });

        test('returns 1.0 for identical titles', () => {
            const similarity = calculateTitleSimilarity('Commando', 'Commando');
            expect(similarity).toBe(1.0);
        });

        test('returns 0 for empty titles', () => {
            expect(calculateTitleSimilarity('', 'Test')).toBe(0);
            expect(calculateTitleSimilarity('Test', '')).toBe(0);
            expect(calculateTitleSimilarity('', '')).toBe(0);
        });

        test('handles case insensitivity', () => {
            const sim1 = calculateTitleSimilarity('COMMANDO', 'commando');
            const sim2 = calculateTitleSimilarity('Commando', 'Commando');
            expect(sim1).toBe(sim2);
        });

        test('boosts containment similarity', () => {
            // "commando" is contained in "commando main theme"
            const similarity = calculateTitleSimilarity('Commando', 'Commando Main Theme');
            expect(similarity).toBeGreaterThan(0.5);
        });

        test('calculates Jaccard similarity', () => {
            // "track 01" and "track 02" share "track"
            const similarity = calculateTitleSimilarity('Track 01', 'Track 02');
            expect(similarity).toBeGreaterThan(0);
            expect(similarity).toBeLessThan(1);
        });

        test('is symmetric', () => {
            const sim1 = calculateTitleSimilarity('Title A', 'Title B');
            const sim2 = calculateTitleSimilarity('Title B', 'Title A');
            expect(sim1).toBe(sim2);
        });

        test('returns value between 0 and 1', () => {
            const testPairs = [
                ['Commando', 'Turrican'],
                ['Test', 'Test'],
                ['Short', 'Very Long Title'],
            ];
            for (const [a, b] of testPairs) {
                const sim = calculateTitleSimilarity(a, b);
                expect(sim).toBeGreaterThanOrEqual(0);
                expect(sim).toBeLessThanOrEqual(1);
            }
        });
    });

    describe('normalizeComposerName', () => {
        test('lowercases and strips punctuation', () => {
            expect(normalizeComposerName('Rob Hubbard')).toBe('rob hubbard');
            expect(normalizeComposerName('ROB-HUBBARD!')).toBe('rob hubbard');
        });

        test('handles empty/null values', () => {
            expect(normalizeComposerName('')).toBe('');
            expect(normalizeComposerName(null)).toBe('');
            expect(normalizeComposerName(undefined)).toBe('');
        });

        test('removes special characters', () => {
            expect(normalizeComposerName('O\'Neill, Martin')).toBe('o neill martin');
            expect(normalizeComposerName('Jean-Michel Jarre')).toBe('jean michel jarre');
        });

        test('collapses multiple spaces', () => {
            expect(normalizeComposerName('Rob   Hubbard')).toBe('rob hubbard');
        });

        test('trims whitespace', () => {
            expect(normalizeComposerName('  Rob Hubbard  ')).toBe('rob hubbard');
        });

        test('preserves numbers', () => {
            expect(normalizeComposerName('Martin 23')).toBe('martin 23');
        });
    });

    describe('computeRemixScore', () => {
        test('weights title similarity more than style match', () => {
            const highTitleScore = computeRemixScore(0.9, 0.4, 0.1);
            const lowTitleScore = computeRemixScore(0.4, 0.9, 0.1);
            expect(highTitleScore).toBeGreaterThan(lowTitleScore);
        });

        test('returns value between 0 and 1', () => {
            const score = computeRemixScore(0.8, 0.6, 0.2);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(1);
        });

        test('gives highest weight to title similarity (70%)', () => {
            // Title similarity alone should dominate
            const highTitle = computeRemixScore(1.0, 0.0, 0.0);
            expect(highTitle).toBe(0.7);
        });

        test('gives medium weight to style match (25%)', () => {
            const highStyle = computeRemixScore(0.0, 1.0, 0.0);
            expect(highStyle).toBe(0.25);
        });

        test('gives lowest weight to feedback boost (5%)', () => {
            const highFeedback = computeRemixScore(0.0, 0.0, 1.0);
            expect(highFeedback).toBe(0.05);
        });

        test('handles edge case of all zeros', () => {
            expect(computeRemixScore(0, 0, 0)).toBe(0);
        });

        test('handles edge case of all ones', () => {
            const maxScore = computeRemixScore(1, 1, 1);
            expect(maxScore).toBe(1.0);
        });

        test('is deterministic', () => {
            const score1 = computeRemixScore(0.7, 0.5, 0.3);
            const score2 = computeRemixScore(0.7, 0.5, 0.3);
            expect(score1).toBe(score2);
        });
    });
});
