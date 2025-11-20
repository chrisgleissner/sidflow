/**
 * Tests for server/cache.ts LRU cache implementation
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { LRUCache, createCacheKey, clearAllCaches, getAllCacheStats } from '@/lib/server/cache';

describe('LRUCache', () => {
    test('should store and retrieve values', () => {
        const cache = new LRUCache<string>({ ttl: 1000, maxSize: 10 });
        
        cache.set('key1', 'value1');
        expect(cache.get('key1')).toBe('value1');
    });

    test('should return undefined for non-existent keys', () => {
        const cache = new LRUCache<string>({ ttl: 1000, maxSize: 10 });
        
        expect(cache.get('nonexistent')).toBeUndefined();
    });

    test('should expire entries after TTL', async () => {
        const cache = new LRUCache<string>({ ttl: 50, maxSize: 10 });
        
        cache.set('key1', 'value1');
        expect(cache.get('key1')).toBe('value1');
        
        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 60));
        
        expect(cache.get('key1')).toBeUndefined();
    });

    test('should evict oldest entry when at capacity', () => {
        const cache = new LRUCache<number>({ ttl: 10000, maxSize: 3 });
        
        cache.set('key1', 1);
        cache.set('key2', 2);
        cache.set('key3', 3);
        
        // This should evict key1
        cache.set('key4', 4);
        
        expect(cache.get('key1')).toBeUndefined();
        expect(cache.get('key2')).toBe(2);
        expect(cache.get('key3')).toBe(3);
        expect(cache.get('key4')).toBe(4);
    });

    test('should move accessed entries to end (LRU behavior)', () => {
        const cache = new LRUCache<number>({ ttl: 10000, maxSize: 3 });
        
        cache.set('key1', 1);
        cache.set('key2', 2);
        cache.set('key3', 3);
        
        // Access key1 to make it most recently used
        cache.get('key1');
        
        // Add key4, which should evict key2 (least recently used)
        cache.set('key4', 4);
        
        expect(cache.get('key1')).toBe(1);
        expect(cache.get('key2')).toBeUndefined();
        expect(cache.get('key3')).toBe(3);
        expect(cache.get('key4')).toBe(4);
    });

    test('should check if key exists with has()', () => {
        const cache = new LRUCache<string>({ ttl: 1000, maxSize: 10 });
        
        cache.set('key1', 'value1');
        
        expect(cache.has('key1')).toBe(true);
        expect(cache.has('nonexistent')).toBe(false);
    });

    test('should return false for expired keys with has()', async () => {
        const cache = new LRUCache<string>({ ttl: 50, maxSize: 10 });
        
        cache.set('key1', 'value1');
        expect(cache.has('key1')).toBe(true);
        
        await new Promise(resolve => setTimeout(resolve, 60));
        
        expect(cache.has('key1')).toBe(false);
    });

    test('should clear all entries', () => {
        const cache = new LRUCache<string>({ ttl: 1000, maxSize: 10 });
        
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        
        cache.clear();
        
        expect(cache.size).toBe(0);
        expect(cache.get('key1')).toBeUndefined();
        expect(cache.get('key2')).toBeUndefined();
    });

    test('should report correct size', () => {
        const cache = new LRUCache<string>({ ttl: 1000, maxSize: 10 });
        
        expect(cache.size).toBe(0);
        
        cache.set('key1', 'value1');
        expect(cache.size).toBe(1);
        
        cache.set('key2', 'value2');
        expect(cache.size).toBe(2);
        
        cache.clear();
        expect(cache.size).toBe(0);
    });

    test('should return cache statistics', () => {
        const cache = new LRUCache<string>({ ttl: 5000, maxSize: 100 });
        
        cache.set('key1', 'value1');
        cache.set('key2', 'value2');
        
        const stats = cache.getStats();
        
        expect(stats.size).toBe(2);
        expect(stats.maxSize).toBe(100);
        expect(stats.ttl).toBe(5000);
    });

    test('should handle complex object values', () => {
        const cache = new LRUCache<object>({ ttl: 1000, maxSize: 10 });
        
        const value = { id: 1, name: 'Test', nested: { data: [1, 2, 3] } };
        cache.set('obj1', value);
        
        const retrieved = cache.get('obj1');
        expect(retrieved).toEqual(value);
    });

    test('should handle overwriting existing keys', () => {
        const cache = new LRUCache<string>({ ttl: 1000, maxSize: 10 });
        
        cache.set('key1', 'value1');
        cache.set('key1', 'value2');
        
        expect(cache.get('key1')).toBe('value2');
        expect(cache.size).toBe(1);
    });

    test('should handle edge case of maxSize=1', () => {
        const cache = new LRUCache<string>({ ttl: 1000, maxSize: 1 });
        
        cache.set('key1', 'value1');
        expect(cache.get('key1')).toBe('value1');
        
        cache.set('key2', 'value2');
        expect(cache.get('key1')).toBeUndefined();
        expect(cache.get('key2')).toBe('value2');
    });
});

describe('createCacheKey', () => {
    test('should create key from strings', () => {
        const key = createCacheKey('part1', 'part2', 'part3');
        expect(key).toBe('part1::part2::part3');
    });

    test('should create key from numbers', () => {
        const key = createCacheKey('user', 123, 'profile');
        expect(key).toBe('user::123::profile');
    });

    test('should create key from booleans', () => {
        const key = createCacheKey('flag', true, 'setting', false);
        expect(key).toBe('flag::true::setting::false');
    });

    test('should create key from objects', () => {
        const obj = { id: 1, name: 'test' };
        const key = createCacheKey('prefix', obj);
        expect(key).toBe('prefix::{"id":1,"name":"test"}');
    });

    test('should create key from mixed types', () => {
        const key = createCacheKey('search', { query: 'test' }, 10, true);
        expect(key).toBe('search::{"query":"test"}::10::true');
    });

    test('should handle empty array', () => {
        const key = createCacheKey();
        expect(key).toBe('');
    });

    test('should handle single parameter', () => {
        const key = createCacheKey('single');
        expect(key).toBe('single');
    });
});

describe('clearAllCaches', () => {
    test('should clear all exported caches', () => {
        // This test just ensures the function doesn't throw
        clearAllCaches();
        expect(true).toBe(true);
    });
});

describe('getAllCacheStats', () => {
    test('should return stats for all caches', () => {
        const stats = getAllCacheStats();
        
        expect(stats).toHaveProperty('similarity');
        expect(stats).toHaveProperty('moodTransition');
        expect(stats).toHaveProperty('hiddenGems');
        expect(stats).toHaveProperty('table');
        expect(stats).toHaveProperty('trackInfo');
        
        expect(stats.similarity).toHaveProperty('size');
        expect(stats.similarity).toHaveProperty('maxSize');
        expect(stats.similarity).toHaveProperty('ttl');
    });
});
