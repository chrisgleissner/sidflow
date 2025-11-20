import { describe, it, expect, beforeEach } from 'bun:test';
import { SearchIndex, type SearchFilters } from '@/lib/server/search-index';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('SearchIndex', () => {
    let testDataPath: string;
    let searchIndex: SearchIndex;

    beforeEach(async () => {
        // Create a temporary test data file
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-test-'));
        testDataPath = path.join(tmpDir, 'test-data.jsonl');

        const testData = [
            { sid_path: 'MUSICIANS/Hubbard_Rob/Delta.sid', ratings: { e: 4, m: 5, c: 5, p: 4 }, features: {}, metadata: { year: 1987, chipModel: '6581', sidModel: 'MOS6581', duration: 180 } },
            { sid_path: 'MUSICIANS/Galway_Martin/Parallax.sid', ratings: { e: 3, m: 4, c: 4, p: 4 }, features: {}, metadata: { year: 1986, chipModel: '6581', sidModel: 'MOS6581', duration: 240 } },
            { sid_path: 'MUSICIANS/Daglish_Ben/The_Last_Ninja.sid', ratings: { e: 5, m: 5, c: 5, p: 5 }, features: {}, metadata: { year: 1987, chipModel: '8580', sidModel: 'MOS8580', duration: 300 } },
            { sid_path: 'MUSICIANS/Tel_Jeroen/Cybernoid.sid', ratings: { e: 4, m: 4, c: 5, p: 4 }, features: {}, metadata: { year: 1988, chipModel: '6581', sidModel: 'MOS6581', duration: 150 } },
            { sid_path: 'GAMES/Commando.sid', ratings: { e: 3, m: 3, c: 3, p: 3 }, features: {}, metadata: { year: 1985, chipModel: '6581', sidModel: 'MOS6581', duration: 120 } },
        ];

        await fs.writeFile(testDataPath, testData.map((t) => JSON.stringify(t)).join('\n'));

        // Create search index with test data and no cache TTL for immediate testing
        searchIndex = new SearchIndex(testDataPath, 0);
    });

    describe('Basic Search', () => {
        it('should find tracks by title', async () => {
            const results = await searchIndex.query('delta');
            expect(results).toHaveLength(1);
            expect(results[0]?.displayName).toBe('Delta');
        });

        it('should find tracks by artist', async () => {
            const results = await searchIndex.query('hubbard');
            expect(results).toHaveLength(1);
            expect(results[0]?.artist).toBe('Hubbard Rob');
        });

        it('should find tracks by partial match', async () => {
            const results = await searchIndex.query('galway');
            expect(results).toHaveLength(1);
            expect(results[0]?.displayName).toBe('Parallax');
        });

        it('should return empty array for no matches', async () => {
            const results = await searchIndex.query('nonexistent');
            expect(results).toHaveLength(0);
        });

        it('should respect limit parameter', async () => {
            const results = await searchIndex.query('sid', { limit: 2 });
            expect(results.length).toBeLessThanOrEqual(2);
        });
    });

    describe('Year Filters', () => {
        it('should filter by minimum year', async () => {
            const filters: SearchFilters = { yearMin: 1987 };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.year).toBeGreaterThanOrEqual(1987);
            });
        });

        it('should filter by maximum year', async () => {
            const filters: SearchFilters = { yearMax: 1986 };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.year).toBeLessThanOrEqual(1986);
            });
        });

        it('should filter by year range', async () => {
            const filters: SearchFilters = { yearMin: 1986, yearMax: 1987 };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.year).toBeGreaterThanOrEqual(1986);
                expect(result.year).toBeLessThanOrEqual(1987);
            });
        });
    });

    describe('Chip Model Filters', () => {
        it('should filter by chip model', async () => {
            const filters: SearchFilters = { chipModel: '8580' };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.metadata?.chipModel).toBe('8580');
            });
        });

        it('should return no results for non-matching chip model', async () => {
            const filters: SearchFilters = { chipModel: '9999' };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results).toHaveLength(0);
        });
    });

    describe('Duration Filters', () => {
        it('should filter by minimum duration', async () => {
            const filters: SearchFilters = { durationMin: 200 };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.metadata?.duration).toBeGreaterThanOrEqual(200);
            });
        });

        it('should filter by maximum duration', async () => {
            const filters: SearchFilters = { durationMax: 150 };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.metadata?.duration).toBeLessThanOrEqual(150);
            });
        });

        it('should filter by duration range', async () => {
            const filters: SearchFilters = { durationMin: 150, durationMax: 250 };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.metadata?.duration).toBeGreaterThanOrEqual(150);
                expect(result.metadata?.duration).toBeLessThanOrEqual(250);
            });
        });
    });

    describe('Rating Filters', () => {
        it('should filter by minimum rating', async () => {
            const filters: SearchFilters = { minRating: 4 };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                const avgRating = result.ratings
                    ? ((result.ratings.e ?? 0) + (result.ratings.m ?? 0) + (result.ratings.c ?? 0)) / 3
                    : 0;
                expect(avgRating).toBeGreaterThanOrEqual(4);
            });
        });

        it('should exclude tracks with low ratings', async () => {
            const filters: SearchFilters = { minRating: 4.5 };
            const results = await searchIndex.query('commando', { limit: 10, filters });

            // Commando has rating 3 for all dimensions, so avg = 3
            expect(results).toHaveLength(0);
        });
    });

    describe('Combined Filters', () => {
        it('should apply multiple filters together', async () => {
            const filters: SearchFilters = {
                yearMin: 1986,
                yearMax: 1988,
                chipModel: '6581',
                durationMin: 150,
            };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.year).toBeGreaterThanOrEqual(1986);
                expect(result.year).toBeLessThanOrEqual(1988);
                expect(result.metadata?.chipModel).toBe('6581');
                expect(result.metadata?.duration).toBeGreaterThanOrEqual(150);
            });
        });

        it('should return empty array when filters exclude all results', async () => {
            const filters: SearchFilters = {
                yearMin: 1990,
                yearMax: 2000,
            };
            const results = await searchIndex.query('sid', { limit: 10, filters });

            // Test data only has tracks from 1985-1988
            expect(results).toHaveLength(0);
        });
    });
});
