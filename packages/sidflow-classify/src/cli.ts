#!/usr/bin/env bun

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { resetConfigCache } from "@sidflow/common";
import {
  buildWavCache,
  defaultExtractMetadata,
  generateAutoTags,
  generateJsonlOutput,
  heuristicFeatureExtractor,
  heuristicPredictRatings,
  planClassification,
  type AutoTagProgress,
  type BuildWavCacheResult,
  type ClassificationPlan,
  type ExtractMetadata,
  type FeatureExtractor,
  type GenerateAutoTagsResult,
  type GenerateJsonlResult,
  type PredictRatings,
  type RenderWav,
  type ThreadActivityUpdate,
  type WavCacheProgress
} from "./index.js";

// Progress update throttle configuration
const PROGRESS_THROTTLE_MS = 500; // Max 2 updates per second

interface ClassifyCliOptions {
  configPath?: string;
  forceRebuild?: boolean;
  skipAlreadyClassified?: boolean;
  deleteWavAfterClassification?: boolean;
  featureModule?: string;
  predictorModule?: string;
  metadataModule?: string;
  renderModule?: string;
}

interface ParseResult {
  options: ClassifyCliOptions;
  errors: string[];
  helpRequested: boolean;
}

const KNOWN_FLAGS = new Set([
  "--config",
  "--force-rebuild",
  "--skip-already-classified",
  "--delete-wav-after-classification",
  "--feature-module",
  "--predictor-module",
  "--metadata-module",
  "--render-module",
  "--help"
]);

export function parseClassifyArgs(argv: string[]): ParseResult {
  const options: ClassifyCliOptions = {};
  const errors: string[] = [];
  let helpRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--help": {
        helpRequested = true;
        break;
      }
      case "--force-rebuild": {
        options.forceRebuild = true;
        break;
      }
      case "--skip-already-classified": {
        options.skipAlreadyClassified = true;
        break;
      }
      case "--delete-wav-after-classification": {
        options.deleteWavAfterClassification = true;
        break;
      }
      case "--config":
      case "--feature-module":
      case "--predictor-module":
      case "--metadata-module":
      case "--render-module": {
        const next = argv[index + 1];
        if (!next || next.startsWith("--")) {
          errors.push(`${token} requires a value`);
        } else {
          if (token === "--config") {
            options.configPath = next;
          } else if (token === "--feature-module") {
            options.featureModule = next;
          } else if (token === "--predictor-module") {
            options.predictorModule = next;
          } else if (token === "--metadata-module") {
            options.metadataModule = next;
          } else {
            options.renderModule = next;
          }
          index += 1;
        }
        break;
      }
      default: {
        if (token.startsWith("--")) {
          if (!KNOWN_FLAGS.has(token)) {
            errors.push(`Unknown option: ${token}`);
          }
        } else {
          errors.push(`Unexpected argument: ${token}`);
        }
        break;
      }
    }

    if (helpRequested) {
      break;
    }
  }

  return { options, errors, helpRequested };
}

