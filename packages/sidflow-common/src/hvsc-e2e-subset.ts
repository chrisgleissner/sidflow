import { copyFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { ensureDir, pathExists } from "./fs.js";
import { stringifyDeterministic, type JsonValue } from "./json.js";
import { createLogger } from "./logger.js";
import { parseSidFile, type SidFileMetadata, type SidModel } from "./sid-parser.js";

const hvscSubsetLogger = createLogger("hvscE2eSubset");

export const HVSC_E2E_SUBSET_VERSION = "1";
export const HVSC_E2E_SUBSET_SEED = 641_729;
export const HVSC_E2E_SUBSET_TARGET_COUNT = 300;
export const HVSC_E2E_AUTHOR_CAP = 5;

const HVSC_PRIMARY_MIRROR = "https://hvsc.brona.dk/HVSC/C64Music";
const HVSC_FALLBACK_MIRROR = "https://hvsc.c64.org/download/C64Music";
const HTTP_OK = 200;

export const HVSC_E2E_PROBLEMATIC_PATHS = [
  "GAMES/S-Z/Super_Mario_Bros_64_2SID.sid",
  "MUSICIANS/C/C0zmo/Space_Oddity_2SID.sid",
  "MUSICIANS/C/Chiummo_Gaetano/Waterfall_3SID.sid",
  "MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid",
] as const;

export type HvscE2eSource = "problematic" | "random";

export interface HvscE2eCatalogEntry {
  sidPath: string;
  author: string;
  title: string;
  released: string;
  songs: number;
  chipCount: number;
  sidModel1: SidModel;
  clock: SidFileMetadata["clock"];
  year: number | null;
  category: string;
  styleBucket: string;
}

export interface HvscE2eSubsetEntry extends HvscE2eCatalogEntry {
  source: HvscE2eSource;
  selectionBucket: string;
  stableHash: string;
}

export interface HvscE2eSubsetManifest {
  version: string;
  seed: number;
  targetCount: number;
  authorCap: number;
  sourceHvscCount: number;
  generatedAt: string;
  problematicPaths: string[];
  entries: HvscE2eSubsetEntry[];
}

export interface MaterializeHvscE2eSubsetOptions {
  localHvscRoot?: string;
  concurrency?: number;
  mirrorBaseUrls?: string[];
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeAuthor(author: string, sidPath: string): string {
  const trimmed = author.trim();
  if (trimmed.length > 0 && trimmed.toLowerCase() !== "unknown") {
    return trimmed;
  }

  const segments = sidPath.split("/");
  if (segments.length >= 2) {
    return segments[segments.length - 2] ?? "Unknown";
  }
  return "Unknown";
}

function parseReleasedYear(released: string): number | null {
  const matches = released.match(/(?:19|20)\d{2}/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  for (const match of matches) {
    const year = Number.parseInt(match, 10);
    if (Number.isFinite(year) && year >= 1978 && year <= 2026) {
      return year;
    }
  }

  return null;
}

function deriveChipCount(metadata: SidFileMetadata): number {
  let chipCount = 1;
  if (metadata.secondSIDAddress) {
    chipCount += 1;
  }
  if (metadata.thirdSIDAddress) {
    chipCount += 1;
  }
  return chipCount;
}

function deriveCategory(sidPath: string): string {
  return sidPath.split("/")[0] ?? "UNKNOWN";
}

function deriveStyleBucket(sidPath: string): string {
  const segments = sidPath.split("/");
  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`;
  }
  return deriveCategory(sidPath);
}

function decadeBucket(year: number | null): string {
  if (year === null) {
    return "unknown";
  }
  return `${Math.floor(year / 10) * 10}s`;
}

function stableHash(seed: number, value: string): string {
  return createHash("sha256").update(`${seed}:${value}`).digest("hex");
}

function compareByStableHash(seed: number, left: string, right: string): number {
  const leftHash = stableHash(seed, left);
  const rightHash = stableHash(seed, right);
  if (leftHash === rightHash) {
    return left.localeCompare(right);
  }
  return leftHash.localeCompare(rightHash);
}

function buildSelectionBucket(entry: HvscE2eCatalogEntry): string {
  return [
    entry.category,
    decadeBucket(entry.year),
    `chip${entry.chipCount}`,
    entry.sidModel1,
    entry.styleBucket,
  ].join("|");
}

async function collectSidFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const sidFiles: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      sidFiles.push(...(await collectSidFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".sid")) {
      sidFiles.push(fullPath);
    }
  }

  sidFiles.sort((left, right) => left.localeCompare(right));
  return sidFiles;
}

function resolveC64MusicRoot(root: string): string {
  if (path.basename(root) === "C64Music") {
    return root;
  }
  return path.join(root, "C64Music");
}

export function getHvscE2eProblematicPaths(): string[] {
  return [...HVSC_E2E_PROBLEMATIC_PATHS];
}

export async function collectHvscE2eCatalog(hvscRoot: string): Promise<HvscE2eCatalogEntry[]> {
  const c64MusicRoot = resolveC64MusicRoot(hvscRoot);
  if (!(await pathExists(c64MusicRoot))) {
    throw new Error(`HVSC C64Music root not found at ${c64MusicRoot}`);
  }

  const sidFiles = await collectSidFiles(c64MusicRoot);
  const catalog: HvscE2eCatalogEntry[] = [];

  for (const sidFile of sidFiles) {
    const relativeSidPath = toPosix(path.relative(c64MusicRoot, sidFile));
    const metadata = await parseSidFile(sidFile);
    const year = parseReleasedYear(metadata.released);
    catalog.push({
      sidPath: relativeSidPath,
      author: normalizeAuthor(metadata.author, relativeSidPath),
      title: metadata.title,
      released: metadata.released,
      songs: metadata.songs,
      chipCount: deriveChipCount(metadata),
      sidModel1: metadata.sidModel1,
      clock: metadata.clock,
      year,
      category: deriveCategory(relativeSidPath),
      styleBucket: deriveStyleBucket(relativeSidPath),
    });
  }

  return catalog;
}

export function selectHvscE2eSubset(
  catalog: HvscE2eCatalogEntry[],
  options: {
    seed?: number;
    targetCount?: number;
    authorCap?: number;
    problematicPaths?: readonly string[];
  } = {},
): HvscE2eSubsetManifest {
  const seed = options.seed ?? HVSC_E2E_SUBSET_SEED;
  const targetCount = options.targetCount ?? HVSC_E2E_SUBSET_TARGET_COUNT;
  const authorCap = options.authorCap ?? HVSC_E2E_AUTHOR_CAP;
  const problematicPaths = [...(options.problematicPaths ?? HVSC_E2E_PROBLEMATIC_PATHS)].sort((left, right) => left.localeCompare(right));

  const byPath = new Map(catalog.map((entry) => [entry.sidPath, entry] as const));
  const selected: HvscE2eSubsetEntry[] = [];
  const selectedPaths = new Set<string>();
  const authorCounts = new Map<string, number>();

  const addEntry = (entry: HvscE2eCatalogEntry, source: HvscE2eSource): void => {
    const stableKey = stableHash(seed, entry.sidPath);
    selected.push({
      ...entry,
      source,
      selectionBucket: buildSelectionBucket(entry),
      stableHash: stableKey,
    });
    selectedPaths.add(entry.sidPath);
    authorCounts.set(entry.author, (authorCounts.get(entry.author) ?? 0) + 1);
  };

  for (const problematicPath of problematicPaths) {
    const entry = byPath.get(problematicPath);
    if (!entry) {
      throw new Error(`Problematic SID path is missing from the source catalog: ${problematicPath}`);
    }
    addEntry(entry, "problematic");
  }

  const randomPool = catalog.filter((entry) => entry.songs === 1 && !selectedPaths.has(entry.sidPath));
  const buckets = new Map<string, HvscE2eCatalogEntry[]>();

  for (const entry of randomPool) {
    const bucketKey = buildSelectionBucket(entry);
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(entry);
    buckets.set(bucketKey, bucket);
  }

  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => compareByStableHash(seed, left.sidPath, right.sidPath));
  }

  const orderedBuckets = [...buckets.entries()].sort((left, right) => {
    if (left[1].length !== right[1].length) {
      return left[1].length - right[1].length;
    }
    return compareByStableHash(seed, left[0], right[0]);
  });
  const bucketIndices = new Map<string, number>();

  while (selected.length < targetCount) {
    let progress = false;

    for (const [bucketKey, bucketEntries] of orderedBuckets) {
      let nextIndex = bucketIndices.get(bucketKey) ?? 0;
      while (nextIndex < bucketEntries.length) {
        const candidate = bucketEntries[nextIndex]!;
        nextIndex += 1;

        if (selectedPaths.has(candidate.sidPath)) {
          continue;
        }
        if ((authorCounts.get(candidate.author) ?? 0) >= authorCap) {
          continue;
        }

        bucketIndices.set(bucketKey, nextIndex);
        addEntry(candidate, "random");
        progress = true;
        break;
      }
      bucketIndices.set(bucketKey, nextIndex);

      if (selected.length >= targetCount) {
        break;
      }
    }

    if (!progress) {
      break;
    }
  }

  if (selected.length !== targetCount) {
    throw new Error(`Unable to select ${targetCount} HVSC files with author cap ${authorCap}; selected ${selected.length}`);
  }

  const maxAuthorCount = Math.max(...[...authorCounts.values(), 0]);
  if (maxAuthorCount > authorCap) {
    throw new Error(`Author cap violation: selected subset contains ${maxAuthorCount} files for one author (cap ${authorCap})`);
  }

  selected.sort((left, right) => left.sidPath.localeCompare(right.sidPath));

  return {
    version: HVSC_E2E_SUBSET_VERSION,
    seed,
    targetCount,
    authorCap,
    sourceHvscCount: catalog.length,
    generatedAt: new Date().toISOString(),
    problematicPaths,
    entries: selected,
  };
}

export async function loadHvscE2eSubsetManifest(manifestPath: string): Promise<HvscE2eSubsetManifest> {
  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8")) as HvscE2eSubsetManifest;

  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Invalid HVSC E2E subset manifest: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== manifest.targetCount) {
    throw new Error(`HVSC E2E subset manifest does not contain exactly ${manifest.targetCount} entries: ${manifestPath}`);
  }

  return manifest;
}

export async function writeHvscE2eSubsetManifest(manifestPath: string, manifest: HvscE2eSubsetManifest): Promise<void> {
  await ensureDir(path.dirname(manifestPath));
  await writeFile(manifestPath, stringifyDeterministic(manifest as unknown as JsonValue), "utf8");
}

async function fetchSidFromMirror(relativeSidPath: string, destination: string, mirrorBaseUrls: string[]): Promise<void> {
  const encodedPath = relativeSidPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  let lastError: Error | null = null;
  for (const mirrorBaseUrl of mirrorBaseUrls) {
    const url = `${mirrorBaseUrl}/${encodedPath}`;
    try {
      const response = await fetch(url);
      if (response.status !== HTTP_OK) {
        throw new Error(`Unexpected HTTP status ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await ensureDir(path.dirname(destination));
      await writeFile(destination, buffer);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      hvscSubsetLogger.warn(`Failed to fetch ${relativeSidPath} from ${url}: ${lastError.message}`);
    }
  }

  throw new Error(`Unable to fetch ${relativeSidPath} from any configured HVSC mirror`, { cause: lastError ?? undefined });
}

async function materializeOneSid(
  entry: HvscE2eSubsetEntry,
  c64MusicTargetRoot: string,
  localC64MusicRoot: string | null,
  mirrorBaseUrls: string[],
): Promise<string> {
  const destination = path.join(c64MusicTargetRoot, entry.sidPath);
  if (await pathExists(destination)) {
    return destination;
  }

  await ensureDir(path.dirname(destination));
  if (localC64MusicRoot) {
    const source = path.join(localC64MusicRoot, entry.sidPath);
    if (await pathExists(source)) {
      await copyFile(source, destination);
      return destination;
    }
  }

  await fetchSidFromMirror(entry.sidPath, destination, mirrorBaseUrls);
  return destination;
}

export async function materializeHvscE2eSubset(
  manifest: HvscE2eSubsetManifest,
  targetHvscRoot: string,
  options: MaterializeHvscE2eSubsetOptions = {},
): Promise<string[]> {
  const c64MusicTargetRoot = resolveC64MusicRoot(targetHvscRoot);
  const localC64MusicRoot = options.localHvscRoot
    ? resolveC64MusicRoot(options.localHvscRoot)
    : null;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 8));
  const mirrorBaseUrls = options.mirrorBaseUrls ?? [HVSC_PRIMARY_MIRROR, HVSC_FALLBACK_MIRROR];
  const pending = [...manifest.entries];
  const materialized: string[] = [];

  await ensureDir(c64MusicTargetRoot);

  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (pending.length > 0) {
      const entry = pending.shift();
      if (!entry) {
        continue;
      }
      const destination = await materializeOneSid(entry, c64MusicTargetRoot, localC64MusicRoot, mirrorBaseUrls);
      materialized.push(destination);
    }
  });

  await Promise.all(workers);
  materialized.sort((left, right) => left.localeCompare(right));
  return materialized;
}