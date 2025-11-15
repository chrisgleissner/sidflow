import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { streamSessionAssetFile } from '@/lib/playback-session';

export const dynamic = 'force-dynamic';

const SUPPORTED_FORMATS = new Set(['wav', 'm4a', 'flac']);

type StreamFormat = 'wav' | 'm4a' | 'flac';

export async function GET(
    request: NextRequest,
    { params }: { params: { sessionId: string; format: string } }
) {
    const sessionId = params.sessionId;
    const requestedFormat = params.format?.toLowerCase();

    if (!sessionId || !requestedFormat || !SUPPORTED_FORMATS.has(requestedFormat)) {
        return NextResponse.json(
            { success: false, error: 'Unsupported playback format or missing session id' },
            { status: 404 }
        );
    }

    return streamSessionAssetFile(request, sessionId, requestedFormat as StreamFormat);
}
