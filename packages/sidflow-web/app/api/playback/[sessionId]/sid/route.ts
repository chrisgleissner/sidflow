import type { NextRequest } from 'next/server';
import { streamSessionSidFile } from '@/lib/playback-session';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: { sessionId: string } }) {
    const sessionId = context.params.sessionId;
    if (!sessionId) {
        return streamSessionSidFile('');
    }
    return streamSessionSidFile(sessionId);
}
