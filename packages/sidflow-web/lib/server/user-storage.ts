/**
 * User storage for authentication
 * Uses JSON file storage for simplicity, can be upgraded to SQLite later
 */

import { promises as fs } from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { ensureDir, pathExists } from '@sidflow/common';

const SALT_ROUNDS = 10;

export interface User {
    id: string;
    username: string;
    passwordHash: string;
    createdAt: string;
    updatedAt: string;
}

export interface PublicUser {
    id: string;
    username: string;
    createdAt: string;
}

function getUsersDir(): string {
    return process.env.SIDFLOW_USERS_DIR || path.join(process.cwd(), 'data', 'users');
}

async function getUsersPath(): Promise<string> {
    const dir = getUsersDir();
    await ensureDir(dir);
    return dir;
}

function getUserFilePath(usersPath: string, username: string): string {
    // Sanitize username for filesystem
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return path.join(usersPath, `${sanitized}.json`);
}

export async function createUser(username: string, password: string): Promise<User> {
    // Validate username
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
        throw new Error('Username must be 3-20 characters (letters, numbers, underscore, hyphen only)');
    }

    // Validate password
    if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }

    const usersPath = await getUsersPath();
    const filePath = getUserFilePath(usersPath, username);

    // Check if user already exists
    if (await pathExists(filePath)) {
        throw new Error('Username already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user object
    const user: User = {
        id: `user-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        username: username.toLowerCase(),
        passwordHash,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    // Write to file
    await fs.writeFile(filePath, JSON.stringify(user, null, 2), 'utf-8');

    return user;
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
    const usersPath = await getUsersPath();
    const filePath = getUserFilePath(usersPath, username);

    if (!(await pathExists(filePath))) {
        return null;
    }

    const data = await fs.readFile(filePath, 'utf-8');
    const user: User = JSON.parse(data);

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
        return null;
    }

    return user;
}

export async function getUserById(id: string): Promise<User | null> {
    const usersPath = await getUsersPath();
    const files = await fs.readdir(usersPath);

    for (const file of files) {
        if (!file.endsWith('.json')) {
            continue;
        }
        const filePath = path.join(usersPath, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const user: User = JSON.parse(data);
        if (user.id === id) {
            return user;
        }
    }

    return null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
    const usersPath = await getUsersPath();
    const filePath = getUserFilePath(usersPath, username);

    if (!(await pathExists(filePath))) {
        return null;
    }

    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
}

export function toPublicUser(user: User): PublicUser {
    return {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
    };
}
