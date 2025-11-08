import path from 'node:path';
import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { getRepoRoot, getSidflowConfig } from '@/lib/server-env';

export async function GET() {
  try {
    const config = await getSidflowConfig();
    const root = getRepoRoot();
    const hvscPath = path.resolve(root, config.hvscPath);
    const musicPath = path.join(hvscPath, 'C64Music');
    const response: ApiResponse<{ hvscPath: string; musicPath: string }> = {
      success: true,
      data: {
        hvscPath,
        musicPath,
      },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: 'Failed to load HVSC path',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
