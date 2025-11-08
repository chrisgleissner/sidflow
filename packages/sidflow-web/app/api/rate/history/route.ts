import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { resolveSidCollectionContext } from '@/lib/sid-collection';
import { listManualRatings } from '@/lib/tag-history';

function parseNumber(value: string | null, fallback: number, min: number, max: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseNumber(searchParams.get('page'), 1, 1, 100000);
    const pageSize = parseNumber(searchParams.get('pageSize'), 10, 1, 100);
    const query = searchParams.get('query') ?? undefined;

    const context = await resolveSidCollectionContext();
    const result = await listManualRatings({
      tagsPath: context.tagsPath,
      hvscRoot: context.hvscRoot,
      collectionRoot: context.collectionRoot,
      query,
      page,
      pageSize,
    });

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[api/rate/history] Failed to load rating history', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to load rating history',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
