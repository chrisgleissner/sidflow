/**
 * HVSC Browse API - List folders and SID files in HVSC collection
 * 
 * GET /api/hvsc/browse?path=MUSICIANS/H/Hubbard_Rob
 * 
 * Returns folder contents with metadata for navigation and playback
 */

import { NextRequest, NextResponse } from "next/server";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getRepoRoot, getSidflowConfig } from "@/lib/server-env";

export interface HvscBrowseItem {
  name: string;
  path: string;
  type: "folder" | "file";
  size?: number;
  songs?: number; // For SID files, number of subtunes
}

export interface HvscBrowseResponse {
  success: boolean;
  path: string;
  items: HvscBrowseItem[];
  parent?: string;
  error?: string;
}

/**
 * Cache directory listings to avoid repeated disk scans when tests hammer the same paths.
 * HVSC content is immutable during tests, so a generous TTL is safe.
 */
const DIRECTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const directoryCache = new Map<string, { items: HvscBrowseItem[]; timestamp: number }>();

/**
 * Parse SID file header to extract subtune count without reading the entire file.
 */
async function getSidSubtuneCount(filePath: string): Promise<number> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(0x10);
    await handle.read(buffer, 0, buffer.length, 0);
    const songs = (buffer[0x0e] << 8) | buffer[0x0f];
    return songs > 0 ? songs : 1;
  } catch {
    return 1;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function listDirectoryItems(
  resolvedPath: string,
  resolvedRoot: string
): Promise<HvscBrowseItem[]> {
  const cacheKey = `${resolvedRoot}::${resolvedPath}`;
  const cached = directoryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DIRECTORY_CACHE_TTL_MS) {
    return cached.items;
  }

  const entries = await readdir(resolvedPath, { withFileTypes: true });

  const tasks = entries.map(async (entry) => {
    const entryPath = path.join(resolvedPath, entry.name);
    const relativePath = path.relative(resolvedRoot, entryPath);

    if (entry.isDirectory()) {
      return {
        name: entry.name,
        path: relativePath,
        type: "folder" as const,
      };
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".sid")) {
      const [fileStats, songs] = await Promise.all([
        stat(entryPath),
        getSidSubtuneCount(entryPath),
      ]);

      return {
        name: entry.name,
        path: relativePath,
        type: "file" as const,
        size: fileStats.size,
        songs,
      };
    }

    return null;
  });

  const rawItems: (HvscBrowseItem | null)[] = await Promise.all(tasks);
  const items = rawItems.filter((item): item is HvscBrowseItem => item !== null);

  items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  directoryCache.set(cacheKey, { items, timestamp: Date.now() });
  return items;
}

/**
 * Browse HVSC folder structure
 */
export async function GET(request: NextRequest): Promise<NextResponse<HvscBrowseResponse>> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestedPath = searchParams.get("path") || "";

    // Load config to get sidPath
    const repoRoot = getRepoRoot();
    const config = await getSidflowConfig();
    const hvscRoot = path.resolve(repoRoot, config.sidPath);

    if (!hvscRoot) {
      return NextResponse.json({
        success: false,
        path: requestedPath,
        items: [],
        error: "SID path not configured",
      }, { status: 500 });
    }

    // Resolve and validate the full path
    const fullPath = path.join(hvscRoot, requestedPath);

    // Security: ensure path is within hvscRoot
    const resolvedPath = path.resolve(fullPath);
    const resolvedRoot = path.resolve(hvscRoot);
    if (!resolvedPath.startsWith(resolvedRoot)) {
      return NextResponse.json({
        success: false,
        path: requestedPath,
        items: [],
        error: "Invalid path",
      }, { status: 400 });
    }

    // Check if path exists
    try {
      const stats = await stat(resolvedPath);
      if (!stats.isDirectory()) {
        return NextResponse.json({
          success: false,
          path: requestedPath,
          items: [],
          error: "Path is not a directory",
        }, { status: 400 });
      }
    } catch (error) {
      return NextResponse.json({
        success: false,
        path: requestedPath,
        items: [],
        error: "Path not found",
      }, { status: 404 });
    }

    const items = await listDirectoryItems(resolvedPath, resolvedRoot);

    // Determine parent path
    const parent = requestedPath
      ? path.dirname(requestedPath) === "."
        ? ""
        : path.dirname(requestedPath)
      : undefined;

    return NextResponse.json({
      success: true,
      path: requestedPath,
      items,
      parent,
    });
  } catch (error) {
    console.error("[hvsc/browse] Error:", error);
    return NextResponse.json({
      success: false,
      path: "",
      items: [],
      error: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
