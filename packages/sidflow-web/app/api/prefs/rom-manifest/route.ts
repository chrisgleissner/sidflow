import { NextResponse } from 'next/server';
import { loadRomManifest } from '@/lib/server/rom-manifest';
import type { ApiResponse } from '@/lib/validation';

export async function GET() {
  try {
    const manifest = await loadRomManifest();
    const response: ApiResponse<typeof manifest> = {
      success: true,
      data: manifest,
    };
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[api/prefs/rom-manifest] Failed to load ROM manifest', error);
    const response: ApiResponse = {
      success: false,
      error: 'ROM manifest unavailable',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}