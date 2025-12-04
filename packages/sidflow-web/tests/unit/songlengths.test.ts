/**
 * Tests for songlengths.ts utility functions
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { loadSonglengthsData, lookupSongLength, clearSonglengthCaches } from '@sidflow/common';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `songlengths-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

beforeEach(() => {
    // Clear caches before each test
    clearSonglengthCaches();
    
    // Clean up test directory
    try {
        rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
        // ignore
    }
    mkdirSync(TEST_DIR, { recursive: true });
});

describe('loadSonglengthsData', () => {
    test('should load valid Songlengths.md5 from DOCUMENTS folder', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = [
            '; /MUSICIANS/H/Hubbard_Rob/Commando.sid',
            'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6=0:00 1:30 2:45',
            '',
            '; /GAMES/M-Z/Monty_on_the_Run/music.sid',
            'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7=3:15',
        ].join('\n');
        
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.map.size).toBe(2);
        expect(result.map.get('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6')).toBe('0:00 1:30 2:45');
        expect(result.map.get('b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7')).toBe('3:15');
    });

    test('should try C64Music/DOCUMENTS path', async () => {
        const docsDir = join(TEST_DIR, 'C64Music', 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = [
            '; /Test.sid',
            'abcdef1234567890abcdef1234567890=1:00',
        ].join('\n');
        
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.map.size).toBe(1);
        expect(result.map.get('abcdef1234567890abcdef1234567890')).toBe('1:00');
    });

    test('should try update/DOCUMENTS path', async () => {
        const docsDir = join(TEST_DIR, 'update', 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = [
            '; /Update.sid',
            '12345678901234567890123456789012=2:30',
        ].join('\n');
        
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.map.size).toBe(1);
    });

    test('should return empty data when no file found', async () => {
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.map.size).toBe(0);
        expect(result.paths.length).toBe(0);
        expect(result.lengthByPath.size).toBe(0);
    });

    test('should cache loaded data', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = '; /Test.sid\nabcdef1234567890abcdef1234567890=1:00';
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        // Load twice
        const result1 = await loadSonglengthsData(TEST_DIR);
        const result2 = await loadSonglengthsData(TEST_DIR);
        
        // Should return the same cached promise result
        expect(result1).toBe(result2);
    });

    test('should skip empty lines and comments', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = [
            '',
            '; Comment line',
            '   ',
            '; /Valid.sid',
            'abcd1234abcd1234abcd1234abcd1234=1:00',
            '',
            '[Section]',
            '; /Another.sid',
            'efab5678efab5678efab5678efab5678=2:00',
        ].join('\n');
        
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.map.size).toBe(2);
    });

    test('should handle paths with leading slash', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = [
            '; /GAMES/Test.sid',
            'aaaa1111aaaa1111aaaa1111aaaa1111=1:00',
        ].join('\n');
        
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.paths[0]).toBe('GAMES/Test.sid');
        expect(result.lengthByPath.get('GAMES/Test.sid')).toBe('1:00');
    });

    test('should only process .sid files in comments', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = [
            '; /README.txt',
            'aaaa1111aaaa1111aaaa1111aaaa1111=1:00',
            '; /Valid.sid',
            'bbbb2222bbbb2222bbbb2222bbbb2222=2:00',
            '; /folder/',
            'cccc3333cccc3333cccc3333cccc3333=3:00',
        ].join('\n');
        
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.paths.length).toBe(1);
        expect(result.paths[0]).toBe('Valid.sid');
    });

    test('should normalize MD5 hashes to lowercase', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = [
            '; /Test.sid',
            'ABCD1234ABCD1234ABCD1234ABCD1234=1:00',
        ].join('\n');
        
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.map.has('abcd1234abcd1234abcd1234abcd1234')).toBe(true);
        expect(result.map.has('ABCD1234ABCD1234ABCD1234ABCD1234')).toBe(false);
    });
});

describe('lookupSongLength', () => {
    test('should return cached value on second lookup', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        // Create empty songlengths file (will return undefined)
        writeFileSync(join(docsDir, 'Songlengths.md5'), '', 'utf8');
        
        const fakePath = '/fake/path/test.sid';
        const result1 = await lookupSongLength(fakePath, TEST_DIR, TEST_DIR);
        const result2 = await lookupSongLength(fakePath, TEST_DIR, TEST_DIR);
        
        expect(result1).toBeUndefined();
        expect(result2).toBeUndefined();
    });

    test('should return undefined when map is empty', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        writeFileSync(join(docsDir, 'Songlengths.md5'), '', 'utf8');
        
        const result = await lookupSongLength('/fake/path.sid', TEST_DIR, TEST_DIR);
        expect(result).toBeUndefined();
    });

    test('should handle missing file gracefully', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        
        const content = [
            '; /Test.sid',
            'aaaa1111aaaa1111aaaa1111aaaa1111=1:00',
        ].join('\n');
        writeFileSync(join(docsDir, 'Songlengths.md5'), content, 'utf8');
        
        const result = await lookupSongLength('/nonexistent/file.sid', TEST_DIR, TEST_DIR);
        expect(result).toBeUndefined();
    });
});

describe('clearSonglengthCaches', () => {
    test('should clear all caches', async () => {
        const docsDir = join(TEST_DIR, 'DOCUMENTS');
        mkdirSync(docsDir, { recursive: true });
        writeFileSync(join(docsDir, 'Songlengths.md5'), '', 'utf8');
        
        // Load data to populate cache
        await loadSonglengthsData(TEST_DIR);
        await lookupSongLength('/fake/path.sid', TEST_DIR, TEST_DIR);
        
        // Clear caches
        clearSonglengthCaches();
        
        // Subsequent load should reload from disk
        const result = await loadSonglengthsData(TEST_DIR);
        expect(result.map.size).toBe(0);
    });
});
