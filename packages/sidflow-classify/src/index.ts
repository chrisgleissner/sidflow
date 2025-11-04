import {
  DEFAULT_RATINGS,
  clampRating,
  ensureDir,
  loadConfig,
  pathExists,
  parseSidFile,
  resolveAutoTagFilePath,
  resolveAutoTagKey,
  resolveManualTagPath,
  resolveMetadataPath,
  resolveRelativeSidPath,
  sidMetadataToJson,
  stringifyDeterministic,
  toPosixRelative,
  type AudioFeatures,
  type ClassificationRecord,
  type JsonValue,
  type SidFileMetadata,
  type SidflowConfig,
  type TagRatings
} from "@sidflow/common";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Progress reporting configuration
const ANALYSIS_PROGRESS_INTERVAL = 50; // Report every N files during analysis
const AUTOTAG_PROGRESS_INTERVAL = 10; // Report every N files during auto-tagging

export interface ClassifyOptions {
  configPath?: string;
  forceRebuild?: boolean;
}

export interface ClassificationPlan {
  config: SidflowConfig;
  wavCachePath: string;
  tagsPath: string;
  forceRebuild: boolean;
  classificationDepth: number;
  hvscPath: string;
  sidplayPath: string;
}

export async function planClassification(
  options: ClassifyOptions = {}
): Promise<ClassificationPlan> {
  const config = await loadConfig(options.configPath);
  void stringifyDeterministic({});
  return {
    config,
    wavCachePath: config.wavCachePath,
    tagsPath: config.tagsPath,
    forceRebuild: options.forceRebuild ?? false,
    classificationDepth: config.classificationDepth,
    hvscPath: config.hvscPath,
    sidplayPath: config.sidplayPath
  };
}

const SID_EXTENSION = ".sid";

async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

export function resolveWavPath(
  plan: ClassificationPlan, 
  sidFile: string, 
  songIndex?: number
): string {
  const relative = path.relative(plan.hvscPath, sidFile);
  if (relative.startsWith("..")) {
    throw new Error(`SID file ${sidFile} is not within HVSC path ${plan.hvscPath}`);
  }

  const directory = path.dirname(relative);
  const baseName = path.basename(relative, path.extname(relative));
  const wavName = songIndex !== undefined 
    ? `${baseName}-${songIndex}.wav`
    : `${baseName}.wav`;
  return path.join(plan.wavCachePath, directory, wavName);
}

export async function collectSidFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name.toLowerCase().endsWith(SID_EXTENSION)) {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

export async function needsWavRefresh(
  sidFile: string,
  wavFile: string,
  forceRebuild: boolean
): Promise<boolean> {
  if (forceRebuild) {
    return true;
  }

  if (!(await pathExists(wavFile))) {
    return true;
  }

  const [sidStats, wavStats] = await Promise.all([stat(sidFile), stat(wavFile)]);
  
  // If SID file is older than WAV, no refresh needed
  if (sidStats.mtimeMs <= wavStats.mtimeMs) {
    return false;
  }

  // Timestamp changed - check if content actually changed by comparing hashes
  // Store hash in a sidecar file to avoid re-computing on every check
  const hashFile = `${wavFile}.hash`;
  if (await pathExists(hashFile)) {
    try {
      const storedHash = await readFile(hashFile, "utf8");
      const currentHash = await computeFileHash(sidFile);
      return storedHash.trim() !== currentHash.trim();
    } catch {
      // If hash file is corrupted, rebuild
      return true;
    }
  }

  // No hash file exists, need to rebuild
  return true;
}

export interface RenderWavOptions {
  sidFile: string;
  wavFile: string;
  sidplayPath: string;
  songIndex?: number;
}

export type RenderWav = (options: RenderWavOptions) => Promise<void>;

export const defaultRenderWav: RenderWav = async ({ sidFile, wavFile, sidplayPath, songIndex }) => {
  await ensureDir(path.dirname(wavFile));
  
  // Build sidplayfp command arguments
  const args = ["-w", wavFile];
  
  // Add song selection if specified (1-based index)
  if (songIndex !== undefined) {
    args.push(`-o${songIndex}`);
  }
  
  args.push(sidFile);
  
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sidplayPath, args, {
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`sidplayfp exited with code ${code}`));
      }
    });
  });

  // Store hash of SID file after successful WAV render
  const hashFile = `${wavFile}.hash`;
  try {
    const hash = await computeFileHash(sidFile);
    await writeFile(hashFile, hash, "utf8");
  } catch {
    // Hash storage is optional, continue even if it fails
  }
};

