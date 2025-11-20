/**
 * Unit tests for Activity Stream API
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import path from 'path';
import { GET } from '../../../app/api/activity/route';

const TEST_DATA_DIR = path.join(process.cwd(), 'test-workspace', 'data');
const TEST_FEEDBACK_DIR = path.join(TEST_DATA_DIR, 'feedback');

describe('/api/activity', () => {
    const originalCwd = process.cwd();
    const testWorkspace = path.join(originalCwd, 'test-workspace');

    beforeEach(async () => {
        // Override cwd to use test workspace
        process.chdir(testWorkspace);

        // Create test feedback events
        const eventsDir = path.join(TEST_FEEDBACK_DIR, '2025', '11');
        await fs.mkdir(eventsDir, { recursive: true });

        const events = [
            { userId: 'testuser', sidPath: 'MUSICIANS/A/Author/track1.sid', action: 'play', timestamp: '2025-11-19T10:00:00Z' },
            { userId: 'testuser', sidPath: 'MUSICIANS/B/Beatles/track2.sid', action: 'like', timestamp: '2025-11-19T11:00:00Z' },
            { userId: 'otheruser', sidPath: 'MUSICIANS/C/Composer/track3.sid', action: 'skip', timestamp: '2025-11-19T12:00:00Z' },
        ];

        const lines = events.map(e => JSON.stringify(e)).join('\n');
        await fs.writeFile(path.join(eventsDir, 'events.jsonl'), lines, 'utf-8');
    });

    afterEach(async () => {
        // Restore original cwd
        process.chdir(originalCwd);

        // Clean up
        try {
            await fs.rm(TEST_FEEDBACK_DIR, { recursive: true, force: true });
        } catch {
            // Ignore
        }
    });

    test('should return recent activity events', async () => {
        const request = new Request('http://localhost:3000/api/activity');
        const response = await GET(request);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.events).toBeArray();
        expect(data.data.events.length).toBeGreaterThan(0);
        expect(data.data.count).toBe(data.data.events.length);

        // Check event structure
        const event = data.data.events[0];
        expect(event).toHaveProperty('username');
        expect(event).toHaveProperty('sidPath');
        expect(event).toHaveProperty('action');
        expect(event).toHaveProperty('timestamp');
    });

    test('should return events in reverse chronological order', async () => {
        const request = new Request('http://localhost:3000/api/activity');
        const response = await GET(request);
        const data = await response.json();

        expect(data.success).toBe(true);
        const events = data.data.events;

        // Most recent event should be first
        if (events.length > 1) {
            const firstTimestamp = new Date(events[0].timestamp).getTime();
            const secondTimestamp = new Date(events[1].timestamp).getTime();
            expect(firstTimestamp).toBeGreaterThanOrEqual(secondTimestamp);
        }
    });

    test('should limit results to requested amount', async () => {
        const request = new Request('http://localhost:3000/api/activity?limit=2');
        const response = await GET(request);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.events.length).toBeLessThanOrEqual(2);
    });

    test('should enforce maximum limit of 100', async () => {
        const request = new Request('http://localhost:3000/api/activity?limit=500');
        const response = await GET(request);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.events.length).toBeLessThanOrEqual(100);
    });

    test('should handle missing feedback directory gracefully', async () => {
        // Remove feedback directory
        await fs.rm(TEST_FEEDBACK_DIR, { recursive: true, force: true });

        const request = new Request('http://localhost:3000/api/activity');
        const response = await GET(request);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.events).toEqual([]);
        expect(data.data.count).toBe(0);
    });

    test('should skip invalid JSON lines', async () => {
        const eventsPath = path.join(TEST_FEEDBACK_DIR, '2025', '11', 'events.jsonl');
        const invalidContent = 'invalid json\n{"userId":"user","sidPath":"test.sid","action":"play","timestamp":"2025-11-19T10:00:00Z"}';
        await fs.writeFile(eventsPath, invalidContent, 'utf-8');

        const request = new Request('http://localhost:3000/api/activity');
        const response = await GET(request);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.events.length).toBe(1); // Only valid line
    });

    test('should handle default values for missing fields', async () => {
        const eventsDir = path.join(TEST_FEEDBACK_DIR, '2025', '11');
        const partialEvent = { sidPath: 'test.sid' }; // Missing userId, action, timestamp
        await fs.writeFile(path.join(eventsDir, 'events.jsonl'), JSON.stringify(partialEvent), 'utf-8');

        const request = new Request('http://localhost:3000/api/activity');
        const response = await GET(request);
        const data = await response.json();

        expect(data.success).toBe(true);
        const event = data.data.events[0];
        expect(event.username).toBe('anonymous');
        expect(event.sidPath).toBe('test.sid');
        expect(event.action).toBe('play');
        expect(event.timestamp).toBeDefined();
    });
});
