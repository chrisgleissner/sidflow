import { describe, expect, test } from 'bun:test';
import {
    tokenizeTitle,
    calculateTitleSimilarity,
    normalizeComposerName,
    computeRemixScore,
} from '@/lib/server/remix-radar';

describe('Remix Radar helpers', () => {
    test('tokenizeTitle removes stop words and punctuation', () => {
        const tokens = tokenizeTitle('The Last Ninja (Remix) [C64 OST]');
        expect(tokens).toEqual(['last', 'ninja']);
    });

    test('calculateTitleSimilarity returns high score for related titles', () => {
        const similarity = calculateTitleSimilarity('Last Ninja Remix', 'The Last Ninja');
        expect(similarity).toBeGreaterThan(0.6);
    });

    test('calculateTitleSimilarity returns low score for different titles', () => {
        const similarity = calculateTitleSimilarity('Monty on the Run', 'Comic Bakery');
        expect(similarity).toBeLessThan(0.3);
    });

    test('normalizeComposerName lowercases and strips punctuation', () => {
        expect(normalizeComposerName('Rob Hubbard')).toBe('rob hubbard');
        expect(normalizeComposerName('ROB-HUBBARD!')).toBe('rob hubbard');
    });

    test('computeRemixScore weights title similarity more than style match', () => {
        const highTitleScore = computeRemixScore(0.9, 0.4, 0.1);
        const lowTitleScore = computeRemixScore(0.4, 0.9, 0.1);
        expect(highTitleScore).toBeGreaterThan(lowTitleScore);
    });
});