function printHelp(): void {
  const lines = [
    "Usage: sidflow classify [options]",
    "",
    "Build the WAV cache and generate automated tag summaries.",
    "",
    "Options:",
    "  --config <path>                   Use an alternate .sidflow.json file",
    "  --force-rebuild                   Re-render WAVs even if cache is fresh",
    "  --skip-already-classified         Skip songs already in auto-tags.json",
    "  --delete-wav-after-classification Delete WAVs after classification (fly.io)",
    "  --feature-module <path>           Module exporting a featureExtractor override",
    "  --predictor-module <path>         Module exporting a predictRatings override",
    "  --metadata-module <path>          Module exporting an extractMetadata override",
    "  --render-module <path>            Module exporting a render override for WAV cache",
    "  --help                            Show this message and exit"
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

interface ClassifyCliRuntime {
  planClassification: typeof planClassification;
  buildWavCache: typeof buildWavCache;
  generateAutoTags: typeof generateAutoTags;
  generateJsonlOutput: typeof generateJsonlOutput;
  loadFeatureModule: (specifier: string) => Promise<FeatureExtractor>;
  loadPredictorModule: (specifier: string) => Promise<PredictRatings>;
  loadMetadataModule: (specifier: string) => Promise<ExtractMetadata>;
  loadRenderModule: (specifier: string) => Promise<RenderWav>;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

const defaultRuntime: ClassifyCliRuntime = {
  planClassification,
  buildWavCache,
  generateAutoTags,
  generateJsonlOutput,
  loadFeatureModule: (specifier) =>
    loadModule<FeatureExtractor>(specifier, ["default", "featureExtractor", "extractFeatures"]),
  loadPredictorModule: (specifier) =>
    loadModule<PredictRatings>(specifier, ["default", "predictRatings", "predict"]),
  loadMetadataModule: (specifier) =>
    loadModule<ExtractMetadata>(specifier, ["default", "extractMetadata", "metadata"]),
  loadRenderModule: (specifier) =>
    loadModule<RenderWav>(specifier, ["default", "render", "renderWav"]),
  stdout: process.stdout,
  stderr: process.stderr
};

async function loadModule<T extends (...args: any[]) => unknown>(
  specifier: string,
  candidates: string[]
): Promise<T> {
  const absolute = path.isAbsolute(specifier) ? specifier : path.resolve(process.cwd(), specifier);
  const module = await import(pathToFileURL(absolute).href);
  for (const key of candidates) {
    const value = key === "default" ? module.default : module[key as keyof typeof module];
    if (typeof value === "function") {
      return value as T;
    }
  }
  throw new Error(`Module ${specifier} does not export a compatible function (${candidates.join(", ")})`);
}

function mergeRuntime(overrides?: Partial<ClassifyCliRuntime>): ClassifyCliRuntime {
  if (!overrides) {
    return defaultRuntime;
  }
  return {
    ...defaultRuntime,
    ...overrides,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

function createProgressLogger(stdout: NodeJS.WritableStream) {
  let lastLogTime = 0;

  const writeThreadLine = (line: string) => {
    stdout.write(`\r\x1b[K${line}\n`);
  };

  return {
    logWavProgress(progress: WavCacheProgress): void {
      const now = Date.now();
      if (now - lastLogTime < PROGRESS_THROTTLE_MS && progress.processedFiles < progress.totalFiles) {
        return;
      }
      lastLogTime = now;

      const percent = progress.percentComplete.toFixed(1);
      const elapsed = formatDuration(progress.elapsedMs);

      if (progress.phase === "analyzing") {
        stdout.write(
          `\r[Analyzing] ${progress.processedFiles}/${progress.totalFiles} files (${percent}%) - ${elapsed}`
        );
      } else {
        const remaining = progress.totalFiles - progress.processedFiles;
        const file = progress.currentFile ? ` - ${progress.currentFile}` : "";
        stdout.write(
          `\r[Converting] ${progress.renderedFiles} rendered, ${progress.skippedFiles} cached, ${remaining} remaining (${percent}%)${file} - ${elapsed}`
        );
      }
    },

    logAutoTagProgress(progress: AutoTagProgress): void {
      const now = Date.now();
      if (now - lastLogTime < PROGRESS_THROTTLE_MS && progress.processedFiles < progress.totalFiles) {
        return;
      }
      lastLogTime = now;

      const percent = progress.percentComplete.toFixed(1);
      const elapsed = formatDuration(progress.elapsedMs);
      const remaining = progress.totalFiles - progress.processedFiles;
      const file = progress.currentFile ? ` - ${progress.currentFile}` : "";

      // Map internal phases to user-friendly labels
      let phaseLabel: string;
      switch (progress.phase) {
        case "metadata":
          phaseLabel = "Reading Metadata";
          break;
        case "tagging":
          phaseLabel = "Extracting Features";
          break;
        case "jsonl":
          phaseLabel = "Writing Features";
          break;
        default:
          phaseLabel = progress.phase;
      }

      stdout.write(
        `\r[${phaseLabel}] ${progress.processedFiles}/${progress.totalFiles} files, ${remaining} remaining (${percent}%)${file} - ${elapsed}`
      );
    },

    logThread(update: ThreadActivityUpdate): void {
      // Map internal phases to user-friendly action verbs
      let action: string;
      switch (update.phase) {
        case "analyzing":
          action = "Analyzing";
          break;
        case "building":
          action = "Rendering";
          break;
        case "metadata":
          action = "Reading metadata";
          break;
        case "tagging":
          action = "Extracting features";
          break;
        default:
          action = update.phase;
      }

      const status = update.status === "working" ? action : update.status.toUpperCase();
      const file = update.file ? `: ${update.file}` : "";
      writeThreadLine(`[Thread ${update.threadId}] ${status}${file}`);
    },

    clearLine(): void {
      stdout.write("\r\x1b[K");
    }
  };
}

function summariseWavResult(result: BuildWavCacheResult): string[] {
  const { metrics } = result;
  const cacheHitPercent = (metrics.cacheHitRate * 100).toFixed(1);
  return [
    "WAV Cache Build:",
    `  Files processed: ${metrics.totalFiles}`,
    `  Rendered: ${metrics.rendered}`,
    `  Skipped (cached): ${metrics.skipped}`,
    `  Cache hit rate: ${cacheHitPercent}%`,
    `  Duration: ${formatDuration(metrics.durationMs)}`
  ];
}

function summariseAutoTags(result: GenerateAutoTagsResult): string[] {
  const { metrics } = result;
  return [
    "Auto-tagging:",
    `  Files processed: ${metrics.totalFiles}`,
    `  Auto-tagged: ${metrics.autoTaggedCount}`,
    `  Manual-only: ${metrics.manualOnlyCount}`,
    `  Mixed: ${metrics.mixedCount}`,
    `  Predictions generated: ${metrics.predictionsGenerated}`,
    `  Metadata files: ${result.metadataFiles.length}`,
    `  Tag files: ${result.tagFiles.length}`,
    `  Duration: ${formatDuration(metrics.durationMs)}`
  ];
}

function summariseJsonlOutput(result: GenerateJsonlResult): string[] {
  return [
    "Feature extraction:",
    `  Records written: ${result.recordCount}`,
    `  Output file: ${result.jsonlFile}`,
    `  Duration: ${formatDuration(result.durationMs)}`
  ];
}

export async function runClassifyCli(
  argv: string[],
  overrides?: Partial<ClassifyCliRuntime>
): Promise<number> {
  const { options, errors, helpRequested } = parseClassifyArgs(argv);

  const runtime = mergeRuntime(overrides);

  if (helpRequested) {
    printHelp();
    return errors.length > 0 ? 1 : 0;
  }

  if (errors.length > 0) {
    errors.forEach((message) => {
      runtime.stderr.write(`${message}\n`);
    });
    runtime.stderr.write("Use --help to list supported options.\n");
    return 1;
  }

  try {
    // Set SIDFLOW_CONFIG environment variable so all subsequent loadConfig() calls use this config
    if (options.configPath) {
      process.env.SIDFLOW_CONFIG = path.resolve(options.configPath);
      // Reset config cache to ensure the new env var is picked up
      resetConfigCache();
    }
    
    const plan = await runtime.planClassification({
      configPath: options.configPath,
      forceRebuild: options.forceRebuild ?? false
    });

    const resolvedPlan: ClassificationPlan = {
      ...plan,
      forceRebuild: options.forceRebuild ?? plan.forceRebuild
    };

    // Determine thread count
    const threads = plan.config.threads || os.cpus().length;
    runtime.stdout.write(`Starting classification (threads: ${threads})\n`);
    runtime.stdout.write(`SID path: ${resolvedPlan.sidPath}\n`);
    runtime.stdout.write(`WAV cache path: ${resolvedPlan.wavCachePath}\n\n`);

    // Create progress logger
    const progressLogger = createProgressLogger(runtime.stdout);
    const threadLogger = (update: ThreadActivityUpdate) => progressLogger.logThread(update);

    let render: RenderWav | undefined;
    if (options.renderModule) {
      render = await runtime.loadRenderModule(options.renderModule);
    }

    let featureExtractor: FeatureExtractor = heuristicFeatureExtractor;
    if (options.featureModule) {
      featureExtractor = await runtime.loadFeatureModule(options.featureModule);
    }

    let predictRatings: PredictRatings = heuristicPredictRatings;
    if (options.predictorModule) {
      predictRatings = await runtime.loadPredictorModule(options.predictorModule);
    }

    let extractMetadata: ExtractMetadata = defaultExtractMetadata;
    if (options.metadataModule) {
      extractMetadata = await runtime.loadMetadataModule(options.metadataModule);
    }

    // Step 1: Generate auto-tags (ratings only)
    const autoTagsResult = await runtime.generateAutoTags(resolvedPlan, {
      extractMetadata,
      featureExtractor,
      predictRatings,
      threads,
      render,
      skipAlreadyClassified: options.skipAlreadyClassified,
      deleteWavAfterClassification: options.deleteWavAfterClassification,
      onThreadUpdate: threadLogger,
      onProgress: (progress) => progressLogger.logAutoTagProgress(progress)
    });

    progressLogger.clearLine();
    runtime.stdout.write("\n");
    
    // Step 2: Generate JSONL output with features + ratings + metadata
    runtime.stdout.write("Extracting features to JSONL...\n");
    const jsonlResult = await runtime.generateJsonlOutput(resolvedPlan, {
      extractMetadata,
      featureExtractor,
      predictRatings,
      onProgress: (progress) => progressLogger.logAutoTagProgress(progress)
    });

    progressLogger.clearLine();
    runtime.stdout.write("\n");

    const summary = [
      "Classification complete.",
      ...summariseAutoTags(autoTagsResult),
      "",
      ...summariseJsonlOutput(jsonlResult)
    ];
    runtime.stdout.write(`${summary.join("\n")}\n`);
    return 0;
  } catch (error) {
    runtime.stderr.write(`Classification failed: ${(error as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  runClassifyCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
