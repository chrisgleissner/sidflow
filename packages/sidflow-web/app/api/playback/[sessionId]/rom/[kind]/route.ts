import { NextResponse, type NextRequest } from 'next/server';
import { streamSessionRomFile } from '@/lib/playback-session';

export const dynamic = 'force-dynamic';

const VALID_KINDS = ['kernal', 'basic', 'chargen'] as const;
type RomKind = (typeof VALID_KINDS)[number];

type RouteParams = { sessionId: string; kind: string };

export async function GET(_request: NextRequest, context: { params: Promise<RouteParams> }) {
    const { sessionId, kind } = await context.params;

    if (!sessionId || !kind || !VALID_KINDS.includes(kind as RomKind)) {
        return NextResponse.json({ success: false, error: 'Invalid ROM request' }, { status: 400 });
    }

    return streamSessionRomFile(sessionId, kind as RomKind);
}
