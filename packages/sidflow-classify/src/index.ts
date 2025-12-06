import {
  DEFAULT_RATINGS,
  clampRating,
  createLogger,
  ensureDir,
  loadConfig,
  lookupSongDurationsMs,
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
  writeCanonicalJsonLines,
  type AudioFeatures,
  type ClassificationRecord,
  type JsonValue,
  type SidFileMetadata,
  type SidflowConfig,
  type TagRatings
} from "@sidflow/common";
import { queueJsonlWrite, flushWriterQueue, clearWriterQueues, logJsonlPathOnce } from "./jsonl-writer-queue.js";
import { essentiaFeatureExtractor, setUseWorkerPool, FEATURE_EXTRACTION_SAMPLE_RATE } from "./essentia-features.js";
import { 
  FeatureExtractionPool, 
  getFeatureExtractionPool, 
  destroyFeatureExtractionPool 
} from "./feature-extraction-pool.js";
import type { SidAudioEngine } from "@sidflow/libsidplayfp-wasm";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WasmRendererPool } from "./render/wasm-render-pool.js";
import { createEngine, setEngineFactoryOverride } from "./render/engine-factory.js";
import {
  WAV_HASH_EXTENSION,
  computeFileHash,
  renderWavWithEngine,
  type RenderWavOptions
} from "./render/wav-renderer.js";
import { RenderOrchestrator, type RenderEngine, type RenderFormat } from "./render/render-orchestrator.js";
import { HEARTBEAT_CONFIG, RETRY_CONFIG, createClassifyError, withRetry, type ThreadCounters, type WorkerPhase } from "./types/state-machine.js";

// Progress reporting configuration
const ANALYSIS_PROGRESS_INTERVAL = 50; // Report every N files during analysis
const AUTOTAG_PROGRESS_INTERVAL = 10; // Report every N files during auto-tagging
const classifyLogger = createLogger("classify");

/** Heartbeat interval for long-running operations (ms) */
const HEARTBEAT_INTERVAL_MS = HEARTBEAT_CONFIG.INTERVAL_MS;

export type ThreadPhase = "analyzing" | "building" | "metadata" | "tagging";

/**
 * Thread activity update with structured logging support.
 * Backward compatible with existing consumers while supporting enhanced fields.
 */
export interface ThreadActivityUpdate {
  /** Thread identifier (1-based) */
  threadId: number;
  /** Current processing phase */
  phase: ThreadPhase;
  /** Thread status */
  status: "idle" | "working";
  /** Current file being processed (relative path) */
  file?: string;
  /** When this update was emitted (epoch ms) - optional for backward compatibility */
  timestamp?: number;
  /** Is this a heartbeat update (vs state transition) */
  isHeartbeat?: boolean;
  /** Song index for multi-song SIDs */
  songIndex?: number;
  /** Phase duration so far (ms) */
  phaseDurationMs?: number;
}

interface ConcurrentContext {
  threadId: number;
  itemIndex: number;
}

function resolveThreadCount(requested?: number): number {
  if (typeof requested === "number" && requested > 0) {
    return Math.max(1, Math.floor(requested));
  }
  const cores = os.cpus().length || 1;
  return Math.max(1, cores);
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, context: ConcurrentContext) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  // Helper to atomically get next index
  const getNextIndex = (): number | null => {
    if (nextIndex >= items.length) {
      return null;
    }
    const current = nextIndex;
    nextIndex += 1;
    return current;
  };

  const runners = Array.from({ length: limit }, async (_, workerIndex) => {
    const threadId = workerIndex + 1;
    // Yield immediately to prevent all workers from grabbing indices synchronously
    await Promise.resolve();

    let itemsProcessed = 0;
    while (true) {
      const currentIndex = getNextIndex();
      if (currentIndex === null) {
        classifyLogger.debug(
          `Thread ${threadId} finished after processing ${itemsProcessed} items`
        );
        break;
      }
      itemsProcessed++;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await worker(items[currentIndex]!, { threadId, itemIndex: currentIndex });
    }
  });

  await Promise.all(runners);
}

/**
 * Shared utility to collect SID file metadata and count total songs.
 * This function parses all SID files once and caches the metadata to avoid redundant I/O.
 * Used by buildAudioCache, generateAutoTags, and generateJsonlOutput.
 */
type EngineFactory = () => Promise<SidAudioEngine>;

let parseSidFileImpl: typeof parseSidFile = parseSidFile;

async function collectSidMetadataAndSongCount(
  sidFiles: string[]
): Promise<{ sidMetadataCache: Map<string, SidFileMetadata>; totalSongs: number }> {
  const sidMetadataCache = new Map<string, SidFileMetadata>();
  let totalSongs = 0;

  for (const sidFile of sidFiles) {
    try {
      const fullMetadata = await parseSidFileImpl(sidFile);
      sidMetadataCache.set(sidFile, fullMetadata);
      totalSongs += fullMetadata.songs;
    } catch {
      // If we can't parse the file, assume 1 song
      totalSongs += 1;
    }
  }

  return { sidMetadataCache, totalSongs };
}

function formatSongLabel(
  plan: ClassificationPlan,
  sidFile: string,
  songCount: number,
  songIndex: number
): string {
  const relative = toPosixRelative(path.relative(plan.sidPath, sidFile));
  if (songCount > 1) {
    return `${relative} [${songIndex}]`;
  }
  return relative;
}

export interface ClassifyOptions {
  configPath?: string;
  forceRebuild?: boolean;
}

export interface ClassificationPlan {
  config: SidflowConfig;
  audioCachePath: string;
  tagsPath: string;
  forceRebuild: boolean;
  classificationDepth: number;
  sidPath: string;
}

export async function planClassification(
  options: ClassifyOptions = {}
): Promise<ClassificationPlan> {
  const config = await loadConfig(options.configPath);
  void stringifyDeterministic({});
  return {
    config,
    audioCachePath: config.audioCachePath,
    tagsPath: config.tagsPath,
    forceRebuild: options.forceRebuild ?? false,
    classificationDepth: config.classificationDepth,
    sidPath: config.sidPath
  };
}

const SID_EXTENSION = ".sid";

export type { RenderWavOptions } from "./render/wav-renderer.js";
export {
  RenderOrchestrator,
  type RenderRequest,
  type RenderResult,
  type RenderEngine,
  type RenderFormat,
} from "./render/render-orchestrator.js";

