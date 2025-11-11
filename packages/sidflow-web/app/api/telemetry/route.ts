import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Lightweight telemetry ingestion endpoint.
 * Currently discards payloads but responds 202 to keep navigator.sendBeacon happy.
 */
export async function POST(request: NextRequest) {
    try {
        // Consume body to avoid hanging connections; ignore failures because telemetry must be fire-and-forget.
        const text = await request.text();

        if (process.env.NODE_ENV === 'development') {
            try {
                const payload = text ? JSON.parse(text) : null;
                console.debug('[Telemetry API] received event', payload?.type ?? 'unknown');
            } catch {
                console.debug('[Telemetry API] received non-JSON payload');
            }
        }
    } catch (error) {
        return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) }, {
            status: 400,
        });
    }

    return new NextResponse(null, { status: 202 });
}

export async function GET() {
    return NextResponse.json({ success: true }, { status: 200 });
}
