/**
 * JWT utilities for authentication
 */

import jwt from 'jsonwebtoken';
import { assertProductionSecurityConfig } from './security-runtime';

const JWT_EXPIRATION = '7d'; // Token expires in 7 days

export interface JWTPayload {
    userId: string;
    username: string;
}

function getJwtSecret(): string {
    assertProductionSecurityConfig();
    return process.env.JWT_SECRET || 'sidflow-dev-secret-change-in-production';
}

export function generateToken(payload: JWTPayload): string {
    return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRATION });
}

export function verifyToken(token: string): JWTPayload | null {
    try {
        const decoded = jwt.verify(token, getJwtSecret()) as JWTPayload;
        return decoded;
    } catch {
        return null;
    }
}
