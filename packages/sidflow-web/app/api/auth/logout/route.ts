/**
 * User logout endpoint
 * POST /api/auth/logout
 */

import { NextResponse } from 'next/server';

export async function POST() {
    const response = NextResponse.json({
        success: true,
        data: { message: 'Logged out successfully' },
    });

    // Clear the auth cookie
    response.cookies.set('sidflow_auth', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
    });

    return response;
}
