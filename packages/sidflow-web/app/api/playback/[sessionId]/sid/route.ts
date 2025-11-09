import type { NextRequest } from 'next/server';
import { streamSessionSidFile } from '@/lib/playback-session';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
    const params = await context.params;
    const sessionId = params.sessionId;
    if (!sessionId) {
        return streamSessionSidFile('');
    }
    return streamSessionSidFile(sessionId);
}
