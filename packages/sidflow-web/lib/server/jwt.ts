/**
 * JWT utilities for authentication
 */

import jwt from 'jsonwebtoken';

// Use environment variable or default secret (must be changed in production)
const JWT_SECRET = process.env.JWT_SECRET || 'sidflow-dev-secret-change-in-production';
const JWT_EXPIRATION = '7d'; // Token expires in 7 days

export interface JWTPayload {
    userId: string;
    username: string;
}

export function generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });
}

export function verifyToken(token: string): JWTPayload | null {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
        return decoded;
    } catch {
        return null;
    }
}
