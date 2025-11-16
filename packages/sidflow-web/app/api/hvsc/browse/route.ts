/**
 * HVSC Browse API - List folders and SID files in HVSC collection
 * 
 * GET /api/hvsc/browse?path=MUSICIANS/H/Hubbard_Rob
 * 
 * Returns folder contents with metadata for navigation and playback
 */

import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "@sidflow/common";

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
 * Parse SID file header to extract subtune count
 */
async function getSidSubtuneCount(filePath: string): Promise<number> {
  try {
    const buffer = await readFile(filePath);
    
    // SID header: songs count at offset 0x0E-0x0F (big-endian)
    if (buffer.length >= 0x10) {
      const songs = (buffer[0x0e] << 8) | buffer[0x0f];
      return songs > 0 ? songs : 1;
    }
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Browse HVSC folder structure
 */
export async function GET(request: NextRequest): Promise<NextResponse<HvscBrowseResponse>> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const requestedPath = searchParams.get("path") || "";

    // Load config to get sidPath
    const config = await loadConfig();
    const hvscRoot = config.sidPath;

    if (!hvscRoot) {
      return NextResponse.json({
        success: false,
        path: requestedPath,
        items: [],
        error: "HVSC path not configured",
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

    // Read directory contents
    const entries = await readdir(resolvedPath, { withFileTypes: true });
    
    // Process entries
    const items: HvscBrowseItem[] = [];
    
    for (const entry of entries) {
      const entryPath = path.join(resolvedPath, entry.name);
      const relativePath = path.relative(resolvedRoot, entryPath);
      
      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          path: relativePath,
          type: "folder",
        });
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sid")) {
        const stats = await stat(entryPath);
        const songs = await getSidSubtuneCount(entryPath);
        
        items.push({
          name: entry.name,
          path: relativePath,
          type: "file",
          size: stats.size,
          songs,
        });
      }
    }

    // Sort: folders first, then files, both alphabetically
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

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
