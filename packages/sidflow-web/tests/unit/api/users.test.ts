/**
 * Unit tests for User Profiles API
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import path from 'path';
import { GET } from '../../../app/api/users/[username]/route';
import { createUser } from '../../../lib/server/user-storage';

// Use unique test directory per test run to avoid conflicts
const TEST_ID = `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const TEST_DATA_DIR = path.join(process.cwd(), 'test-workspace', TEST_ID, 'data');
const TEST_USERS_DIR = path.join(TEST_DATA_DIR, 'users');
const TEST_FEEDBACK_DIR = path.join(TEST_DATA_DIR, 'feedback');

describe.serial('/api/users/[username]', () => {
    const originalCwd = process.cwd();
    const testWorkspace = path.join(originalCwd, 'test-workspace', TEST_ID);
    let testUsername: string;

    beforeEach(async () => {
        // Use unique username per test to avoid conflicts
        testUsername = `profileuser${Math.floor(Math.random() * 1000000)}`;

        // Clean up first
        try {
            await fs.rm(testWorkspace, { recursive: true, force: true });
        } catch {
            // Ignore
        }

        // Create test workspace directory
        await fs.mkdir(testWorkspace, { recursive: true });

        // Override cwd to use test workspace
        process.chdir(testWorkspace);

        // Create test user
        await fs.mkdir(TEST_USERS_DIR, { recursive: true });
        await createUser(testUsername, 'password123');

        // Create feedback events for the user
        const eventsDir = path.join(TEST_FEEDBACK_DIR, '2025', '11');
        await fs.mkdir(eventsDir, { recursive: true });

        const events = [
            { userId: testUsername, sidPath: 'track1.sid', action: 'play', timestamp: '2025-11-19T10:00:00Z' },
            { userId: testUsername, sidPath: 'track2.sid', action: 'play', timestamp: '2025-11-19T11:00:00Z' },
            { userId: testUsername, sidPath: 'track3.sid', action: 'like', timestamp: '2025-11-19T12:00:00Z' },
            { userId: 'otheruser', sidPath: 'track4.sid', action: 'play', timestamp: '2025-11-19T13:00:00Z' },
        ];

        const lines = events.map(e => JSON.stringify(e)).join('\n');
        await fs.writeFile(path.join(eventsDir, 'events.jsonl'), lines, 'utf-8');
    });

    afterEach(async () => {
        // Restore original cwd
        process.chdir(originalCwd);

        // Clean up
        try {
            await fs.rm(testWorkspace, { recursive: true, force: true });
        } catch {
            // Ignore
        }
    });

    test('should return user profile with stats', async () => {
        const request = new Request(`http://localhost:3000/api/users/${testUsername}`);
        const context = { params: Promise.resolve({ username: testUsername }) };
        const response = await GET(request, context);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.user.username).toBe(testUsername.toLowerCase());
        expect(data.data.user.id).toBeDefined();
        expect(data.data.user).not.toHaveProperty('passwordHash');
        expect(data.data.stats.totalPlays).toBe(2);
        expect(data.data.stats.totalLikes).toBe(1);
        expect(data.data.stats.joinedAt).toBeDefined();
    });

    test('should return 404 for non-existent user', async () => {
        const request = new Request('http://localhost:3000/api/users/nonexistent');
        const context = { params: Promise.resolve({ username: 'nonexistent' }) };
        const response = await GET(request, context);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.error).toContain('not found');
    });

    test('should calculate stats from feedback events correctly', async () => {
        const request = new Request(`http://localhost:3000/api/users/${testUsername}`);
        const context = { params: Promise.resolve({ username: testUsername }) };
        const response = await GET(request, context);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.stats.totalPlays).toBe(2); // Only testUsername's plays
        expect(data.data.stats.totalLikes).toBe(1); // Only testUsername's likes
    });

    test('should handle user with no activity', async () => {
        const newUser = `newuser${Date.now()}`;
        await createUser(newUser, 'password456');

        const request = new Request(`http://localhost:3000/api/users/${newUser}`);
        const context = { params: Promise.resolve({ username: newUser }) };
        const response = await GET(request, context);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.user.username).toBe(newUser.toLowerCase());
        expect(data.data.stats.totalPlays).toBe(0);
        expect(data.data.stats.totalLikes).toBe(0);
    });

    test('should handle missing feedback directory', async () => {
        await fs.rm(TEST_FEEDBACK_DIR, { recursive: true, force: true });

        const request = new Request(`http://localhost:3000/api/users/${testUsername}`);
        const context = { params: Promise.resolve({ username: testUsername }) };
        const response = await GET(request, context);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.stats.totalPlays).toBe(0);
        expect(data.data.stats.totalLikes).toBe(0);
    });

    test('should skip invalid JSON lines in feedback', async () => {
        const eventsPath = path.join(TEST_FEEDBACK_DIR, '2025', '11', 'events.jsonl');
        const mixedContent = `invalid line\n{"userId":"${testUsername}","sidPath":"valid.sid","action":"play","timestamp":"2025-11-19T10:00:00Z"}`;
        await fs.writeFile(eventsPath, mixedContent, 'utf-8');

        const request = new Request(`http://localhost:3000/api/users/${testUsername}`);
        const context = { params: Promise.resolve({ username: testUsername }) };
        const response = await GET(request, context);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.data.stats.totalPlays).toBe(1); // Only valid line counted
    });
});
