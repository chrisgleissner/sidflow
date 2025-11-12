import { promises as fs } from 'node:fs';
import { NextResponse } from 'next/server';
import { resolveCuratedRomFile } from '@/lib/server/rom-manifest';
import type { ApiResponse } from '@/lib/validation';

interface RouteParams {
  bundleId: string;
  fileName: string;
}

export async function GET(
  _request: Request,
  { params }: { params: RouteParams }
) {
  try {
    const match = await resolveCuratedRomFile(params.bundleId, params.fileName);
    if (!match) {
      const response: ApiResponse = {
        success: false,
        error: 'ROM file not found',
      };
      return NextResponse.json(response, { status: 404 });
    }

    const buffer = await fs.readFile(match.absolutePath);
    const headers = new Headers({
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.byteLength.toString(),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Last-Modified': new Date(match.modifiedAt).toUTCString(),
      'X-SHA256': match.sha256,
    });

    return new NextResponse(buffer, { status: 200, headers });
  } catch (error) {
    console.error('[api/playback/rom] Failed to read ROM file', params, error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to read ROM file',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}