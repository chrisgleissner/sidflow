/**
 * User profile endpoint
 * GET /api/users/[username]
 */

import { NextResponse } from 'next/server';
import { getUserByUsername, toPublicUser } from '@/lib/server/user-storage';
import { promises as fs } from 'fs';
import path from 'path';
import { pathExists } from '@sidflow/common';

async function getUserStats(username: string) {
    const feedbackDir = path.join(process.cwd(), 'data', 'feedback');

    if (!(await pathExists(feedbackDir))) {
        return {
            totalPlays: 0,
            totalLikes: 0,
            joinedAt: new Date().toISOString(),
        };
    }

    let totalPlays = 0;
    let totalLikes = 0;

    try {
        const years = await fs.readdir(feedbackDir);

        for (const year of years) {
            if (!/^\d{4}$/.test(year)) continue;

            const yearPath = path.join(feedbackDir, year);
            const months = await fs.readdir(yearPath);

            for (const month of months) {
                if (!/^\d{2}$/.test(month)) continue;

                const eventsPath = path.join(yearPath, month, 'events.jsonl');
                if (!(await pathExists(eventsPath))) continue;

                const content = await fs.readFile(eventsPath, 'utf-8');
                const lines = content.trim().split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const event = JSON.parse(line);
                        const eventUser = event.userId || 'anonymous';

                        if (eventUser === username) {
                            if (event.action === 'play') totalPlays++;
                            if (event.action === 'like') totalLikes++;
                        }
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        }
    } catch {
        // Return zeros on error
    }

    return {
        totalPlays,
        totalLikes,
    };
}

export async function GET(
    request: Request,
    context: { params: Promise<{ username: string }> }
) {
    try {
        const params = await context.params;
        const { username } = params;

        if (!username) {
            return NextResponse.json(
                { success: false, error: 'Username is required' },
                { status: 400 }
            );
        }

        const user = await getUserByUsername(username);

        if (!user) {
            return NextResponse.json(
                { success: false, error: 'User not found' },
                { status: 404 }
            );
        }

        const stats = await getUserStats(username);

        return NextResponse.json({
            success: true,
            data: {
                user: toPublicUser(user),
                stats: {
                    ...stats,
                    joinedAt: user.createdAt,
                },
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch user profile';
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
