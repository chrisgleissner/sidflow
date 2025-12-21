import path from "node:path";
import { readdir, rm, writeFile } from "node:fs/promises";

export interface DirectoryPlaylistOptions {
  /**
   * Playlist file name relative to the target directory.
   * Defaults to "playlist.m3u8".
   */
  playlistName?: string;
  /**
   * Minimum number of WAV files required before emitting a playlist.
   * Defaults to 2 (only emit when multiple WAVs exist).
   */
  minEntries?: number;
  /**
   * Include #EXTM3U/#EXTINF metadata lines. Defaults to true.
   */
  extended?: boolean;
}

const playlistUpdateChains = new Map<string, Promise<void>>();

export async function updateDirectoryPlaylist(
  dir: string,
  options: DirectoryPlaylistOptions = {}
): Promise<string | null> {
  const previous = playlistUpdateChains.get(dir) ?? Promise.resolve();
  let playlistPath: string | null = null;

  const run = previous
    .catch(() => undefined)
    .then(async () => {
      playlistPath = await writePlaylist(dir, options);
    })
    .finally(() => {
      if (playlistUpdateChains.get(dir) === run) {
        playlistUpdateChains.delete(dir);
      }
    });

  playlistUpdateChains.set(dir, run);
  await run;
  return playlistPath;
}

async function writePlaylist(
  dir: string,
  options: DirectoryPlaylistOptions
): Promise<string | null> {
  const playlistName = options.playlistName ?? "playlist.m3u8";
  const playlistPath = path.join(dir, playlistName);
  const minEntries = Math.max(1, options.minEntries ?? 2);
  const extended = options.extended ?? true;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await rm(playlistPath, { force: true });
      return null;
    }
    throw error;
  }

  const wavFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".wav"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  if (wavFiles.length < minEntries) {
    await rm(playlistPath, { force: true });
    return null;
  }

  const lines: string[] = [];
  if (extended) {
    lines.push("#EXTM3U");
  }

  for (const wavFile of wavFiles) {
    if (extended) {
      const title = wavFile.replace(/\.wav$/i, "");
      lines.push(`#EXTINF:-1,${title}`);
    }
    lines.push(wavFile);
  }

  const content = `${lines.join("\n")}\n`;
  await writeFile(playlistPath, content, "utf8");
  return playlistPath;
}
