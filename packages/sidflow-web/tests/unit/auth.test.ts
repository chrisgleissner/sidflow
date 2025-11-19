/**
 * Unit tests for authentication endpoints
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'fs';
import path from 'path';
import { createUser, authenticateUser, getUserById, getUserByUsername } from '@/lib/server/user-storage';
import { generateToken, verifyToken } from '@/lib/server/jwt';

// Use test-specific directory
const TEST_USERS_DIR = path.join(process.cwd(), 'test-workspace', 'users-test');

describe('User Storage', () => {
    beforeEach(async () => {
        // Set test directory
        process.env.SIDFLOW_USERS_DIR = TEST_USERS_DIR;

        // Clean up test directory
        try {
            await fs.rm(TEST_USERS_DIR, { recursive: true });
        } catch {
            // Directory might not exist
        }
        await fs.mkdir(TEST_USERS_DIR, { recursive: true });
    });

    afterEach(async () => {
        // Clean up
        try {
            await fs.rm(TEST_USERS_DIR, { recursive: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('createUser', () => {
        test('should create a new user with valid credentials', async () => {
            const user = await createUser('testuser', 'password123');

            expect(user.id).toBeDefined();
            expect(user.username).toBe('testuser');
            expect(user.passwordHash).toBeDefined();
            expect(user.passwordHash).not.toBe('password123');
            expect(user.createdAt).toBeDefined();
            expect(user.updatedAt).toBeDefined();
        });

        test('should normalize username to lowercase', async () => {
            const user = await createUser('TestUser', 'password123');
            expect(user.username).toBe('testuser');
        });

        test('should reject username with invalid characters', async () => {
            await expect(createUser('test user', 'password123')).rejects.toThrow();
            await expect(createUser('test@user', 'password123')).rejects.toThrow();
        });

        test('should reject username that is too short', async () => {
            await expect(createUser('ab', 'password123')).rejects.toThrow();
        });

        test('should reject username that is too long', async () => {
            const longUsername = 'a'.repeat(21);
            await expect(createUser(longUsername, 'password123')).rejects.toThrow();
        });

        test('should reject password that is too short', async () => {
            await expect(createUser('testuser', 'pass')).rejects.toThrow();
        });

        test('should reject duplicate username', async () => {
            await createUser('testuser', 'password123');
            await expect(createUser('testuser', 'password456')).rejects.toThrow();
        });
    });

    describe('authenticateUser', () => {
        test('should authenticate user with correct password', async () => {
            await createUser('testuser', 'password123');
            const user = await authenticateUser('testuser', 'password123');

            expect(user).not.toBeNull();
            expect(user?.username).toBe('testuser');
        });

        test('should return null for wrong password', async () => {
            await createUser('testuser', 'password123');
            const user = await authenticateUser('testuser', 'wrongpassword');

            expect(user).toBeNull();
        });

        test('should return null for non-existent user', async () => {
            const user = await authenticateUser('nonexistent', 'password123');
            expect(user).toBeNull();
        });

        test('should be case-insensitive for username', async () => {
            await createUser('TestUser', 'password123');
            const user = await authenticateUser('testuser', 'password123');

            expect(user).not.toBeNull();
            expect(user?.username).toBe('testuser');
        });
    });

    describe('getUserById', () => {
        test('should retrieve user by ID', async () => {
            const created = await createUser('testuser', 'password123');
            const retrieved = await getUserById(created.id);

            expect(retrieved).not.toBeNull();
            expect(retrieved?.id).toBe(created.id);
            expect(retrieved?.username).toBe('testuser');
        });

        test('should return null for non-existent ID', async () => {
            const user = await getUserById('non-existent-id');
            expect(user).toBeNull();
        });
    });

    describe('getUserByUsername', () => {
        test('should retrieve user by username', async () => {
            await createUser('testuser', 'password123');
            const retrieved = await getUserByUsername('testuser');

            expect(retrieved).not.toBeNull();
            expect(retrieved?.username).toBe('testuser');
        });

        test('should return null for non-existent username', async () => {
            const user = await getUserByUsername('nonexistent');
            expect(user).toBeNull();
        });
    });
});

describe('JWT Utilities', () => {
    test('should generate and verify valid token', () => {
        const payload = { userId: 'user-123', username: 'testuser' };
        const token = generateToken(payload);

        expect(token).toBeDefined();
        expect(typeof token).toBe('string');

        const verified = verifyToken(token);
        expect(verified).not.toBeNull();
        expect(verified?.userId).toBe('user-123');
        expect(verified?.username).toBe('testuser');
    });

    test('should return null for invalid token', () => {
        const verified = verifyToken('invalid-token');
        expect(verified).toBeNull();
    });

    test('should return null for tampered token', () => {
        const payload = { userId: 'user-123', username: 'testuser' };
        const token = generateToken(payload);

        // Tamper with token
        const tampered = token.substring(0, token.length - 5) + 'xxxxx';
        const verified = verifyToken(tampered);
        expect(verified).toBeNull();
    });
});
