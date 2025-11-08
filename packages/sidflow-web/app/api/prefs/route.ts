import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getWebPreferences, updateWebPreferences } from '@/lib/preferences-store';
import { resolveSidCollectionContext } from '@/lib/sid-collection';
import { getRepoRoot } from '@/lib/server-env';
import type { ApiResponse } from '@/lib/validation';
import { promises as fs } from 'node:fs';

interface PreferencesResponse {
  hvscRoot: string;
  defaultCollectionPath: string;
  activeCollectionPath: string;
  preferenceSource: 'default' | 'custom';
  preferences: Awaited<ReturnType<typeof getWebPreferences>>;
}

function buildResponsePayload(
  context: Awaited<ReturnType<typeof resolveSidCollectionContext>>,
  preferences: Awaited<ReturnType<typeof getWebPreferences>>
): PreferencesResponse {
  return {
    hvscRoot: context.hvscRoot,
    defaultCollectionPath: context.defaultCollectionRoot,
    activeCollectionPath: context.collectionRoot,
    preferenceSource: context.preferenceSource,
    preferences,
  };
}

export async function GET() {
  const context = await resolveSidCollectionContext();
  const preferences = await getWebPreferences();
  const response: ApiResponse<PreferencesResponse> = {
    success: true,
    data: buildResponsePayload(context, preferences),
  };
  return NextResponse.json(response, { status: 200 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawPath: unknown = body?.sidBasePath ?? null;
    let normalizedPath: string | null = null;

    if (typeof rawPath === 'string' && rawPath.trim().length > 0) {
      const repoRoot = getRepoRoot();
      const targetPath = path.isAbsolute(rawPath)
        ? path.normalize(rawPath)
        : path.resolve(repoRoot, rawPath);
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        throw new Error('Provided path is not a directory');
      }
      normalizedPath = targetPath;
    } else if (rawPath !== null) {
      throw new Error('sidBasePath must be a string or null');
    }

    const updatedPrefs = await updateWebPreferences({
      sidBasePath: normalizedPath,
    });

    const context = await resolveSidCollectionContext();
    const response: ApiResponse<PreferencesResponse> = {
      success: true,
      data: buildResponsePayload(context, updatedPrefs),
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: 'Failed to update preferences',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 400 });
  }
}