export function resolveWavPath(
  plan: ClassificationPlan,
  sidFile: string,
  songIndex?: number
): string {
  // Handle virtual test paths (e.g., /virtual/test-tone-c4.sid)
  if (sidFile.startsWith("/virtual/") || sidFile.startsWith("virtual/")) {
    const baseName = path.basename(sidFile, path.extname(sidFile));
    const wavName = songIndex !== undefined
      ? `${baseName}-${songIndex}.wav`
      : `${baseName}.wav`;
    return path.join(plan.audioCachePath, "virtual", wavName);
  }

  const relative = path.relative(plan.sidPath, sidFile);
  if (relative.startsWith("..")) {
    throw new Error(`SID file ${sidFile} is not within SID path ${plan.sidPath}`);
  }

  const directory = path.dirname(relative);
  const baseName = path.basename(relative, path.extname(relative));
  const wavName = songIndex !== undefined
    ? `${baseName}-${songIndex}.wav`
    : `${baseName}.wav`;
  return path.join(plan.audioCachePath, directory, wavName);
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

/**
 * Checks if a SID song is already classified by looking at auto-tags.json.
 * This does NOT rely on WAV files existing (they may have been cleaned up).
 * 
 * @param plan - Classification plan containing paths and config
 * @param sidFile - Absolute path to the SID file
 * @param songIndex - Optional song index for multi-song SID files (1-based)
 * @returns true if the song has existing classification ratings
 */
export async function isAlreadyClassified(
  plan: ClassificationPlan,
  sidFile: string,
  songIndex?: number
): Promise<boolean> {
  const relativePath = resolveRelativeSidPath(plan.sidPath, sidFile);
  const autoTagsFile = resolveAutoTagFilePath(
    plan.tagsPath,
    relativePath,
    plan.classificationDepth
  );
  
  if (!(await pathExists(autoTagsFile))) {
    return false;
  }
  
  try {
    const content = await readFile(autoTagsFile, "utf8");
    const tags = JSON.parse(content) as Record<string, unknown>;
    
    const baseKey = toPosixRelative(resolveAutoTagKey(relativePath, plan.classificationDepth));
    const key = songIndex !== undefined ? `${baseKey}:${songIndex}` : baseKey;
    
    // Check if the key exists in the auto-tags
    if (key in tags) {
      const entry = tags[key] as Record<string, unknown>;
      // Verify it has at least one rating dimension
      return entry && (typeof entry.e === "number" || typeof entry.m === "number" || typeof entry.c === "number");
    }
    
    return false;
  } catch (error) {
    classifyLogger.warn(`Error reading auto-tags for ${relativePath}: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Deletes all audio files (WAV, FLAC, M4A) and their hash files from the WAV cache directory.
 * Used for force rebuild to start with a clean slate.
 */
export async function cleanAudioCache(audioCachePath: string): Promise<number> {
  if (!(await pathExists(audioCachePath))) {
    return 0;
  }

  const audioExtensions = [".wav", ".flac", ".m4a", WAV_HASH_EXTENSION];
  let deletedCount = 0;

  async function cleanDir(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await cleanDir(fullPath);
        continue;
      }
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (audioExtensions.includes(ext)) {
          try {
            await rm(fullPath, { force: true });
            deletedCount += 1;
          } catch (error) {
            classifyLogger.warn(`Failed to delete ${fullPath}: ${(error as Error).message}`);
          }
        }
      }
    }
  }

  await cleanDir(audioCachePath);
  return deletedCount;
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
  const hashFile = `${wavFile}${WAV_HASH_EXTENSION}`;
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

export type RenderWav = (options: RenderWavOptions) => Promise<void>;

/**
 * Default WAV renderer with multi-format audio encoding support.
 * - Respects config.render.defaultFormats for WAV/FLAC/M4A
 * - Uses RenderOrchestrator for audio encoding (ffmpeg-based)
 * - Falls back to WASM-only if audio encoding unavailable
 * 
 * Note: Multi-format with WASM engine requires sidplayfp-cli engine preference.
 * WASM multi-format is planned for future (status: future in render matrix).
 */
export const defaultRenderWav: RenderWav = async (options) => {
  const config = await loadConfig(process.env.SIDFLOW_CONFIG);
  const preferredEngines = (config.render?.preferredEngines as RenderEngine[]) ?? ['wasm'];
  const defaultFormats = (config.render?.defaultFormats ?? ['wav']) as RenderFormat[];
  const useCli = preferredEngines[0] === 'sidplayfp-cli';
  
  // Check if we need multi-format rendering
  const needsMultiFormat = defaultFormats.length > 1 || 
    (defaultFormats.length === 1 && defaultFormats[0] !== 'wav');

  if (useCli && needsMultiFormat) {
    // Use sidplayfp-cli via RenderOrchestrator for multi-format (fully implemented)
    const audioEncoderConfig = config.render?.audioEncoder;
    const orchestrator = new RenderOrchestrator({
      sidplayfpCliPath: config.sidplayPath,
      hvscRoot: config.sidPath,
      m4aBitrate: config.render?.m4aBitrate,
      flacCompressionLevel: config.render?.flacCompressionLevel,
      audioEncoderImplementation: audioEncoderConfig?.implementation,
      ffmpegWasmOptions: audioEncoderConfig?.wasm,
    });
    const outputDir = path.dirname(options.wavFile);
    await ensureDir(outputDir);
    
    await orchestrator.render({
      sidPath: options.sidFile,
      outputDir,
      engine: 'sidplayfp-cli',
      formats: defaultFormats,
      songIndex: options.songIndex,
      maxRenderSeconds: options.maxRenderSeconds,
      targetDurationMs: options.targetDurationMs,
    });
    
    // Rename WAV to expected location if needed
    const baseName = path.basename(options.sidFile, '.sid');
    const trackSuffix = options.songIndex !== undefined ? `-${options.songIndex}` : '';
    const chip = config.render?.defaultChip ?? '6581';
    const renderedFile = path.join(outputDir, `${baseName}${trackSuffix}-sidplayfp-cli-${chip}.wav`);
    if (renderedFile !== options.wavFile) {
      const fs = await import('node:fs/promises');
      await fs.rename(renderedFile, options.wavFile);
    }
  } else if (useCli) {
    // Use sidplayfp-cli via RenderOrchestrator for WAV-only
    const orchestrator = new RenderOrchestrator({
      sidplayfpCliPath: config.sidplayPath,
      hvscRoot: config.sidPath,
    });
    const outputDir = path.dirname(options.wavFile);
    await ensureDir(outputDir);
    
    await orchestrator.render({
      sidPath: options.sidFile,
      outputDir,
      engine: 'sidplayfp-cli',
      formats: ['wav'],
      songIndex: options.songIndex,
      maxRenderSeconds: options.maxRenderSeconds,
      targetDurationMs: options.targetDurationMs,
    });
    
    // Rename to expected location
    const baseName = path.basename(options.sidFile, '.sid');
    const trackSuffix = options.songIndex !== undefined ? `-${options.songIndex}` : '';
    const chip = config.render?.defaultChip ?? '6581';
    const renderedFile = path.join(outputDir, `${baseName}${trackSuffix}-sidplayfp-cli-${chip}.wav`);
    if (renderedFile !== options.wavFile) {
      const fs = await import('node:fs/promises');
      await fs.rename(renderedFile, options.wavFile);
    }
  } else {
    // Use WASM engine directly for WAV-only (fastest path, no multi-format support yet)
    // Multi-format with WASM is marked as 'future' in render matrix
    const engine = await createEngine();
    await renderWavWithEngine(engine, options);
    
    // TODO: When WASM multi-format is implemented (render matrix status: mvp),
    // add audio encoding here for defaultFormats containing flac/m4a
  }
};

export interface AudioCacheProgress {
  phase: "analyzing" | "building";
  totalFiles: number;
  processedFiles: number;
  renderedFiles: number;
  skippedFiles: number;
  percentComplete: number;
  elapsedMs: number;
  currentFile?: string;
}

export type ProgressCallback = (progress: AudioCacheProgress) => void;

export interface BuildAudioCacheOptions {
  render?: RenderWav;
  forceRebuild?: boolean;
  onProgress?: ProgressCallback;
  onThreadUpdate?: (update: ThreadActivityUpdate) => void;
  threads?: number;
}

export interface PerformanceMetrics {
  startTime: number;
  endTime: number;
  durationMs: number;
}

export interface BuildAudioCacheMetrics extends PerformanceMetrics {
  totalFiles: number;
  rendered: number;
  skipped: number;
  cacheHitRate: number;
}

export interface BuildAudioCacheResult {
  rendered: string[];
  skipped: string[];
  metrics: BuildAudioCacheMetrics;
}

export async function buildAudioCache(
  plan: ClassificationPlan,
  options: BuildAudioCacheOptions = {}
): Promise<BuildAudioCacheResult> {
  const startTime = Date.now();
  const shouldForce = options.forceRebuild ?? plan.forceRebuild;
  
  // If force rebuild is requested, delete all existing audio files first
  if (shouldForce) {
    classifyLogger.info("Force rebuild requested - cleaning audio cache...");
    const deletedCount = await cleanAudioCache(plan.audioCachePath);
    classifyLogger.info(`Deleted ${deletedCount} audio files from cache`);
  }
  
  const sidFiles = await collectSidFiles(plan.sidPath);
  classifyLogger.debug(
    `collectSidFiles found ${sidFiles.length} SID files in ${plan.sidPath}`
  );
  const rendered: string[] = [];
  const skipped: string[] = [];
  const render = options.render ?? defaultRenderWav;
  const onProgress = options.onProgress;
  const onThreadUpdate = options.onThreadUpdate;
  const songlengthPromises = new Map<string, Promise<number[] | undefined>>();

  const getSongDurations = (sidFile: string): Promise<number[] | undefined> => {
    const existing = songlengthPromises.get(sidFile);
    if (existing) {
      return existing;
    }
    const pending = lookupSongDurationsMs(sidFile, plan.sidPath).catch((error) => {
      classifyLogger.warn(
        `Failed to resolve song length for ${path.relative(plan.sidPath, sidFile)}: ${(error as Error).message}`
      );
      return undefined;
    });
    songlengthPromises.set(sidFile, pending);
    return pending;
  };

  let songlengthDebugCount = 0;

  // Collect SID metadata and count total songs using shared utility
  const { sidMetadataCache, totalSongs } = await collectSidMetadataAndSongCount(sidFiles);
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
    songCount: number;
  }

  const songsToRender: SongToRender[] = [];
  const songsToSkip: SongToRender[] = [];
  let analyzedSongs = 0;
  let debugLogCount = 0;

  const analysisConcurrency = resolveThreadCount(options.threads ?? plan.config.threads);
  await runConcurrent(
    sidFiles,
    analysisConcurrency,
    async (sidFile, context) => {
      const metadata = sidMetadataCache.get(sidFile);
      const songCount = metadata?.songs ?? 1;

      for (let songIndex = 1; songIndex <= songCount; songIndex++) {
        const wavFile = resolveWavPath(plan, sidFile, songCount > 1 ? songIndex : undefined);
        const songLabel = formatSongLabel(plan, sidFile, songCount, songIndex);
        onThreadUpdate?.({
          threadId: context.threadId,
          phase: "analyzing",
          status: "working",
          file: songLabel
        });

        const needsRefresh = await needsWavRefresh(sidFile, wavFile, shouldForce);
        if (debugLogCount < 5) {
          classifyLogger.debug(
            `needsWavRefresh(${songLabel}): ${needsRefresh}, wavFile: ${wavFile}`
          );
          debugLogCount++;
        }

        if (needsRefresh) {
          songsToRender.push({ sidFile, songIndex, wavFile, songCount });
        } else {
          songsToSkip.push({ sidFile, songIndex, wavFile, songCount });
          skipped.push(wavFile);
        }

        analyzedSongs += 1;

        if (
          onProgress &&
          (analyzedSongs % ANALYSIS_PROGRESS_INTERVAL === 0 || analyzedSongs === totalFiles)
        ) {
          onProgress({
            phase: "analyzing",
            totalFiles,
            processedFiles: analyzedSongs,
            renderedFiles: 0,
            skippedFiles: songsToSkip.length,
            percentComplete: totalFiles === 0 ? 100 : (analyzedSongs / totalFiles) * 100,
            elapsedMs: Date.now() - startTime,
            currentFile: songLabel
          });
        }
      }

      // Don't report idle status - threads will immediately start building phase
      // Reporting idle causes UI to show "waiting for work" during phase transition
    }
  );
  classifyLogger.debug(
    `Analysis complete: ${songsToRender.length} songs to render, ${songsToSkip.length} to skip`
  );

  // Building phase: render WAV files for each song
  const buildConcurrency = resolveThreadCount(options.threads ?? plan.config.threads);
  classifyLogger.debug(`Starting building phase with ${buildConcurrency} threads`);
  
  // Only use WasmRendererPool if using default render AND first preferred engine is WASM
  const preferredEngines = (plan.config.render?.preferredEngines as RenderEngine[]) ?? ['wasm'];
  const shouldUsePool = render === defaultRenderWav && preferredEngines[0] === 'wasm';
  const rendererPool = shouldUsePool ? new WasmRendererPool(buildConcurrency) : null;

  try {
    classifyLogger.debug(
      `About to call runConcurrent for building with ${songsToRender.length} songs`
    );
    await runConcurrent(
      songsToRender,
      buildConcurrency,
      async ({ sidFile, songIndex, wavFile, songCount }, context) => {
        if (rendered.length < 3) {
          classifyLogger.debug(
            `Thread ${context.threadId} starting to render: ${wavFile}`
          );
        }
        const songLabel = formatSongLabel(plan, sidFile, songCount, songIndex);
        const phaseStartedAt = Date.now();
        onThreadUpdate?.({
          threadId: context.threadId,
          phase: "building",
          status: "working",
          file: songLabel,
          timestamp: phaseStartedAt,
          songIndex: songCount > 1 ? songIndex : undefined,
        });

        // Start heartbeat to prevent thread from appearing stale during long renders
        const heartbeatInterval = setInterval(() => {
          const now = Date.now();
          onThreadUpdate?.({
            threadId: context.threadId,
            phase: "building",
            status: "working",
            file: songLabel,
            timestamp: now,
            isHeartbeat: true,
            phaseDurationMs: now - phaseStartedAt,
          });
        }, HEARTBEAT_INTERVAL_MS);

        let targetDurationMs: number | undefined;
        try {
          const durations = await getSongDurations(sidFile);
          if (durations && durations.length > 0) {
            const index = Math.min(Math.max(songIndex - 1, 0), durations.length - 1);
            targetDurationMs = durations[index];
            if (targetDurationMs !== undefined && songlengthDebugCount < 5) {
              classifyLogger.debug(
                `Resolved HVSC duration ${targetDurationMs}ms for ${songLabel}`
              );
              songlengthDebugCount += 1;
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          classifyLogger.warn(`Unable to resolve song length for ${songLabel}: ${message}`);
        }

        const renderOptions = {
          sidFile,
          wavFile,
          songIndex: songCount > 1 ? songIndex : undefined,
          targetDurationMs
        };
        let renderSucceeded = false;

        try {
          // Use configured retry logic with exponential backoff
          await withRetry(
            'building',
            async () => {
              if (rendererPool) {
                await rendererPool.render(renderOptions);
              } else {
                await render(renderOptions);
              }
            },
            {
              onRetry: (attempt, maxAttempts, error, delayMs) => {
                classifyLogger.warn(
                  `[RETRY] Attempt ${attempt}/${maxAttempts} failed for ${songLabel}: ${error.message}. Retrying in ${delayMs}ms...`
                );
              },
              onFatalError: (classifyError) => {
                classifyLogger.error(
                  `[FATAL] Unrecoverable error for ${songLabel}: ${classifyError.message}`
                );
              }
            }
          );
          renderSucceeded = true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          classifyLogger.warn(
            `Failed to render ${songLabel} after ${RETRY_CONFIG.building.maxRetries + 1} attempts: ${errorMessage}`
          );
          // Don't add to rendered list, effectively skipping this file
        } finally {
          clearInterval(heartbeatInterval);
        }
        
        if (renderSucceeded) {
          rendered.push(wavFile);
          if (rendered.length <= 3) {
            classifyLogger.debug(
              `Thread ${context.threadId} successfully rendered: ${wavFile}`
            );
          }

          if (onProgress) {
            const processed = skipped.length + rendered.length;
            onProgress({
              phase: "building",
              totalFiles,
              processedFiles: processed,
              renderedFiles: rendered.length,
              skippedFiles: skipped.length,
              percentComplete: totalFiles === 0 ? 100 : (processed / totalFiles) * 100,
              elapsedMs: Date.now() - startTime,
              currentFile: songLabel
            });
          }
        }

        onThreadUpdate?.({
          threadId: context.threadId,
          phase: "building",
          status: "idle"
        });
      }
    );
  } finally {
    await rendererPool?.destroy();
  }

  const endTime = Date.now();
  const cacheHitRate = totalFiles > 0 ? skipped.length / totalFiles : 0;

  const metrics: BuildAudioCacheMetrics = {
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
  relativePath: string;
}

export type ExtractMetadata = (options: ExtractMetadataOptions) => Promise<SidMetadata>;

function metadataFromTuneInfo(info: Record<string, unknown> | null): SidMetadata | null {
  if (!info) {
    return null;
  }
  const infoStrings = Array.isArray((info as Record<string, unknown>).infoStrings)
    ? (info as Record<string, unknown>).infoStrings
    : [];
  const [titleRaw, authorRaw, releasedRaw] = infoStrings as Array<unknown>;
  const title = typeof titleRaw === "string" && titleRaw.trim().length > 0 ? titleRaw.trim() : undefined;
  const author = typeof authorRaw === "string" && authorRaw.trim().length > 0 ? authorRaw.trim() : undefined;
  const released = typeof releasedRaw === "string" && releasedRaw.trim().length > 0 ? releasedRaw.trim() : undefined;
  if (!title && !author && !released) {
    return null;
  }
  return { title, author, released };
}

export const defaultExtractMetadata: ExtractMetadata = async ({ sidFile, relativePath }) => {
  try {
    // Try to parse SID file directly for complete metadata
    const fullMetadata = await parseSidFileImpl(sidFile);
    return {
      title: fullMetadata.title,
      author: fullMetadata.author,
      released: fullMetadata.released
    };
  } catch (parseError) {
    // Fall back to WASM tune info parsing
    try {
      const engine = await createEngine();
      const sidBuffer = new Uint8Array(await readFile(sidFile));
      await engine.loadSidBuffer(sidBuffer);
      const info = metadataFromTuneInfo(engine.getTuneInfo());
      if (info) {
        return info;
      }
      return fallbackMetadataFromPath(relativePath, parseError);
    } catch (error) {
      return fallbackMetadataFromPath(relativePath, error);
    }
  }
};

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
  sidPath: string,
  tagsPath: string,
  sidFile: string
): Promise<ManualTagRecord | null> {
  const tagPath = resolveManualTagPath(sidPath, tagsPath, sidFile);
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

/**
 * Audio feature vector with numeric features and string metadata.
 * Compatible with AudioFeatures in @sidflow/common.
 */
export interface FeatureVector {
  [feature: string]: number | string | undefined;
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

/**
 * Default feature extractor uses Essentia.js with automatic fallback to heuristic features.
 * This enables advanced audio analysis by default while maintaining robustness.
 */
export const defaultFeatureExtractor: FeatureExtractor = essentiaFeatureExtractor;

/**
 * Default rating predictor uses fast, deterministic heuristic algorithm.
 * No ML training required - generates stable ratings from file metadata.
 * Implemented as lazy evaluation to avoid initialization order issues.
 */
export const defaultPredictRatings: PredictRatings = async (options) => {
  // Lazy evaluation - calls the actual implementation defined later in the file
  return heuristicPredictRatings(options);
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
  const metadataPath = resolveMetadataPath(plan.sidPath, plan.tagsPath, sidFile);
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
      const fullMetadata = await parseSidFileImpl(sidFile);
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
  /** Number of files that required WAV rendering (not cached) */
  renderedFiles: number;
  /** Number of files that used cached WAV files */
  cachedFiles: number;
  /** Number of files with features extracted */
  extractedFiles: number;
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
  threads?: number;
  onThreadUpdate?: (update: ThreadActivityUpdate) => void;
  render?: RenderWav;
  /** Skip songs that are already classified (based on auto-tags.json, not WAV files).
   * This option is ignored if forceRebuild is true. */
  skipAlreadyClassified?: boolean;
  /** Delete WAV files after classification (for fly.io deployments with limited storage) */
  deleteWavAfterClassification?: boolean;
}

export interface GenerateAutoTagsMetrics extends PerformanceMetrics {
  totalFiles: number;
  autoTaggedCount: number;
  manualOnlyCount: number;
  mixedCount: number;
  predictionsGenerated: number;
  /** Number of songs skipped because they were already classified */
  skippedAlreadyClassified: number;
}

export interface GenerateAutoTagsResult {
  autoTagged: string[];
  manualEntries: string[];
  mixedEntries: string[];
  metadataFiles: string[];
  tagFiles: string[];
  /** Path to JSONL file with classification records (written incrementally) */
  jsonlFile: string;
  /** Number of records written to JSONL file */
  jsonlRecordCount: number;
  metrics: GenerateAutoTagsMetrics;
}

interface AutoTagJob {
  sidFile: string;
  relativePath: string;
  posixRelative: string;
  songIndex: number;
  songCount: number;
  metadata: SidMetadata;
  manualRecord: ManualTagRecord | null;
  wavPath: string;
  targetDurationMs?: number;
}

export async function generateAutoTags(
  plan: ClassificationPlan,
  options: GenerateAutoTagsOptions = {}
): Promise<GenerateAutoTagsResult> {
  const startTime = Date.now();
  
  // If force rebuild is requested, delete all existing audio files first
  if (plan.forceRebuild) {
    classifyLogger.info("Force rebuild requested - cleaning audio cache...");
    const deletedCount = await cleanAudioCache(plan.audioCachePath);
    classifyLogger.info(`Deleted ${deletedCount} audio files from cache`);
  }
  
  const sidFiles = await collectSidFiles(plan.sidPath);
  const extractMetadata = options.extractMetadata ?? defaultExtractMetadata;
  const featureExtractor = options.featureExtractor ?? defaultFeatureExtractor;
  const predictRatings = options.predictRatings ?? defaultPredictRatings;
  const onProgress = options.onProgress;
  const onThreadUpdate = options.onThreadUpdate;
  const render = options.render ?? defaultRenderWav;
  const skipAlreadyClassified = options.skipAlreadyClassified ?? false;
  const deleteWavAfterClassification = options.deleteWavAfterClassification ?? false;

  const autoTagged: string[] = [];
  const manualEntries: string[] = [];
  const mixedEntries: string[] = [];
  const metadataFiles: string[] = [];
  const tagFiles: string[] = [];
  const renderedWavFiles: string[] = []; // Track WAV files for potential cleanup
  let predictionsGenerated = 0;
  let skippedAlreadyClassifiedCount = 0;
  let renderedFilesCount = 0; // Files that required WAV rendering
  let cachedFilesCount = 0; // Files that used cached WAV files
  let extractedFilesCount = 0; // Files with features extracted

  const grouped = new Map<string, Map<string, AutoTagEntry>>();
  const songlengthPromises = new Map<string, Promise<number[] | undefined>>();
  
  // Set up JSONL file for incremental writes during classification
  const classifiedPath = plan.config.classifiedPath ?? path.join(plan.tagsPath, "classified");
  await ensureDir(classifiedPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
  const jsonlFile = path.join(classifiedPath, `classification_${timestamp}.jsonl`);
  let jsonlRecordCount = 0;
  
  // Cache for auto-tags.json files to avoid repeated reads for songs in the same directory
  const autoTagsCache = new Map<string, Record<string, unknown> | null>();
  
  /**
   * Check if a song is already classified using cached auto-tags data.
   * This is more efficient than calling isAlreadyClassified repeatedly
   * because many songs share the same auto-tags.json file.
   */
  const checkAlreadyClassified = async (
    sidFile: string,
    songIndex?: number
  ): Promise<boolean> => {
    const relativePath = resolveRelativeSidPath(plan.sidPath, sidFile);
    const autoTagsFile = resolveAutoTagFilePath(
      plan.tagsPath,
      relativePath,
      plan.classificationDepth
    );
    
    // Check cache first
    let tags = autoTagsCache.get(autoTagsFile);
    if (tags === undefined) {
      // Not in cache, load and cache it
      if (await pathExists(autoTagsFile)) {
        try {
          const content = await readFile(autoTagsFile, "utf8");
          tags = JSON.parse(content) as Record<string, unknown>;
        } catch (error) {
          classifyLogger.warn(`Error reading auto-tags for ${relativePath}: ${(error as Error).message}`);
          tags = null;
        }
      } else {
        tags = null;
      }
      autoTagsCache.set(autoTagsFile, tags);
    }
    
    if (!tags) {
      return false;
    }
    
    const baseKey = toPosixRelative(resolveAutoTagKey(relativePath, plan.classificationDepth));
    const key = songIndex !== undefined ? `${baseKey}:${songIndex}` : baseKey;
    
    if (key in tags) {
      const entry = tags[key] as Record<string, unknown>;
      return entry && (typeof entry.e === "number" || typeof entry.m === "number" || typeof entry.c === "number");
    }
    
    return false;
  };

  const getSongDurations = (sidFile: string): Promise<number[] | undefined> => {
    const existing = songlengthPromises.get(sidFile);
    if (existing) {
      return existing;
    }
    const pending = lookupSongDurationsMs(sidFile, plan.sidPath).catch((error) => {
      classifyLogger.warn(
        `Failed to resolve song length for ${path.relative(plan.sidPath, sidFile)}: ${(error as Error).message}`
      );
      return undefined;
    });
    songlengthPromises.set(sidFile, pending);
    return pending;
  };

  // Collect SID metadata and count total songs using shared utility
  const { sidMetadataCache, totalSongs } = await collectSidMetadataAndSongCount(sidFiles);
  const totalFiles = totalSongs;
  const jobs: AutoTagJob[] = [];
  let metadataProcessed = 0;

  for (const sidFile of sidFiles) {
    const relativePath = resolveRelativeSidPath(plan.sidPath, sidFile);
    const posixRelative = toPosixRelative(relativePath);

    const metadata = await extractMetadata({
      sidFile,
      relativePath: posixRelative
    });

    const fullMetadata = sidMetadataCache.get(sidFile);
    const metadataPath = await writeMetadataRecord(plan, sidFile, metadata, fullMetadata);
    metadataFiles.push(metadataPath);

    const songCount = fullMetadata?.songs ?? 1;
    const manualRecord = await loadManualTagRecord(plan.sidPath, plan.tagsPath, sidFile);
    const durations = await getSongDurations(sidFile);

    for (let songIndex = 1; songIndex <= songCount; songIndex++) {
      if (onProgress && metadataProcessed % AUTOTAG_PROGRESS_INTERVAL === 0) {
        onProgress({
          phase: "metadata",
          totalFiles,
          processedFiles: metadataProcessed,
          renderedFiles: renderedFilesCount,
          cachedFiles: cachedFilesCount,
          extractedFiles: extractedFilesCount,
          percentComplete: totalFiles === 0 ? 100 : (metadataProcessed / totalFiles) * 100,
          elapsedMs: Date.now() - startTime,
          currentFile: `${path.basename(sidFile)} [${songIndex}/${songCount}]`
        });
      }
      metadataProcessed += 1;

      // Skip songs that are already classified if requested (using cached check)
      if (skipAlreadyClassified && !plan.forceRebuild) {
        const alreadyClassified = await checkAlreadyClassified(
          sidFile,
          songCount > 1 ? songIndex : undefined
        );
        if (alreadyClassified) {
          skippedAlreadyClassifiedCount += 1;
          classifyLogger.debug(`Skipping already classified: ${path.basename(sidFile)} [${songIndex}/${songCount}]`);
          continue;
        }
      }

      const wavPath = resolveWavPath(plan, sidFile, songCount > 1 ? songIndex : undefined);
      jobs.push({
        sidFile,
        relativePath,
        posixRelative,
        songIndex,
        songCount,
        metadata,
        manualRecord,
        wavPath,
        targetDurationMs: durations?.[Math.min(Math.max(songIndex - 1, 0), (durations?.length ?? 1) - 1)]
      });
    }
  }
  
  if (skipAlreadyClassified && skippedAlreadyClassifiedCount > 0) {
    classifyLogger.info(`Skipped ${skippedAlreadyClassifiedCount} already classified songs`);
  }

  const taggingConcurrency = resolveThreadCount(options.threads ?? plan.config.threads);
  let processedSongs = 0;

  // Create renderer pool for inline WAV rendering during tagging phase
  // This ensures rendering happens in worker threads and doesn't block the main event loop
  const preferredEngines = (plan.config.render?.preferredEngines as RenderEngine[]) ?? ['wasm'];
  const shouldUsePool = render === defaultRenderWav && preferredEngines[0] === 'wasm';
  const rendererPool = shouldUsePool ? new WasmRendererPool(taggingConcurrency) : null;

  try {
    await runConcurrent(jobs, taggingConcurrency, async (job, context) => {
    const songLabel = formatSongLabel(plan, job.sidFile, job.songCount, job.songIndex);
    const taggingStartedAt = Date.now();
    onThreadUpdate?.({
      threadId: context.threadId,
      phase: "tagging",
      status: "working",
      file: songLabel,
      timestamp: taggingStartedAt,
      songIndex: job.songCount > 1 ? job.songIndex : undefined,
    });
    const manualRatings: PartialTagRatings | null = job.manualRecord?.ratings ?? null;
    const needsAuto = !job.manualRecord || hasMissingDimensions(manualRatings ?? {});
    let autoRatings: TagRatings | null = null;
    let extractedFeatures: FeatureVector | undefined;

    if (needsAuto) {
      if (!(await pathExists(job.wavPath))) {
        // Emit "building" phase for inline rendering
        const buildStartedAt = Date.now();
        onThreadUpdate?.({
          threadId: context.threadId,
          phase: "building",
          status: "working",
          file: songLabel,
          timestamp: buildStartedAt,
          songIndex: job.songCount > 1 ? job.songIndex : undefined,
        });
        
        // Start heartbeat to prevent thread from appearing stale during long renders
        // When using rendererPool, the worker runs in a separate thread so the main event loop
        // stays responsive and setInterval callbacks fire normally for heartbeat updates.
        const heartbeatInterval = setInterval(() => {
          const now = Date.now();
          onThreadUpdate?.({
            threadId: context.threadId,
            phase: "building",
            status: "working",
            file: songLabel,
            timestamp: now,
            isHeartbeat: true,
            phaseDurationMs: now - buildStartedAt,
          });
        }, HEARTBEAT_INTERVAL_MS);
        
        const renderOptions = {
          sidFile: job.sidFile,
          wavFile: job.wavPath,
          songIndex: job.songCount > 1 ? job.songIndex : undefined,
          targetDurationMs: job.targetDurationMs
        };
        
        try {
          // Use worker pool for non-blocking rendering if available
          if (rendererPool) {
            await rendererPool.render(renderOptions);
          } else {
            await render(renderOptions);
          }
          // Track the WAV file for potential cleanup after classification
          renderedWavFiles.push(job.wavPath);
          renderedFilesCount += 1;
          classifyLogger.debug(`[Thread ${context.threadId}] Rendered WAV for ${songLabel} in ${Date.now() - buildStartedAt}ms`);
        } finally {
          clearInterval(heartbeatInterval);
        }
        
        // Switch back to tagging phase after rendering
        const resumeTaggingAt = Date.now();
        onThreadUpdate?.({
          threadId: context.threadId,
          phase: "tagging",
          status: "working",
          file: songLabel,
          timestamp: resumeTaggingAt,
        });
      } else {
        cachedFilesCount += 1;
      }

      if (onProgress) {
        onProgress({
          phase: "tagging",
          totalFiles,
          processedFiles: processedSongs,
          renderedFiles: renderedFilesCount,
          cachedFiles: cachedFilesCount,
          extractedFiles: extractedFilesCount,
          percentComplete: totalFiles === 0 ? 0 : (processedSongs / totalFiles) * 100,
          elapsedMs: Date.now() - startTime,
          currentFile: songLabel
        });
      }

      // Essentia feature extraction with structured logging
      const extractionStartedAt = Date.now();
      extractedFeatures = await featureExtractor({ wavFile: job.wavPath, sidFile: job.sidFile });
      extractedFilesCount += 1;
      const extractionDurationMs = Date.now() - extractionStartedAt;
      
      // Log feature extraction result
      const featureCount = Object.keys(extractedFeatures).length;
      const usedEssentia = extractedFeatures.spectralCentroid !== undefined || extractedFeatures.rms !== undefined;
      classifyLogger.debug(
        `[Thread ${context.threadId}] Extracted ${featureCount} features for ${songLabel} in ${extractionDurationMs}ms (Essentia: ${usedEssentia})`
      );
      
      autoRatings = await predictRatings({
        features: extractedFeatures,
        sidFile: job.sidFile,
        relativePath: job.posixRelative,
        metadata: job.metadata
      });
      predictionsGenerated += 1;
    }

    const { ratings, source } = combineRatings(manualRatings, autoRatings);

    const songKey = job.songCount > 1 ? `${job.posixRelative}:${job.songIndex}` : job.posixRelative;

    if (source === "auto") {
      autoTagged.push(songKey);
    } else if (source === "manual") {
      manualEntries.push(songKey);
    } else {
      mixedEntries.push(songKey);
    }

    const autoFilePath = resolveAutoTagFilePath(
      plan.tagsPath,
      job.relativePath,
      plan.classificationDepth
    );
    const baseKey = toPosixRelative(resolveAutoTagKey(job.relativePath, plan.classificationDepth));
    const key = job.songCount > 1 ? `${baseKey}:${job.songIndex}` : baseKey;

    const entry: AutoTagEntry = { ...ratings, source };
    const existingEntries = grouped.get(autoFilePath);
    if (existingEntries) {
      existingEntries.set(key, entry);
    } else {
      grouped.set(autoFilePath, new Map([[key, entry]]));
    }

    // Write JSONL record immediately after feature extraction (flush per file)
    const classificationRecord: ClassificationRecord = {
      sid_path: job.posixRelative,
      ratings,
      source,
      classified_at: new Date().toISOString(),
    };
    if (job.songCount > 1) {
      classificationRecord.song_index = job.songIndex;
    }
    if (extractedFeatures) {
      classificationRecord.features = extractedFeatures as AudioFeatures;
      // Mark degraded if using heuristic features
      if (extractedFeatures.featureVariant === "heuristic") {
        classificationRecord.degraded = true;
      }
    }
    // Determine render engine used
    const preferredEngines = (plan.config.render?.preferredEngines as RenderEngine[]) ?? ['wasm'];
    classificationRecord.render_engine = preferredEngines[0];
    logJsonlPathOnce(jsonlFile);
    await queueJsonlWrite(
      jsonlFile,
      [classificationRecord as unknown as JsonValue],
      {
        recordCount: 1,
        phase: "classification",
        songIndex: job.songIndex,
        totalSongs: job.songCount
      }
    );
    jsonlRecordCount += 1;

    processedSongs += 1;

    if (onProgress && processedSongs % AUTOTAG_PROGRESS_INTERVAL === 0) {
      onProgress({
        phase: "tagging",
        totalFiles,
        processedFiles: processedSongs,
        renderedFiles: renderedFilesCount,
        cachedFiles: cachedFilesCount,
        extractedFiles: extractedFilesCount,
        percentComplete: totalFiles === 0 ? 100 : (processedSongs / totalFiles) * 100,
        elapsedMs: Date.now() - startTime,
        currentFile: songLabel
      });
    }
    onThreadUpdate?.({
      threadId: context.threadId,
      phase: "tagging",
      status: "idle"
    });
  });
  } finally {
    // Clean up renderer pool
    await rendererPool?.destroy();
  }

  if (onProgress && totalFiles > 0) {
    onProgress({
      phase: "tagging",
      totalFiles,
      processedFiles: processedSongs,
      renderedFiles: renderedFilesCount,
      cachedFiles: cachedFilesCount,
      extractedFiles: extractedFilesCount,
      percentComplete: totalFiles === 0 ? 100 : (processedSongs / totalFiles) * 100,
      elapsedMs: Date.now() - startTime
    });
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

  // Delete WAV files if requested (for fly.io deployments with limited storage)
  // Uses parallel deletion with concurrency limit for better performance
  let deletedWavCount = 0;
  if (deleteWavAfterClassification && renderedWavFiles.length > 0) {
    classifyLogger.info(`Cleaning up ${renderedWavFiles.length} WAV files after classification...`);
    
    // Delete files in parallel with a concurrency limit
    const DELETION_CONCURRENCY = 10;
    let successCount = 0;
    
    await runConcurrent(
      renderedWavFiles,
      DELETION_CONCURRENCY,
      async (wavFile) => {
        try {
          await rm(wavFile, { force: true });
          // Also delete the hash file if it exists
          const hashFile = `${wavFile}${WAV_HASH_EXTENSION}`;
          await rm(hashFile, { force: true });
          successCount += 1;
        } catch (error) {
          classifyLogger.warn(`Failed to delete ${wavFile}: ${(error as Error).message}`);
        }
      }
    );
    
    deletedWavCount = successCount;
    classifyLogger.info(`Deleted ${deletedWavCount} WAV files`);
  }

  // Flush all pending writes before returning
  if (jsonlFile) {
    await flushWriterQueue(jsonlFile);
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
    predictionsGenerated,
    skippedAlreadyClassified: skippedAlreadyClassifiedCount
  };

  return { autoTagged, manualEntries, mixedEntries, metadataFiles, tagFiles, jsonlFile, jsonlRecordCount, metrics };
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
  const sidFiles = await collectSidFiles(plan.sidPath);
  const extractMetadata = options.extractMetadata ?? defaultExtractMetadata;
  // Use defaultFeatureExtractor (essentiaFeatureExtractor) for Essentia.js audio analysis
  const featureExtractor = options.featureExtractor ?? defaultFeatureExtractor;
  // Use defaultPredictRatings (heuristicPredictRatings) for rating prediction
  const predictRatings = options.predictRatings ?? defaultPredictRatings;
  const onProgress = options.onProgress;

  // Use classifiedPath from config or default to tags path
  const classifiedPath = plan.config.classifiedPath ?? path.join(plan.tagsPath, "classified");
  await ensureDir(classifiedPath);

  // Generate output filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
  const jsonlFile = path.join(classifiedPath, `classification_${timestamp}.jsonl`);

  // Track record count without accumulating all records in memory
  let recordCount = 0;

  // Collect SID metadata and count total songs using shared utility
  const { sidMetadataCache, totalSongs } = await collectSidMetadataAndSongCount(sidFiles);
  const totalFiles = totalSongs;
  let processedSongs = 0;

  for (const sidFile of sidFiles) {
    const relativePath = resolveRelativeSidPath(plan.sidPath, sidFile);
    const posixRelative = toPosixRelative(relativePath);

    // Load metadata once per SID file
    const metadata = await extractMetadata({
      sidFile,
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
          renderedFiles: 0,
          cachedFiles: 0,
          extractedFiles: processedSongs,
          percentComplete: (processedSongs / totalFiles) * 100,
          elapsedMs: Date.now() - startTime,
          currentFile: `${path.basename(sidFile)} [${songIndex}/${songCount}]`
        });
      }

      // Load manual ratings if available
      const manualRecord = await loadManualTagRecord(plan.sidPath, plan.tagsPath, sidFile);

      // Extract features and generate ratings for this song
      const wavPath = resolveWavPath(plan, sidFile, songCount > 1 ? songIndex : undefined);
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

      // Write record immediately to JSONL file via queue (serialized append)
      logJsonlPathOnce(jsonlFile);
      await queueJsonlWrite(
        jsonlFile,
        [record as unknown as JsonValue],
        {
          recordCount: 1,
          phase: "classification",
          songIndex: songIndex,
          totalSongs: songCount
        }
      );

      recordCount++;
      processedSongs++;
    }
  }

  const endTime = Date.now();
  return {
    jsonlFile,
    recordCount,
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
  const wavBytes = typeof features.wavBytes === "number" ? features.wavBytes : 0;
  const sidBytes = typeof features.sidBytes === "number" ? features.sidBytes : 0;
  const nameSeed = typeof features.nameSeed === "number" ? features.nameSeed : 0;
  const tempoSeed = baseSeed + wavBytes;
  const moodSeed = baseSeed + (metadata.author ? computeSeed(metadata.author) : 0);
  const complexitySeed = baseSeed + sidBytes + nameSeed;

  return {
    e: clampRating(toRating(tempoSeed)),
    m: clampRating(toRating(moodSeed)),
    c: clampRating(toRating(complexitySeed))
  };
};

export function __setClassifyTestOverrides(overrides?: {
  parseSidFile?: typeof parseSidFile;
  createEngine?: EngineFactory;
}): void {
  parseSidFileImpl = overrides?.parseSidFile ?? parseSidFile;
  setEngineFactoryOverride(overrides?.createEngine ?? null);
}

// Re-export Essentia.js and TensorFlow.js implementations
export { essentiaFeatureExtractor, setUseWorkerPool, FEATURE_EXTRACTION_SAMPLE_RATE, validateWavHeader, checkEssentiaAvailability, isEssentiaAvailable, type WavHeaderValidation } from "./essentia-features.js";
export { 
  FeatureExtractionPool, 
  getFeatureExtractionPool, 
  destroyFeatureExtractionPool 
} from "./feature-extraction-pool.js";
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

// Re-export JSONL writer queue utilities
export {
  queueJsonlWrite,
  getWriterQueueStats,
  getAllWriterQueueStats,
  flushWriterQueue,
  clearWriterQueues,
  logJsonlPathOnce,
  clearLoggedPaths,
} from "./jsonl-writer-queue.js";

// Re-export state machine types and utilities
export {
  HEARTBEAT_CONFIG,
  RETRY_CONFIG,
  createThreadCounters,
  createGlobalCounters,
  isRecoverableError,
  createClassifyError,
  calculateBackoffDelay,
  getMaxRetries,
  withRetry,
  type ClassifyPhase,
  type WorkerPhase,
  type ThreadStatus,
  type ErrorType,
  type ClassifyError,
  type StructuredThreadUpdate,
  type ThreadCounters,
  type ClassifyProgressSnapshot,
  type ThreadStatusSnapshot,
  type GlobalCounters,
  type PhaseTransitionLog,
  type PhaseCompletionLog,
  type WorkerMessage,
} from "./types/state-machine.js";

// Re-export classification metrics utilities
export {
  incrementCounter,
  recordTimer,
  setGauge,
  getMetrics,
  resetMetrics,
  formatPrometheusMetrics,
  METRIC_NAMES,
  type Counter,
  type Timer,
  type Gauge,
  type ClassificationMetrics,
} from "./classify-metrics.js";
