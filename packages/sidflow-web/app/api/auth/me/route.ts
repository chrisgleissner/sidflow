/**
 * Get current user endpoint
 * GET /api/auth/me
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/server/jwt';
import { getUserById, toPublicUser } from '@/lib/server/user-storage';

export async function GET() {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('sidflow_auth')?.value;

        if (!token) {
            return NextResponse.json(
                { success: false, error: 'Not authenticated' },
                { status: 401 }
            );
        }

        // Verify token
        const payload = verifyToken(token);
        if (!payload) {
            return NextResponse.json(
                { success: false, error: 'Invalid or expired token' },
                { status: 401 }
            );
        }

        // Get user from database
        const user = await getUserById(payload.userId);
        if (!user) {
            return NextResponse.json(
                { success: false, error: 'User not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            data: { user: toPublicUser(user) },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get user';
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
