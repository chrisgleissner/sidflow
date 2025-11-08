/**
 * Rate API endpoint - writes manual rating files without invoking interactive CLI
 */
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { RateRequestSchema, type ApiResponse } from '@/lib/validation';
import { getRepoRoot, getSidflowConfig } from '@/lib/server-env';
import { createTagFilePath, writeManualTag } from '@sidflow/rate';

function formatError(message: string, details?: string): ApiResponse {
  return {
    success: false,
    error: message,
    details,
  };
}

async function ensureSidExists(sidPath: string): Promise<void> {
  try {
    const information = await stat(sidPath);
    if (!information.isFile()) {
      throw new Error('Path exists but is not a file');
    }
  } catch (error) {
    throw new Error(`SID file not found at ${sidPath}`, { cause: error as Error });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = RateRequestSchema.parse(body);

    const repoRoot = getRepoRoot();
    const config = await getSidflowConfig();

    const hvscPath = path.resolve(repoRoot, config.hvscPath);
    const tagsPath = path.resolve(repoRoot, config.tagsPath);
    const sidAbsolutePath = path.isAbsolute(validatedData.sid_path)
      ? validatedData.sid_path
      : path.resolve(hvscPath, validatedData.sid_path);

    if (!sidAbsolutePath.startsWith(hvscPath)) {
      return NextResponse.json(
        formatError(
          'SID path outside HVSC mirror',
          `Expected file within ${hvscPath}, received ${sidAbsolutePath}`
        ),
        { status: 400 }
      );
    }

    await ensureSidExists(sidAbsolutePath);

    const tagFilePath = createTagFilePath(hvscPath, tagsPath, sidAbsolutePath);
    await writeManualTag(tagFilePath, validatedData.ratings, new Date());

    const response: ApiResponse<{ message: string; tagPath: string }> = {
      success: true,
      data: {
        message: `Saved rating for ${path.relative(hvscPath, sidAbsolutePath)}`,
        tagPath: tagFilePath,
      },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[api/rate] Failed to save rating', error);
    if (error instanceof ZodError) {
      return NextResponse.json(
        formatError(
          'Validation error',
          error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
        ),
        { status: 400 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
    const detailText = [message, cause].filter(Boolean).join(' | ') || undefined;

    return NextResponse.json(formatError('Failed to save rating', detailText), {
      status: 500,
    });
  }
}