export interface WavCacheProgress {
  phase: "analyzing" | "building";
  totalFiles: number;
  processedFiles: number;
  renderedFiles: number;
  skippedFiles: number;
  percentComplete: number;
  elapsedMs: number;
  currentFile?: string;
}

export type ProgressCallback = (progress: WavCacheProgress) => void;

export interface BuildWavCacheOptions {
  sidplayPath?: string;
  render?: RenderWav;
  forceRebuild?: boolean;
  onProgress?: ProgressCallback;
  threads?: number; // Reserved for future parallel processing implementation
}

export interface PerformanceMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
}

export interface BuildWavCacheMetrics extends PerformanceMetrics {
  totalFiles: number;
  rendered: number;
  skipped: number;
  cacheHitRate: number;
}

export interface BuildWavCacheResult {
  rendered: string[];
  skipped: string[];
  metrics: BuildWavCacheMetrics;
}

export async function buildWavCache(
  plan: ClassificationPlan,
  options: BuildWavCacheOptions = {}
): Promise<BuildWavCacheResult> {
  const startTime = Date.now();
  const sidFiles = await collectSidFiles(plan.hvscPath);
  const rendered: string[] = [];
  const skipped: string[] = [];
  const sidplayPath = options.sidplayPath ?? plan.sidplayPath;
  const render = options.render ?? defaultRenderWav;
  const shouldForce = options.forceRebuild ?? plan.forceRebuild;
  const onProgress = options.onProgress;

  // First pass: count total songs to render
  const sidMetadataCache = new Map<string, SidFileMetadata>();
  let totalSongs = 0;
  
  for (const sidFile of sidFiles) {
    try {
      const metadata = await parseSidFile(sidFile);
      sidMetadataCache.set(sidFile, metadata);
      totalSongs += metadata.songs;
    } catch (error) {
      // If we can't parse the file, assume 1 song
      totalSongs += 1;
    }
  }

  const totalFiles = totalSongs;

  // Analysis phase: determine which files need rendering
  if (onProgress && totalFiles > 0) {
    onProgress({
      phase: "analyzing",
      totalFiles,
      processedFiles: 0,
      renderedFiles: 0,
      skippedFiles: 0,
      percentComplete: 0,
      elapsedMs: Date.now() - startTime
    });
  }

  interface SongToRender {
    sidFile: string;
    songIndex: number;
    wavFile: string;
  }

  const songsToRender: SongToRender[] = [];
  const songsToSkip: SongToRender[] = [];
  let processedSongs = 0;

  for (const sidFile of sidFiles) {
    const metadata = sidMetadataCache.get(sidFile);
    const songCount = metadata?.songs ?? 1;

    for (let songIndex = 1; songIndex <= songCount; songIndex++) {
      const wavFile = resolveWavPath(plan, sidFile, songIndex);
      
      if (await needsWavRefresh(sidFile, wavFile, shouldForce)) {
        songsToRender.push({ sidFile, songIndex, wavFile });
      } else {
        songsToSkip.push({ sidFile, songIndex, wavFile });
        skipped.push(wavFile);
      }

      processedSongs++;

      // Report analysis progress periodically
      if (onProgress && processedSongs % ANALYSIS_PROGRESS_INTERVAL === 0) {
        onProgress({
          phase: "analyzing",
          totalFiles,
          processedFiles: processedSongs,
          renderedFiles: 0,
          skippedFiles: songsToSkip.length,
          percentComplete: (processedSongs / totalFiles) * 100,
          elapsedMs: Date.now() - startTime
        });
      }
    }
  }

  // Building phase: render WAV files for each song
  for (let i = 0; i < songsToRender.length; i++) {
    const { sidFile, songIndex, wavFile } = songsToRender[i];

    await render({ sidFile, wavFile, sidplayPath, songIndex });
    rendered.push(wavFile);

    // Report progress after rendering completes
    if (onProgress) {
      onProgress({
        phase: "building",
        totalFiles,
        processedFiles: skipped.length + rendered.length,
        renderedFiles: rendered.length,
        skippedFiles: skipped.length,
        percentComplete: ((skipped.length + rendered.length) / totalFiles) * 100,
        elapsedMs: Date.now() - startTime,
        currentFile: `${path.basename(sidFile)} [${songIndex}]`
      });
    }
  }

  const endTime = Date.now();
  const cacheHitRate = totalFiles > 0 ? skipped.length / totalFiles : 0;

  const metrics: BuildWavCacheMetrics = {
    startTime,
    endTime,
    durationMs: endTime - startTime,
    totalFiles,
    rendered: rendered.length,
    skipped: skipped.length,
    cacheHitRate
  };

  return { rendered, skipped, metrics };
}

