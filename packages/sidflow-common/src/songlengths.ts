import { access, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveRelativeSidPath, toPosixRelative } from "./tags.js";

export interface SonglengthsData {
  map: Map<string, string>;
  paths: string[];
  lengthByPath: Map<string, string>;
  musicRoot: string;
  sourcePath: string | null;
}

const songlengthsCache = new Map<string, Promise<SonglengthsData>>();
const lengthCache = new Map<string, string | null>();
const durationCache = new Map<string, number[] | null>();
const md5Cache = new Map<string, Promise<string>>();

interface SonglengthsCandidate {
  filePath: string;
  musicRoot: string;
}

const SONG_LENGTH_CANDIDATES: Array<(root: string) => SonglengthsCandidate> = [
  (root) => ({
    filePath: path.join(root, "DOCUMENTS", "Songlengths.md5"),
    musicRoot: root
  }),
  (root) => ({
    filePath: path.join(root, "C64Music", "DOCUMENTS", "Songlengths.md5"),
    musicRoot: path.join(root, "C64Music")
  }),
  (root) => ({
    filePath: path.join(root, "update", "DOCUMENTS", "Songlengths.md5"),
    musicRoot: path.join(root, "update")
  })
];

function normalisePathForSonglengths(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "");
  return trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function stripHvscPrefixes(relativePath: string): string {
  const normalised = normalisePathForSonglengths(relativePath);
  const lower = normalised.toLowerCase();
  if (lower.startsWith("c64music/")) {
    return normalised.slice("c64music/".length);
  }
  if (lower.startsWith("update/")) {
    return normalised.slice("update/".length);
  }
  return normalised;
}

async function inferDefaultMusicRoot(root: string): Promise<string> {
  const preferred = path.join(root, "C64Music");
  try {
    await access(preferred);
    return preferred;
  } catch {
    return root;
  }
}

async function resolveSonglengthsFile(root: string): Promise<{ filePath: string | null; musicRoot: string }>
{
  for (const resolveCandidate of SONG_LENGTH_CANDIDATES) {
    const candidate = resolveCandidate(root);
    try {
      await access(candidate.filePath);
      return { filePath: candidate.filePath, musicRoot: candidate.musicRoot };
    } catch {
      continue;
    }
  }
  return { filePath: null, musicRoot: await inferDefaultMusicRoot(root) };
}

export async function loadSonglengthsData(hvscPath: string): Promise<SonglengthsData> {
  if (songlengthsCache.has(hvscPath)) {
    return songlengthsCache.get(hvscPath)!;
  }

  const loader = (async () => {
    const { filePath, musicRoot } = await resolveSonglengthsFile(hvscPath);
    if (!filePath) {
      return {
        map: new Map<string, string>(),
        paths: [],
        lengthByPath: new Map<string, string>(),
        musicRoot,
        sourcePath: null
      } satisfies SonglengthsData;
    }

    const contents = await readFile(filePath, "utf8");
    const map = new Map<string, string>();
    const paths: string[] = [];
    const lengthByPath = new Map<string, string>();

    let currentPath: string | null = null;
    const lines = contents.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (line.startsWith(";")) {
        const comment = line.slice(1).trim();
        if (comment.toLowerCase().endsWith(".sid")) {
          currentPath = stripHvscPrefixes(comment);
        }
        continue;
      }
      if (line.startsWith("[")) {
        continue;
      }
      const match = line.match(/^([0-9a-fA-F]{32})=(.+)$/);
      if (!match) {
        continue;
      }
      const [, hash, value] = match;
      const normalisedHash = hash.toLowerCase();
      const trimmedValue = value.trim();
      map.set(normalisedHash, trimmedValue);
      if (currentPath) {
        paths.push(currentPath);
        lengthByPath.set(currentPath, trimmedValue);
        currentPath = null;
      }
    }

    return { map, paths, lengthByPath, musicRoot, sourcePath: filePath } satisfies SonglengthsData;
  })();

  songlengthsCache.set(hvscPath, loader);
  return loader;
}

