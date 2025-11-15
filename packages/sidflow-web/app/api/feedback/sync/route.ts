import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface FeedbackSyncPayload {
  submittedAt?: string;
  baseModelVersion?: string | null;
  ratings?: Array<Record<string, unknown>>;
  implicit?: Array<Record<string, unknown>>;
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as FeedbackSyncPayload;
    if (process.env.NODE_ENV === 'development') {
      const ratingCount = payload.ratings?.length ?? 0;
      const implicitCount = payload.implicit?.length ?? 0;
      console.debug('[Feedback Sync API] received payload', ratingCount, implicitCount, payload.baseModelVersion ?? 'unknown');
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ success: true });
}