const RATING_DIMENSIONS: Array<keyof TagRatings> = ["e", "m", "c"];

export interface SidMetadata {
  title?: string;
  author?: string;
  released?: string;
}

export interface ExtractMetadataOptions {
  sidFile: string;
  sidplayPath: string;
  relativePath: string;
}

export type ExtractMetadata = (options: ExtractMetadataOptions) => Promise<SidMetadata>;

const SIDPLAY_METADATA_ARGS = ["-t1", "--none"] as const;

export const defaultExtractMetadata: ExtractMetadata = async ({ sidFile, sidplayPath, relativePath }) => {
  try {
    // Try to parse SID file directly for complete metadata
    const fullMetadata = await parseSidFile(sidFile);
    return {
      title: fullMetadata.title,
      author: fullMetadata.author,
      released: fullMetadata.released
    };
  } catch (parseError) {
    // Fall back to sidplayfp output parsing
    try {
      const output = await runSidplayForMetadata(sidFile, sidplayPath);
      return parseSidMetadataOutput(output);
    } catch (error) {
      return fallbackMetadataFromPath(relativePath, error);
    }
  }
};

async function runSidplayForMetadata(sidFile: string, sidplayPath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(sidplayPath, [...SIDPLAY_METADATA_ARGS, sidFile], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const message = stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`sidplayfp metadata extraction failed with code ${code}${message}`));
      }
    });
  });
}

const METADATA_FIELD_MAP = new Map<string, keyof SidMetadata>([
  ["title", "title"],
  ["author", "author"],
  ["released", "released"]
]);

export function parseSidMetadataOutput(output: string): SidMetadata {
  const metadata: SidMetadata = {};
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const match = trimmed.match(/^\|\s*(Title|Author|Released)\s*:\s*(.*?)\s*\|?$/i);
    if (!match) {
      continue;
    }
    const [, field, rawValue] = match;
    const value = rawValue.trim();
    if (!value) {
      continue;
    }
    const key = METADATA_FIELD_MAP.get(field.toLowerCase());
    if (key) {
      metadata[key] = value;
    }
  }
  return metadata;
}

export function fallbackMetadataFromPath(relativePath: string, _error?: unknown): SidMetadata {
  const segments = toPosixRelative(relativePath).split("/").filter(Boolean);
  const lastSegment = segments.at(-1) ?? "";
  const baseName = lastSegment.replace(/\.sid$/i, "");
  const title = baseName.replace(/[_\-]+/g, " ").trim();
  const author = segments.length >= 2 ? segments.at(-2) : undefined;
  return {
    title: title || undefined,
    author: author ? author.replace(/[_\-]+/g, " ").trim() || undefined : undefined
  };
}

type PartialTagRatings = Partial<TagRatings>;

interface ManualTagRecord {
  ratings: PartialTagRatings;
  timestamp?: string;
  source: string;
}

