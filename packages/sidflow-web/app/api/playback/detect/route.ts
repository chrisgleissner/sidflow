import { NextResponse } from 'next/server';
import { PLAYBACK_ENGINES } from '@/lib/preferences/schema';
import type { ApiResponse } from '@/lib/validation';

interface AdapterRecord {
  available: boolean;
  reasons?: string[];
  latencyMs?: number;
}

type AdapterMap = Record<(typeof PLAYBACK_ENGINES)[number], AdapterRecord>;

function buildDefaultAvailability(): AdapterMap {
  return {
    wasm: { available: true },
    'sidplayfp-cli': { available: false, reasons: ['sidplayfp bridge unavailable'] },
    'stream-wav': { available: false, reasons: ['Streaming cache not configured'] },
    'stream-mp3': { available: false, reasons: ['Streaming cache not configured'] },
    ultimate64: { available: false, reasons: ['Ultimate 64 endpoint not configured'] },
  };
}

export async function GET() {
  const data = {
    adapters: buildDefaultAvailability(),
  };

  const response: ApiResponse<typeof data> = {
    success: true,
    data,
  };

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}