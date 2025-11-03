/**
 * Playlist export functionality (JSON and M3U formats).
 */

import { writeFile } from "node:fs/promises";
import { stringifyDeterministic } from "@sidflow/common";
import type { Playlist } from "./playlist.js";

/**
 * Export playlist to JSON format with full metadata.
 */
export async function exportPlaylistJSON(
  playlist: Playlist,
  outputPath: string
): Promise<void> {
  const content = stringifyDeterministic(playlist);
  await writeFile(outputPath, content, "utf-8");
}

/**
 * Export playlist to M3U format for external players.
 */
export async function exportPlaylistM3U(
  playlist: Playlist,
  outputPath: string,
  options?: {
    /** Root path to prepend to SID paths */
    rootPath?: string;
    /** Include extended M3U metadata (#EXTINF) */
    extended?: boolean;
  }
): Promise<void> {
  const lines: string[] = [];
  
  if (options?.extended) {
    lines.push("#EXTM3U");
  }

  for (const song of playlist.songs) {
    if (options?.extended) {
      // Add EXTINF line with duration and title
      const duration = song.features?.duration || -1;
      const title = song.sid_path.split("/").pop() || song.sid_path;
      lines.push(`#EXTINF:${Math.floor(duration as number)},${title}`);
    }
    
    // Add file path
    const path = options?.rootPath 
      ? `${options.rootPath}/${song.sid_path}`
      : song.sid_path;
    lines.push(path);
  }

  const content = lines.join("\n") + "\n";
  await writeFile(outputPath, content, "utf-8");
}

/**
 * Export formats enum.
 */
export enum ExportFormat {
  JSON = "json",
  M3U = "m3u",
  M3U_EXTENDED = "m3u8"
}

/**
 * Export options.
 */
export interface ExportOptions {
  /** Output file path */
  outputPath: string;
  /** Export format */
  format: ExportFormat;
  /** Root path for M3U exports */
  rootPath?: string;
}

/**
 * Export playlist in specified format.
 */
export async function exportPlaylist(
  playlist: Playlist,
  options: ExportOptions
): Promise<void> {
  switch (options.format) {
    case ExportFormat.JSON:
      await exportPlaylistJSON(playlist, options.outputPath);
      break;
    case ExportFormat.M3U:
      await exportPlaylistM3U(playlist, options.outputPath, {
        rootPath: options.rootPath,
        extended: false
      });
      break;
    case ExportFormat.M3U_EXTENDED:
      await exportPlaylistM3U(playlist, options.outputPath, {
        rootPath: options.rootPath,
        extended: true
      });
      break;
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }
}