async function loadManualTagRecord(
  hvscPath: string,
  tagsPath: string,
  sidFile: string
): Promise<ManualTagRecord | null> {
  const tagPath = resolveManualTagPath(hvscPath, tagsPath, sidFile);
  if (!(await pathExists(tagPath))) {
    return null;
  }

  let fileContents: string;
  try {
    fileContents = await readFile(tagPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read manual tag at ${tagPath}`, { cause: error as Error });
  }

  let data: unknown;
  try {
    data = JSON.parse(fileContents);
  } catch (error) {
    throw new Error(`Invalid JSON in manual tag at ${tagPath}`, { cause: error as Error });
  }

  if (!data || typeof data !== "object") {
    throw new Error(`Manual tag at ${tagPath} must be a JSON object`);
  }

  const record = data as Record<string, unknown>;
  const ratings: PartialTagRatings = {};
  for (const dimension of RATING_DIMENSIONS) {
    const raw = record[dimension];
    if (typeof raw === "number" && !Number.isNaN(raw)) {
      ratings[dimension] = clampRating(raw);
    }
  }
  
  // Also load preference rating if present (not predicted by classifier)
  const pRaw = record.p;
  if (typeof pRaw === "number" && !Number.isNaN(pRaw)) {
    ratings.p = clampRating(pRaw);
  }

  const timestamp = typeof record.timestamp === "string" ? record.timestamp : undefined;
  const source = typeof record.source === "string" ? record.source : "manual";

  return { ratings, timestamp, source };
}

function hasMissingDimensions(ratings: PartialTagRatings): boolean {
  return RATING_DIMENSIONS.some((dimension) => ratings[dimension] === undefined);
}

type ClassificationSource = "manual" | "auto" | "mixed";

interface AutoTagEntry extends TagRatings {
  source: ClassificationSource;
}

function combineRatings(
  manual: PartialTagRatings | null,
  auto: TagRatings | null
): { ratings: TagRatings; source: ClassificationSource } {
  const ratings: TagRatings = { ...DEFAULT_RATINGS };
  let manualCount = 0;
  let autoCount = 0;

  for (const dimension of RATING_DIMENSIONS) {
    if (manual && manual[dimension] !== undefined) {
      ratings[dimension] = clampRating(manual[dimension] as number);
      manualCount += 1;
      continue;
    }

    if (auto && auto[dimension] !== undefined) {
      ratings[dimension] = clampRating(auto[dimension]);
      autoCount += 1;
      continue;
    }

    const defaultValue = DEFAULT_RATINGS[dimension];
    if (defaultValue !== undefined) {
      ratings[dimension] = defaultValue;
    }
  }
  
  // Preserve manual preference rating if present (not predicted by classifier)
  if (manual && manual.p !== undefined) {
    ratings.p = clampRating(manual.p);
  }

  if (manualCount === 0 && autoCount > 0) {
    return { ratings, source: "auto" };
  }
  if (manualCount > 0 && autoCount > 0) {
    return { ratings, source: "mixed" };
  }
  return { ratings, source: "manual" };
}

export interface FeatureVector {
  [feature: string]: number;
}

export interface ExtractFeaturesOptions {
  wavFile: string;
  sidFile: string;
}

export type FeatureExtractor = (options: ExtractFeaturesOptions) => Promise<FeatureVector>;

export interface PredictRatingsOptions {
  features: FeatureVector;
  sidFile: string;
  relativePath: string;
  metadata: SidMetadata;
}

export type PredictRatings = (options: PredictRatingsOptions) => Promise<TagRatings>;

export const defaultFeatureExtractor: FeatureExtractor = async () => {
  throw new Error(
    "Feature extraction requires Essentia.js. Provide a custom featureExtractor implementation."
  );
};

export const defaultPredictRatings: PredictRatings = async () => {
  throw new Error(
    "Prediction requires a trained TensorFlow.js model. Provide a custom predictRatings implementation."
  );
};

function metadataToJson(metadata: SidMetadata): Record<string, JsonValue> {
  const record: Record<string, JsonValue> = {};
  if (metadata.title) {
    record.title = metadata.title;
  }
  if (metadata.author) {
    record.author = metadata.author;
  }
  if (metadata.released) {
    record.released = metadata.released;
  }
  return record;
}

async function writeMetadataRecord(
  plan: ClassificationPlan,
  sidFile: string,
  metadata: SidMetadata,
  cachedFullMetadata?: SidFileMetadata
): Promise<string> {
  const metadataPath = resolveMetadataPath(plan.hvscPath, plan.tagsPath, sidFile);
  await ensureDir(path.dirname(metadataPath));
  
  // Build metadata object with simple fields
  const metadataJson = metadataToJson(metadata);
  
  // Use cached metadata if available, otherwise try to parse
  if (cachedFullMetadata) {
    const fullJson = sidMetadataToJson(cachedFullMetadata);
    // Merge full metadata with the simple metadata (simple metadata takes precedence for basic fields)
    Object.assign(metadataJson, fullJson, {
      title: metadata.title || cachedFullMetadata.title,
      author: metadata.author || cachedFullMetadata.author,
      released: metadata.released || cachedFullMetadata.released
    });
  } else {
    // Fallback: try to parse if no cache provided (backward compatibility)
    try {
      const fullMetadata = await parseSidFile(sidFile);
      const fullJson = sidMetadataToJson(fullMetadata);
      Object.assign(metadataJson, fullJson, {
        title: metadata.title || fullMetadata.title,
        author: metadata.author || fullMetadata.author,
        released: metadata.released || fullMetadata.released
      });
    } catch {
      // If we can't parse the SID file, just use the simple metadata
    }
  }
  
  await writeFile(metadataPath, stringifyDeterministic(metadataJson));
  return metadataPath;
}

export interface AutoTagProgress {
  phase: "metadata" | "tagging" | "jsonl";
  totalFiles: number;
  processedFiles: number;
  percentComplete: number;
  elapsedMs: number;
  currentFile?: string;
}

export type AutoTagProgressCallback = (progress: AutoTagProgress) => void;

export interface GenerateAutoTagsOptions {
  extractMetadata?: ExtractMetadata;
  featureExtractor?: FeatureExtractor;
  predictRatings?: PredictRatings;
  onProgress?: AutoTagProgressCallback;
}

export interface GenerateAutoTagsMetrics extends PerformanceMetrics {
  totalFiles: number;
  autoTaggedCount: number;
  manualOnlyCount: number;
  mixedCount: number;
  predictionsGenerated: number;
}

export interface GenerateAutoTagsResult {
  autoTagged: string[];
  manualEntries: string[];
  mixedEntries: string[];
  metadataFiles: string[];
  tagFiles: string[];
  metrics: GenerateAutoTagsMetrics;
}

export async function generateAutoTags(
  plan: ClassificationPlan,
  options: GenerateAutoTagsOptions = {}
): Promise<GenerateAutoTagsResult> {
  const startTime = Date.now();
  const sidFiles = await collectSidFiles(plan.hvscPath);
  const extractMetadata = options.extractMetadata ?? defaultExtractMetadata;
  const featureExtractor = options.featureExtractor ?? defaultFeatureExtractor;
  const predictRatings = options.predictRatings ?? defaultPredictRatings;
  const onProgress = options.onProgress;

  const autoTagged: string[] = [];
  const manualEntries: string[] = [];
  const mixedEntries: string[] = [];
  const metadataFiles: string[] = [];
  const tagFiles: string[] = [];
  let predictionsGenerated = 0;

  const grouped = new Map<string, Map<string, AutoTagEntry>>();

  // First pass: parse files and count total songs in a single pass
  async function collectSidMetadataAndSongCount(
    sidFiles: string[]
  ): Promise<{ sidMetadataCache: Map<string, SidFileMetadata>; totalSongs: number }> {
    const sidMetadataCache = new Map<string, SidFileMetadata>();
    let totalSongs = 0;
    for (const sidFile of sidFiles) {
      try {
        const fullMetadata = await parseSidFile(sidFile);
        sidMetadataCache.set(sidFile, fullMetadata);
        totalSongs += fullMetadata.songs;
      } catch {
        // If we can't parse the file, assume 1 song
        totalSongs += 1;
      }
    }
    return { sidMetadataCache, totalSongs };
  }

  const { sidMetadataCache, totalSongs } = await collectSidMetadataAndSongCount(sidFiles);
  const totalFiles = totalSongs;
  let processedSongs = 0;

  for (const sidFile of sidFiles) {
    const relativePath = resolveRelativeSidPath(plan.hvscPath, sidFile);
    const posixRelative = toPosixRelative(relativePath);

    // Extract metadata once per SID file
    const metadata = await extractMetadata({
      sidFile,
      sidplayPath: plan.sidplayPath,
      relativePath: posixRelative
    });
    
    // Get song count from parsed metadata
    const fullMetadata = sidMetadataCache.get(sidFile);
    const metadataPath = await writeMetadataRecord(plan, sidFile, metadata, fullMetadata);
    metadataFiles.push(metadataPath);

    const songCount = fullMetadata?.songs ?? 1;

    // Process each song within the SID file
    for (let songIndex = 1; songIndex <= songCount; songIndex++) {
      // Report progress periodically
      if (onProgress && processedSongs % AUTOTAG_PROGRESS_INTERVAL === 0) {
        onProgress({
          phase: "metadata",
          totalFiles,
          processedFiles: processedSongs,
          percentComplete: (processedSongs / totalFiles) * 100,
          elapsedMs: Date.now() - startTime,
          currentFile: `${path.basename(sidFile)} [${songIndex}/${songCount}]`
        });
      }

      const manualRecord = await loadManualTagRecord(plan.hvscPath, plan.tagsPath, sidFile);
      const needsAuto = !manualRecord || hasMissingDimensions(manualRecord.ratings);
      let autoRatings: TagRatings | null = null;

      if (needsAuto) {
        const wavPath = resolveWavPath(plan, sidFile, songIndex);
        if (!(await pathExists(wavPath))) {
          throw new Error(
            `Missing WAV cache for ${posixRelative} song ${songIndex}. Run buildWavCache before generateAutoTags.`
          );
        }

        if (onProgress) {
          onProgress({
            phase: "tagging",
            totalFiles,
            processedFiles: processedSongs,
            percentComplete: (processedSongs / totalFiles) * 100,
            elapsedMs: Date.now() - startTime,
            currentFile: `${path.basename(sidFile)} [${songIndex}/${songCount}]`
          });
        }

        const features = await featureExtractor({ wavFile: wavPath, sidFile });
        autoRatings = await predictRatings({
          features,
          sidFile,
          relativePath: posixRelative,
          metadata
        });
        predictionsGenerated += 1;
      }

      const { ratings, source } = combineRatings(manualRecord?.ratings ?? null, autoRatings);

      // Create a unique key for this song
      // For single-song files, use just the path (backwards compatible)
      // For multi-song files, use "path:songIndex" format
      const songKey = songCount > 1 ? `${posixRelative}:${songIndex}` : posixRelative;

      if (source === "auto") {
        autoTagged.push(songKey);
      } else if (source === "manual") {
        manualEntries.push(songKey);
      } else {
        mixedEntries.push(songKey);
      }

      const autoFilePath = resolveAutoTagFilePath(
        plan.tagsPath,
        relativePath,
        plan.classificationDepth
      );
      const baseKey = toPosixRelative(resolveAutoTagKey(relativePath, plan.classificationDepth));
      const key = songCount > 1 ? `${baseKey}:${songIndex}` : baseKey;
      
      const entry: AutoTagEntry = { ...ratings, source };
      const existingEntries = grouped.get(autoFilePath);
      if (existingEntries) {
        existingEntries.set(key, entry);
      } else {
        grouped.set(autoFilePath, new Map([[key, entry]]));
      }

      processedSongs++;
    }
  }

  for (const [autoFilePath, entries] of grouped) {
    const sorted = [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const record: Record<string, JsonValue> = {};
    for (const [key, entry] of sorted) {
      const entryData: Record<string, JsonValue> = {
        e: entry.e,
        m: entry.m,
        c: entry.c,
        source: entry.source
      };
      
      // Include preference rating if present
      if (entry.p !== undefined) {
        entryData.p = entry.p;
      }
      
      record[key] = entryData;
    }
    await ensureDir(path.dirname(autoFilePath));
    await writeFile(autoFilePath, stringifyDeterministic(record));
    tagFiles.push(autoFilePath);
  }

  const endTime = Date.now();
  const metrics: GenerateAutoTagsMetrics = {
    startTime,
    endTime,
    durationMs: endTime - startTime,
    totalFiles: sidFiles.length,
    autoTaggedCount: autoTagged.length,
    manualOnlyCount: manualEntries.length,
    mixedCount: mixedEntries.length,
    predictionsGenerated
  };

  return { autoTagged, manualEntries, mixedEntries, metadataFiles, tagFiles, metrics };
}

/**
 * Options for generating JSONL classification output.
 */
export interface GenerateJsonlOptions {
  /** Feature extractor to use for extracting audio features */
  featureExtractor?: FeatureExtractor;
  /** Rating predictor to use for generating ratings */
  predictRatings?: PredictRatings;
  /** Metadata extractor to use for extracting SID metadata */
  extractMetadata?: ExtractMetadata;
  /** Progress callback */
  onProgress?: AutoTagProgressCallback;
}

/**
 * Result from generating JSONL classification output.
 */
export interface GenerateJsonlResult {
  /** Path to generated JSONL file */
  jsonlFile: string;
  /** Total number of records written */
  recordCount: number;
  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Generates JSONL classification output with ratings and features.
 * Outputs one JSON record per line to classified/*.jsonl files.
 * 
 * @param plan - Classification plan with paths and config
 * @param options - Options for feature extraction and rating prediction
 * @returns Result with output file path and metrics
 */
export async function generateJsonlOutput(
  plan: ClassificationPlan,
  options: GenerateJsonlOptions = {}
): Promise<GenerateJsonlResult> {
  const startTime = Date.now();
  const sidFiles = await collectSidFiles(plan.hvscPath);
  const extractMetadata = options.extractMetadata ?? defaultExtractMetadata;
  const featureExtractor = options.featureExtractor ?? heuristicFeatureExtractor;
  const predictRatings = options.predictRatings ?? heuristicPredictRatings;
  const onProgress = options.onProgress;

  // Use classifiedPath from config or default to tags path
  const classifiedPath = plan.config.classifiedPath ?? path.join(plan.tagsPath, "classified");
  await ensureDir(classifiedPath);

  // Generate output filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
  const jsonlFile = path.join(classifiedPath, `classification_${timestamp}.jsonl`);

  const records: string[] = [];

  // First pass: count total songs
  const sidMetadataCache = new Map<string, SidFileMetadata>();
  let totalSongs = 0;
  
  for (const sidFile of sidFiles) {
    try {
      const fullMetadata = await parseSidFile(sidFile);
      sidMetadataCache.set(sidFile, fullMetadata);
      totalSongs += fullMetadata.songs;
    } catch {
      // If we can't parse the file, assume 1 song
      totalSongs += 1;
    }
  }

  const totalFiles = totalSongs;
  let processedSongs = 0;

  for (const sidFile of sidFiles) {
    const relativePath = resolveRelativeSidPath(plan.hvscPath, sidFile);
    const posixRelative = toPosixRelative(relativePath);

    // Load metadata once per SID file
    const metadata = await extractMetadata({
      sidFile,
      sidplayPath: plan.sidplayPath,
      relativePath: posixRelative
    });

    // Get song count from parsed metadata
    const fullMetadata = sidMetadataCache.get(sidFile);
    const songCount = fullMetadata?.songs ?? 1;

    // Process each song within the SID file
    for (let songIndex = 1; songIndex <= songCount; songIndex++) {
      // Report progress periodically
      if (onProgress && processedSongs % AUTOTAG_PROGRESS_INTERVAL === 0) {
        onProgress({
          phase: "jsonl",
          totalFiles,
          processedFiles: processedSongs,
          percentComplete: (processedSongs / totalFiles) * 100,
          elapsedMs: Date.now() - startTime,
          currentFile: `${path.basename(sidFile)} [${songIndex}/${songCount}]`
        });
      }

      // Load manual ratings if available
      const manualRecord = await loadManualTagRecord(plan.hvscPath, plan.tagsPath, sidFile);
      
      // Extract features and generate ratings for this song
      const wavPath = resolveWavPath(plan, sidFile, songIndex);
      let features: AudioFeatures | undefined;
      let ratings: TagRatings;

      if (await pathExists(wavPath)) {
        // Extract features from WAV file
        const rawFeatures = await featureExtractor({ wavFile: wavPath, sidFile });
        features = rawFeatures as AudioFeatures;

        // If we have manual ratings with all dimensions, use them; otherwise predict
        if (manualRecord && !hasMissingDimensions(manualRecord.ratings)) {
          // All dimensions present, safe to use as TagRatings
          ratings = manualRecord.ratings as TagRatings;
        } else {
          // Generate predictions
          const autoRatings = await predictRatings({
            features: rawFeatures,
            sidFile,
            relativePath: posixRelative,
            metadata
          });
          // Merge with manual ratings if available
          const combined = combineRatings(manualRecord?.ratings ?? null, autoRatings);
          ratings = combined.ratings;
        }
      } else {
        // No WAV file, use manual ratings or defaults
        if (manualRecord && !hasMissingDimensions(manualRecord.ratings)) {
          ratings = manualRecord.ratings as TagRatings;
        } else {
          // Use heuristic prediction based on metadata and song index
          const seed = computeSeed(posixRelative + (metadata.title ?? "") + songIndex.toString());
          ratings = {
            e: clampRating(toRating(seed)),
            m: clampRating(toRating(seed + 1)),
            c: clampRating(toRating(seed + 2))
          };
        }
      }

      // Create classification record with song index
      const record: ClassificationRecord = {
        sid_path: posixRelative,
        ratings
      };

      // Include song index if there are multiple songs
      if (songCount > 1) {
        record.song_index = songIndex;
      }

      // Include features if available
      if (features) {
        record.features = features;
      }

      // Append as JSONL (one JSON object per line)
      // Use stringifyDeterministic with no spacing (compact) and trim the trailing newline
      records.push(stringifyDeterministic(record as unknown as JsonValue, 0).trimEnd());
      
      processedSongs++;
    }
  }

  // Write all records to file
  await writeFile(jsonlFile, records.join("\n") + "\n", "utf8");

  const endTime = Date.now();
  return {
    jsonlFile,
    recordCount: records.length,
    durationMs: endTime - startTime
  };
}

function computeSeed(value: string): number {
  let seed = 0;
  for (let index = 0; index < value.length; index += 1) {
    seed = (seed * 31 + value.charCodeAt(index)) % 1_000_000;
  }
  return seed;
}

function toRating(seed: number): number {
  const value = ((Math.floor(seed) % 5) + 5) % 5;
  return value + 1;
}

export const heuristicFeatureExtractor: FeatureExtractor = async ({ wavFile, sidFile }) => {
  const [wavStats, sidStats] = await Promise.all([stat(wavFile), stat(sidFile)]);
  const baseName = path.basename(sidFile);
  return {
    wavBytes: wavStats.size,
    sidBytes: sidStats.size,
    nameSeed: computeSeed(baseName)
  } satisfies FeatureVector;
};

export const heuristicPredictRatings: PredictRatings = async ({
  features,
  relativePath,
  metadata
}) => {
  const baseSeed = computeSeed(relativePath + (metadata.title ?? ""));
  const tempoSeed = baseSeed + (features.wavBytes ?? 0);
  const moodSeed = baseSeed + (metadata.author ? computeSeed(metadata.author) : 0);
  const complexitySeed = baseSeed + (features.sidBytes ?? 0) + (features.nameSeed ?? 0);

  return {
    e: clampRating(toRating(tempoSeed)),
    m: clampRating(toRating(moodSeed)),
    c: clampRating(toRating(complexitySeed))
  };
};

// Re-export Essentia.js and TensorFlow.js implementations
export { essentiaFeatureExtractor } from "./essentia-features.js";
export {
  tfjsPredictRatings,
  tfjsPredictRatingsWithConfidence,
  disposeModel,
  createModel,
  loadModel,
  saveModel,
  loadFeatureStats,
  saveFeatureStats,
  loadModelMetadata,
  saveModelMetadata,
  computeFeatureStats,
  trainOnFeedback,
  evaluateModel,
  getModelPath,
  MODEL_VERSION,
  FEATURE_SET_VERSION,
  EXPECTED_FEATURES,
  type FeatureStats,
  type ModelMetadata,
  type TrainingSummary,
  type TrainOptions
} from "./tfjs-predictor.js";