async function computeFileMd5(filePath: string): Promise<string> {
  if (!md5Cache.has(filePath)) {
    md5Cache.set(
      filePath,
      new Promise<string>((resolve, reject) => {
        const hash = createHash("md5");
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk as Buffer));
        stream.once("error", reject);
        stream.once("end", () => resolve(hash.digest("hex")));
      })
    );
  }
  return await md5Cache.get(filePath)!;
}

function computeRelativeKey(
  filePath: string,
  hvscPath: string,
  musicRoot?: string
): string | null {
  try {
    const relative = resolveRelativeSidPath(hvscPath, filePath);
    if (relative) {
      return stripHvscPrefixes(relative);
    }
  } catch {
    // Ignore; try music root fallback below
  }

  if (musicRoot) {
    const relativeFromMusic = path.relative(musicRoot, filePath);
    if (!relativeFromMusic.startsWith("..") && !path.isAbsolute(relativeFromMusic)) {
      return stripHvscPrefixes(toPosixRelative(relativeFromMusic));
    }
  }

  return null;
}

export async function lookupSongLength(
  filePath: string,
  hvscPath: string,
  musicRoot?: string
): Promise<string | undefined> {
  const cacheKey = `${hvscPath}::${filePath}`;
  if (lengthCache.has(cacheKey)) {
    const cached = lengthCache.get(cacheKey);
    return cached ?? undefined;
  }

  const data = await loadSonglengthsData(hvscPath);
  const relativeKey = computeRelativeKey(filePath, hvscPath, musicRoot ?? data.musicRoot);
  if (relativeKey) {
    const fromPath = data.lengthByPath.get(relativeKey);
    if (fromPath) {
      lengthCache.set(cacheKey, fromPath);
      return fromPath;
    }
  }

  if (data.map.size === 0) {
    lengthCache.set(cacheKey, null);
    return undefined;
  }

  try {
    const md5 = await computeFileMd5(filePath);
    const value = data.map.get(md5.toLowerCase()) ?? null;
    lengthCache.set(cacheKey, value);
    return value ?? undefined;
  } catch (error) {
    console.warn("[songlengths] Failed to compute MD5 for", filePath, error);
    lengthCache.set(cacheKey, null);
    return undefined;
  }
}

export function parseSonglengthValue(value: string): number[] {
  const tokens = value.split(/\s+/).map((token) => token.trim()).filter(Boolean);
  const durations: number[] = [];
  for (const token of tokens) {
    const match = token.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) {
      continue;
    }
    const minutes = Number.parseInt(match[1], 10);
    const seconds = Number.parseInt(match[2], 10);
    const fraction = match[3];
    let milliseconds = 0;
    if (fraction) {
      const fractionValue = Number.parseInt(fraction, 10);
      const scale = 10 ** Math.max(0, 3 - fraction.length);
      milliseconds = fractionValue * scale;
    }
    const totalMs = minutes * 60_000 + seconds * 1_000 + milliseconds;
    durations.push(totalMs);
  }
  return durations;
}

export async function lookupSongDurationsMs(
  filePath: string,
  hvscPath: string,
  musicRoot?: string
): Promise<number[] | undefined> {
  const cacheKey = `${hvscPath}::${filePath}`;
  if (durationCache.has(cacheKey)) {
    const cached = durationCache.get(cacheKey);
    return cached ?? undefined;
  }

  const value = await lookupSongLength(filePath, hvscPath, musicRoot);
  if (!value) {
    durationCache.set(cacheKey, null);
    return undefined;
  }

  const durations = parseSonglengthValue(value);
  durationCache.set(cacheKey, durations);
  return durations;
}

export async function lookupSongDurationMs(
  filePath: string,
  hvscPath: string,
  songIndex = 1,
  musicRoot?: string
): Promise<number | undefined> {
  const durations = await lookupSongDurationsMs(filePath, hvscPath, musicRoot);
  if (!durations || durations.length === 0) {
    return undefined;
  }
  const index = Number.isFinite(songIndex) ? Math.max(1, Math.floor(songIndex)) - 1 : 0;
  const safeIndex = Math.min(index, durations.length - 1);
  return durations[safeIndex];
}

export function clearSonglengthCaches(): void {
  songlengthsCache.clear();
  lengthCache.clear();
  durationCache.clear();
  md5Cache.clear();
}
