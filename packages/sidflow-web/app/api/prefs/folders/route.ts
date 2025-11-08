import path from 'node:path';
import { promises as fs } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/lib/validation';
import { resolveSidCollectionContext } from '@/lib/sid-collection';

interface FolderEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

interface FolderListing {
  relativePath: string;
  absolutePath: string;
  entries: FolderEntry[];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const relativePath = searchParams.get('relative') ?? '';
    const context = await resolveSidCollectionContext();
    const hvscRoot = context.hvscRoot;
    const targetPath = path.resolve(hvscRoot, relativePath);

    if (!targetPath.startsWith(hvscRoot)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Path must stay within the HVSC root',
        } satisfies ApiResponse,
        { status: 400 }
      );
    }

    const directory = await fs.opendir(targetPath);
    const entries: FolderEntry[] = [];
    for await (const entry of directory) {
      if (!entry.isDirectory()) {
        continue;
      }
      const entryPath = path.join(relativePath, entry.name);
      const absoluteEntryPath = path.join(targetPath, entry.name);
      let hasChildren = false;
      try {
        const childDir = await fs.opendir(absoluteEntryPath);
        for await (const childEntry of childDir) {
          if (childEntry.isDirectory()) {
            hasChildren = true;
            break;
          }
        }
      } catch {
        hasChildren = false;
      }
      entries.push({
        name: entry.name,
        path: entryPath.replace(/\\/g, '/'),
        hasChildren,
      });
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    const response: ApiResponse<FolderListing> = {
      success: true,
      data: {
        relativePath: relativePath.replace(/\\/g, '/'),
        absolutePath: targetPath,
        entries,
      },
    };
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: 'Failed to list folders',
      details: error instanceof Error ? error.message : String(error),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
