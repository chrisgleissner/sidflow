/**
 * Activity stream endpoint
 * GET /api/activity
 * Returns recent listening activity from all users
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { pathExists } from '@sidflow/common';

interface ActivityEvent {
    username: string;
    sidPath: string;
    action: 'play' | 'like' | 'skip';
    timestamp: string;
}

async function getFeedbackEvents(limit: number): Promise<ActivityEvent[]> {
    const feedbackDir = path.join(process.cwd(), 'data', 'feedback');

    if (!(await pathExists(feedbackDir))) {
        return [];
    }

    const events: ActivityEvent[] = [];

    // Read feedback files from most recent to oldest
    const years = await fs.readdir(feedbackDir);
    const sortedYears = years.filter(y => /^\d{4}$/.test(y)).sort().reverse();

    for (const year of sortedYears) {
        if (events.length >= limit) break;

        const yearPath = path.join(feedbackDir, year);
        const months = await fs.readdir(yearPath);
        const sortedMonths = months.filter(m => /^\d{2}$/.test(m)).sort().reverse();

        for (const month of sortedMonths) {
            if (events.length >= limit) break;

            const eventsPath = path.join(yearPath, month, 'events.jsonl');
            if (!(await pathExists(eventsPath))) continue;

            try {
                const content = await fs.readFile(eventsPath, 'utf-8');
                const lines = content.trim().split('\n').filter(line => line.trim());

                // Parse lines in reverse (most recent first)
                for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
                    try {
                        const event = JSON.parse(lines[i]);

                        // Convert feedback events to activity events
                        events.push({
                            username: event.userId || 'anonymous',
                            sidPath: event.sidPath || 'unknown',
                            action: event.action || 'play',
                            timestamp: event.timestamp || new Date().toISOString(),
                        });
                    } catch {
                        // Skip invalid JSON lines
                    }
                }
            } catch {
                // Skip files that can't be read
            }
        }
    }

    return events.slice(0, limit);
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const limitParam = searchParams.get('limit');
        const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10)), 100) : 50;

        const events = await getFeedbackEvents(limit);

        return NextResponse.json({
            success: true,
            data: {
                events,
                count: events.length,
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch activity';
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
