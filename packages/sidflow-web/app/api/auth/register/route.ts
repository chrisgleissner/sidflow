/**
 * User registration endpoint
 * POST /api/auth/register
 */

import { NextResponse } from 'next/server';
import { createUser, toPublicUser } from '@/lib/server/user-storage';
import { generateToken } from '@/lib/server/jwt';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { username, password } = body;

        if (!username || !password) {
            return NextResponse.json(
                { success: false, error: 'Username and password are required' },
                { status: 400 }
            );
        }

        // Create user
        const user = await createUser(username, password);

        // Generate JWT token
        const token = generateToken({
            userId: user.id,
            username: user.username,
        });

        // Return user info and set cookie
        const response = NextResponse.json({
            success: true,
            data: { user: toPublicUser(user) },
        });

        // Set httpOnly cookie
        response.cookies.set('sidflow_auth', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
            path: '/',
        });

        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Registration failed';
        return NextResponse.json(
            { success: false, error: message },
            { status: 400 }
        );
    }
}
