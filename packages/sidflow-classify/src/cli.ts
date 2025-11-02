#!/usr/bin/env bun

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildWavCache,
  defaultExtractMetadata,
  generateAutoTags,
  heuristicFeatureExtractor,
  heuristicPredictRatings,
  planClassification,
  type BuildWavCacheResult,
  type ClassificationPlan,
  type ExtractMetadata,
  type FeatureExtractor,
  type GenerateAutoTagsResult,
  type PredictRatings,
  type RenderWav
} from "./index.js";

interface ClassifyCliOptions {
  configPath?: string;
  forceRebuild?: boolean;
  sidplayPath?: string;
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
  "--sidplay",
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
      case "--config":
      case "--sidplay":
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
          } else if (token === "--sidplay") {
            options.sidplayPath = next;
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
    "  --config <path>           Use an alternate .sidflow.json file",
    "  --sidplay <path>          Override the sidplayfp binary path",
    "  --force-rebuild           Re-render WAVs even if cache is fresh",
    "  --feature-module <path>   Module exporting a featureExtractor override",
    "  --predictor-module <path> Module exporting a predictRatings override",
    "  --metadata-module <path>  Module exporting an extractMetadata override",
    "  --render-module <path>    Module exporting a render override for WAV cache",
    "  --help                    Show this message and exit"
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

interface ClassifyCliRuntime {
  planClassification: typeof planClassification;
  buildWavCache: typeof buildWavCache;
  generateAutoTags: typeof generateAutoTags;
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

function summariseWavResult(result: BuildWavCacheResult): string[] {
  return [
    `WAVs rendered: ${result.rendered.length}`,
    `WAVs skipped: ${result.skipped.length}`
  ];
}

function summariseAutoTags(result: GenerateAutoTagsResult): string[] {
  return [
    `Auto-tagged entries: ${result.autoTagged.length}`,
    `Manual-only entries: ${result.manualEntries.length}`,
    `Mixed entries: ${result.mixedEntries.length}`,
    `Metadata files written: ${result.metadataFiles.length}`,
    `Auto tag files written: ${result.tagFiles.length}`
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
    const plan = await runtime.planClassification({
      configPath: options.configPath,
      forceRebuild: options.forceRebuild ?? false
    });

    const resolvedPlan: ClassificationPlan = {
      ...plan,
      forceRebuild: options.forceRebuild ?? plan.forceRebuild,
      sidplayPath: options.sidplayPath ? path.resolve(options.sidplayPath) : plan.sidplayPath
    };

    let render: RenderWav | undefined;
    if (options.renderModule) {
      render = await runtime.loadRenderModule(options.renderModule);
    }

    const wavResult = await runtime.buildWavCache(resolvedPlan, {
      forceRebuild: options.forceRebuild,
      sidplayPath: resolvedPlan.sidplayPath,
      render
    });

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

    const autoTagsResult = await runtime.generateAutoTags(resolvedPlan, {
      extractMetadata,
      featureExtractor,
      predictRatings
    });

    const summary = [
      "Classification complete.",
      ...summariseWavResult(wavResult),
      ...summariseAutoTags(autoTagsResult)
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
