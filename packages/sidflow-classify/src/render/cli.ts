#!/usr/bin/env bun

import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";

import {
  createLogger,
  ensureDir,
  loadConfig,
  pathExists,
  Ultimate64AudioCapture,
  Ultimate64Client,
  type AudioEncoderConfig,
  type AudioEncoderImplementation,
  type FfmpegWasmOptions,
  type RenderFormat as ConfigRenderFormat,
  type SidflowConfig,
} from "@sidflow/common";

import {
  RenderOrchestrator,
  type RenderEngine,
  type RenderFormat,
} from "./render-orchestrator.js";

const logger = createLogger("render-cli");
const SUPPORTED_ENGINES: RenderEngine[] = [
  "sidplayfp-cli",
  "ultimate64",
  "wasm",
];
const SUPPORTED_FORMATS: RenderFormat[] = ["wav", "m4a", "flac"];
const DEFAULT_FORMATS: RenderFormat[] = ["wav", "m4a"];
const DEFAULT_TARGET_DURATION_SECONDS = 120;
const DEFAULT_MAX_LOSS = 0.01;

interface RenderCliOptions {
  configPath?: string;
  engine?: RenderEngine | "auto";
  preferredEngines?: RenderEngine[];
  formats?: RenderFormat[];
  chip?: "6581" | "8580r5";
  outputPath?: string;
  sidSpecs: string[];
  sidListFiles: string[];
  targetDurationSeconds?: number;
  maxLossRate?: number;
  encoderImplementation?: AudioEncoderImplementation;
  ffmpegWasmCorePath?: string;
  ffmpegWasmBinaryPath?: string;
  ffmpegWasmWorkerPath?: string;
  ffmpegWasmLog?: boolean;
}

interface ParseResult {
  options: RenderCliOptions;
  errors: string[];
  helpRequested: boolean;
}

interface SidSpec {
  path: string;
  songIndex?: number;
}

interface ResolvedSidEntry extends SidSpec {
  relativePath: string;
  absolutePath: string;
}

const KNOWN_FLAGS = new Set([
  "--config",
  "--engine",
  "--prefer",
  "--formats",
  "--chip",
  "--output",
  "--sid",
  "--sid-file",
  "--target-duration",
  "--max-loss",
  "--encoder",
  "--ffmpeg-wasm-core",
  "--ffmpeg-wasm-wasm",
  "--ffmpeg-wasm-worker",
  "--ffmpeg-wasm-log",
  "--help",
]);

export function parseRenderArgs(argv: string[]): ParseResult {
  const options: RenderCliOptions = {
    sidSpecs: [],
    sidListFiles: [],
  };
  const errors: string[] = [];
  let helpRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--help":
        helpRequested = true;
        break;
      case "--config":
      case "--engine":
      case "--encoder":
      case "--formats":
      case "--chip":
      case "--output":
      case "--sid":
      case "--sid-file":
      case "--target-duration":
      case "--max-loss":
      case "--prefer":
      case "--ffmpeg-wasm-core":
      case "--ffmpeg-wasm-wasm":
      case "--ffmpeg-wasm-worker":
      case "--ffmpeg-wasm-log": {
        const next = argv[index + 1];
        if (!next || next.startsWith("--")) {
          errors.push(`${token} requires a value`);
          break;
        }

        switch (token) {
          case "--config":
            options.configPath = next;
            break;
          case "--engine": {
            if (next === "auto") {
              options.engine = "auto";
            } else {
              const engine = coerceRenderEngine(next);
              if (!engine) {
                errors.push(`Unsupported engine: ${next}`);
              } else {
                options.engine = engine;
              }
            }
            break;
          }
          case "--encoder": {
            const implementation = coerceAudioEncoderImplementation(next);
            if (!implementation) {
              errors.push(`Unsupported encoder implementation: ${next}`);
            } else {
              options.encoderImplementation = implementation;
            }
            break;
          }
          case "--formats": {
            const parsedFormats: RenderFormat[] = [];
            for (const entry of parseList(next)) {
              const format = coerceRenderFormat(entry);
              if (!format) {
                errors.push(`Unsupported format: ${entry}`);
                continue;
              }
              if (!parsedFormats.includes(format)) {
                parsedFormats.push(format);
              }
            }
            options.formats = parsedFormats;
            break;
          }
          case "--chip":
            if (next !== "6581" && next !== "8580r5") {
              errors.push("--chip must be 6581 or 8580r5");
            } else {
              options.chip = next;
            }
            break;
          case "--output":
            options.outputPath = next;
            break;
          case "--sid":
            options.sidSpecs.push(next);
            break;
          case "--sid-file":
            options.sidListFiles.push(next);
            break;
          case "--target-duration": {
            const parsed = Number.parseFloat(next);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              errors.push("--target-duration must be a positive number of seconds");
            } else {
              options.targetDurationSeconds = parsed;
            }
            break;
          }
          case "--max-loss": {
            const parsed = Number.parseFloat(next);
            if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) {
              errors.push("--max-loss must be between 0 and 1 (exclusive)");
            } else {
              options.maxLossRate = parsed;
            }
            break;
          }
          case "--prefer": {
            const preferred: RenderEngine[] = [];
            for (const entry of parseList(next)) {
              const engine = coerceRenderEngine(entry);
              if (!engine) {
                errors.push(`Unsupported engine in --prefer: ${entry}`);
                continue;
              }
              preferred.push(engine);
            }
            options.preferredEngines = [
              ...(options.preferredEngines ?? []),
              ...preferred,
            ];
            break;
          }
          case "--ffmpeg-wasm-core":
            options.ffmpegWasmCorePath = next;
            break;
          case "--ffmpeg-wasm-wasm":
            options.ffmpegWasmBinaryPath = next;
            break;
          case "--ffmpeg-wasm-worker":
            options.ffmpegWasmWorkerPath = next;
            break;
          case "--ffmpeg-wasm-log": {
            const parsed = parseBooleanFlag(next);
            if (parsed === null) {
              errors.push("--ffmpeg-wasm-log must be true or false");
            } else {
              options.ffmpegWasmLog = parsed;
            }
            break;
          }
          default:
            break;
        }

        index += 1;
        break;
      }
      default: {
        if (token.startsWith("--")) {
          errors.push(`Unknown option: ${token}`);
        } else {
          options.sidSpecs.push(token);
        }
        break;
      }
    }
  }

  return { options, errors, helpRequested };
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function coerceRenderEngine(value: string): RenderEngine | null {
  const candidate = value as RenderEngine;
  return SUPPORTED_ENGINES.includes(candidate) ? candidate : null;
}

function coerceRenderFormat(value: string): RenderFormat | null {
  const candidate = value as RenderFormat;
  return SUPPORTED_FORMATS.includes(candidate) ? candidate : null;
}

function coerceAudioEncoderImplementation(value: string): AudioEncoderImplementation | null {
  if (value === "native" || value === "wasm" || value === "auto") {
    return value;
  }
  return null;
}

function parseBooleanFlag(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return null;
}

function printHelp(): void {
  process.stdout.write(`SIDFlow Render CLI\n\n`);
  process.stdout.write(`Usage: bun scripts/sidflow-render [options] --sid <path[#song]>\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --config <path>           Path to .sidflow.json (defaults to cwd)\n`);
  process.stdout.write(`  --engine <name|auto>      Force engine (wasm, sidplayfp-cli, ultimate64, auto)\n`);
  process.stdout.write(`  --encoder <mode>          Choose audio encoder (native, wasm, auto)\n`);
  process.stdout.write(`  --prefer <list>           Preferred engine order (comma separated)\n`);
  process.stdout.write(`  --formats <list>          Output formats (wav,m4a,flac)\n`);
  process.stdout.write(`  --chip <6581|8580r5>      SID chip profile\n`);
  process.stdout.write(`  --output <dir>            Output directory (defaults to render.outputPath or wavCache/rendered)\n`);
  process.stdout.write(`  --sid <path[#song]>       Render a specific SID (relative to HVSC)\n`);
  process.stdout.write(`  --sid-file <file>         File with SID paths (newline or JSONL)\n`);
  process.stdout.write(`  --target-duration <sec>   Target capture duration in seconds (default ${DEFAULT_TARGET_DURATION_SECONDS})\n`);
  process.stdout.write(`  --max-loss <0-1>          Max acceptable packet loss rate (default ${DEFAULT_MAX_LOSS})\n`);
  process.stdout.write(`  --ffmpeg-wasm-core <path> Override ffmpeg-core.js path for ffmpeg.wasm\n`);
  process.stdout.write(`  --ffmpeg-wasm-wasm <path> Override ffmpeg-core.wasm path\n`);
  process.stdout.write(`  --ffmpeg-wasm-worker <path> Override ffmpeg-core.worker.js path\n`);
  process.stdout.write(`  --ffmpeg-wasm-log <true|false> Enable verbose ffmpeg.wasm logging\n`);
  process.stdout.write(`  --help                    Show this message\n`);
}

export async function runRenderCli(argv: string[]): Promise<number> {
  const { options, errors, helpRequested } = parseRenderArgs(argv);

  if (helpRequested) {
    printHelp();
    return errors.length > 0 ? 1 : 0;
  }

  if (errors.length > 0) {
    for (const error of errors) {
      logger.error(error);
    }
    printHelp();
    return 1;
  }

  const config = await loadConfig(options.configPath);

  const formats = resolveFormats(options, config);
  if (formats.length === 0) {
    logger.error("No output formats selected. Use --formats or configure render.defaultFormats.");
    return 1;
  }

  const sidPath = config.sidPath;
  const outputDir = path.resolve(
    options.outputPath ?? config.render?.outputPath ?? path.join(config.wavCachePath, "rendered")
  );
  await ensureDir(outputDir);

  const targetDurationSeconds = options.targetDurationSeconds ?? DEFAULT_TARGET_DURATION_SECONDS;
  const targetDurationMs = Math.max(1, Math.round(targetDurationSeconds * 1000));
  const maxLossRate = options.maxLossRate ?? DEFAULT_MAX_LOSS;

  const sidSpecs: SidSpec[] = [];
  for (const spec of options.sidSpecs) {
    const parsed = parseSidSpec(spec);
    if (parsed) {
      sidSpecs.push(parsed);
    }
  }

  for (const sidFile of options.sidListFiles) {
    const entries = await loadSidListFile(sidFile);
    sidSpecs.push(...entries);
  }

  if (sidSpecs.length === 0) {
    const defaults = await loadDefaultSidList();
    sidSpecs.push(...defaults);
    if (defaults.length > 0) {
      logger.info(
        `No --sid entries supplied. Loaded ${defaults.length} samples from data/classified/sample.jsonl.`
      );
    }
  }

  if (sidSpecs.length === 0) {
    logger.error("No SID files to render. Use --sid or --sid-file to provide inputs.");
    return 1;
  }

  const resolvedSids = await resolveSidEntries(sidSpecs, sidPath);
  if (resolvedSids.length === 0) {
    logger.error("No valid SID paths were found.");
    return 1;
  }

  const chip = options.chip ?? config.render?.defaultChip ?? "6581";
  const engines = resolveEngineOrder(options, config);

  const encoderOverrides = resolveAudioEncoderOptions(options, config);

  const orchestrator = createOrchestrator(
    config,
    targetDurationMs,
    maxLossRate,
    encoderOverrides
  );

  const availableEngines: RenderEngine[] = [];
  const unavailable: string[] = [];
  for (const engine of engines) {
    const availability = await orchestrator.checkEngineAvailability(engine);
    if (availability.available) {
      availableEngines.push(engine);
    } else {
      unavailable.push(`${engine}: ${availability.reason ?? "unknown"}`);
    }
  }

  if (availableEngines.length === 0) {
    logger.error("No render engines are available:");
    for (const reason of unavailable) {
      logger.error(`  - ${reason}`);
    }
    return 1;
  }

  for (const reason of unavailable) {
    logger.warn(`Engine unavailable -> ${reason}`);
  }

  logger.info(
    `Rendering ${resolvedSids.length} track(s) to ${outputDir} using ${availableEngines.join(
      " -> "
    )}`
  );

  let failed = 0;
  for (const entry of resolvedSids) {
    const label = `${entry.relativePath}${entry.songIndex ? `#${entry.songIndex}` : ""}`;
    let rendered = false;

    for (const engine of availableEngines) {
      try {
        logger.info(`→ Rendering ${label} with ${engine}`);
        const result = await orchestrator.render({
          sidPath: entry.absolutePath,
          outputDir,
          engine,
          formats,
          chip,
          songIndex: entry.songIndex,
          targetDurationMs,
          maxLossRate,
        });
        rendered = true;
        logger.info(
          `✓ ${label} (${engine}) -> ${result.outputs
            .map((output) => `${path.basename(output.path)} (${output.format})`)
            .join(", ")}`
        );
        break;
      } catch (error) {
        logger.warn(`Engine ${engine} failed for ${label}: ${String(error)}`);
      }
    }

    if (!rendered) {
      failed += 1;
      logger.error(`✗ Failed to render ${label} with available engines`);
    }
  }

  if (failed > 0) {
    logger.error(`${failed} of ${resolvedSids.length} track(s) failed`);
    return 1;
  }

  logger.info(`All ${resolvedSids.length} track(s) rendered successfully`);
  return 0;
}

export function resolveFormats(options: RenderCliOptions, config: SidflowConfig): RenderFormat[] {
  const candidateList: (RenderFormat | ConfigRenderFormat)[] =
    options.formats ?? config.render?.defaultFormats ?? DEFAULT_FORMATS;

  const resolved: RenderFormat[] = [];
  for (const entry of candidateList) {
    const format = coerceRenderFormat(entry as string);
    if (!format) {
      logger.warn(`Ignoring unsupported format: ${entry}`);
      continue;
    }
    if (!resolved.includes(format)) {
      resolved.push(format);
    }
  }
  return resolved;
}

export function resolveAudioEncoderOptions(
  options: RenderCliOptions,
  config: SidflowConfig
): AudioEncoderConfig | undefined {
  const configEncoder = config.render?.audioEncoder;
  const cliWasmOverrides = buildCliWasmOverrides(options);
  const mergedWasm = mergeWasmOptions(configEncoder?.wasm, cliWasmOverrides);
  const implementation = options.encoderImplementation ?? configEncoder?.implementation;

  if (!implementation && !mergedWasm) {
    return undefined;
  }

  return {
    ...(implementation ? { implementation } : {}),
    ...(mergedWasm ? { wasm: mergedWasm } : {}),
  };
}

function buildCliWasmOverrides(options: RenderCliOptions): FfmpegWasmOptions | undefined {
  let overrides: FfmpegWasmOptions = {};

  if (options.ffmpegWasmCorePath) {
    overrides = {
      ...overrides,
      corePath: path.resolve(options.ffmpegWasmCorePath),
    };
  }

  if (options.ffmpegWasmBinaryPath) {
    overrides = {
      ...overrides,
      wasmPath: path.resolve(options.ffmpegWasmBinaryPath),
    };
  }

  if (options.ffmpegWasmWorkerPath) {
    overrides = {
      ...overrides,
      workerPath: path.resolve(options.ffmpegWasmWorkerPath),
    };
  }

  if (options.ffmpegWasmLog !== undefined) {
    overrides = {
      ...overrides,
      log: options.ffmpegWasmLog,
    };
  }

  return hasWasmOverrides(overrides) ? overrides : undefined;
}

function mergeWasmOptions(
  base?: FfmpegWasmOptions,
  overrides?: FfmpegWasmOptions
): FfmpegWasmOptions | undefined {
  if (!base && !overrides) {
    return undefined;
  }

  const merged: FfmpegWasmOptions = {
    ...(base ?? {}),
    ...(overrides ?? {}),
  };

  return hasWasmOverrides(merged) ? merged : undefined;
}

function hasWasmOverrides(value?: FfmpegWasmOptions): value is FfmpegWasmOptions {
  return value !== undefined && Object.keys(value).length > 0;
}

export function resolveEngineOrder(options: RenderCliOptions, config: SidflowConfig): RenderEngine[] {
  const cliPreferred = options.preferredEngines ?? [];
  const configPreferred = (config.render?.preferredEngines ?? [])
    .map((engine) => coerceRenderEngine(engine))
    .filter((engine): engine is RenderEngine => engine !== null);
  const explicitEngine: RenderEngine[] =
    options.engine && options.engine !== "auto" ? [options.engine] : [];

  const ordered: RenderEngine[] = [];

  const append = (list: (RenderEngine | null | undefined)[]): void => {
    for (const engine of list) {
      if (!engine) {
        continue;
      }
      if (!ordered.includes(engine)) {
        ordered.push(engine);
      }
    }
  };

  append(explicitEngine);
  append(cliPreferred);
  append(configPreferred);
  append(["wasm"]);

  return ordered;
}

export function parseSidSpec(value: string): SidSpec | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const [pathPart, songPart] = trimmed.split("#");
  if (!pathPart) {
    return null;
  }
  const spec: SidSpec = { path: pathPart };
  if (songPart) {
    const parsedSong = Number.parseInt(songPart, 10);
    if (Number.isFinite(parsedSong) && parsedSong > 0) {
      spec.songIndex = parsedSong;
    } else {
      logger.warn(`Ignoring invalid song index in ${value}`);
    }
  }
  return spec;
}

export async function loadSidListFile(filePath: string): Promise<SidSpec[]> {
  const resolved = path.resolve(filePath);
  if (!(await pathExists(resolved))) {
    logger.warn(`SID list file not found: ${resolved}`);
    return [];
  }
  const content = await readFile(resolved, "utf8");
  if (resolved.endsWith(".jsonl") || resolved.endsWith(".ndjson")) {
    const entries: SidSpec[] = [];
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) {
        continue;
      }
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const sidPath = record.sid_path ?? record.sidPath ?? record.path;
        if (typeof sidPath !== "string" || sidPath.trim().length === 0) {
          logger.warn(`Invalid SID entry at line ${index + 1} in ${resolved}`);
          continue;
        }
        const spec: SidSpec = { path: sidPath };
        const songIndexRaw = record.song_index ?? record.songIndex;
        if (
          typeof songIndexRaw === "number" &&
          Number.isFinite(songIndexRaw) &&
          songIndexRaw > 0
        ) {
          spec.songIndex = Math.floor(songIndexRaw);
        }
        entries.push(spec);
      } catch (error) {
        logger.warn(`Failed to parse line ${index + 1} in ${resolved}: ${String(error)}`);
      }
    }
    return entries;
  }

  const specs: SidSpec[] = [];
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const spec = parseSidSpec(line);
    if (spec) {
      specs.push(spec);
    }
  }
  return specs;
}

async function loadDefaultSidList(): Promise<SidSpec[]> {
  const samplePath = path.resolve("data/classified/sample.jsonl");
  if (!(await pathExists(samplePath))) {
    return [];
  }
  return loadSidListFile(samplePath);
}

async function resolveSidEntries(specs: SidSpec[], sidPath: string): Promise<ResolvedSidEntry[]> {
  const resolved: ResolvedSidEntry[] = [];
  const seen = new Set<string>();

  for (const spec of specs) {
    const mapping = resolveSidPath(sidPath, spec.path);
    const absolutePath = mapping.absolutePath;
    const relativePath = mapping.relativePath;
    const key = `${absolutePath}#${spec.songIndex ?? 0}`;
    if (seen.has(key)) {
      continue;
    }
    if (!(await pathExists(absolutePath))) {
      logger.warn(`Skipping missing SID: ${relativePath}`);
      continue;
    }
    seen.add(key);
    resolved.push({
      relativePath,
      absolutePath,
      songIndex: spec.songIndex,
      path: spec.path,
    });
  }

  return resolved;
}

function resolveSidPath(sidPath: string, input: string): {
  absolutePath: string;
  relativePath: string;
} {
  const normalizedInput = input.replace(/\\/g, "/");
  if (path.isAbsolute(normalizedInput)) {
    const absolutePath = path.normalize(normalizedInput);
    const relativePath = path.relative(sidPath, absolutePath).replace(/\\/g, "/");
    return {
      absolutePath,
      relativePath,
    };
  }
  const relative = normalizedInput.replace(/^\/+/, "");
  const absolutePath = path.resolve(sidPath, relative);
  return {
    absolutePath,
    relativePath: relative,
  };
}

function createOrchestrator(
  config: SidflowConfig,
  targetDurationMs: number,
  maxLossRate: number,
  encoderOverrides?: AudioEncoderConfig
): RenderOrchestrator {
  const ultimateConfig = config.render?.ultimate64;
  let ultimate64Client: Ultimate64Client | undefined;
  let ultimate64Capture: Ultimate64AudioCapture | undefined;

  if (ultimateConfig) {
    ultimate64Client = new Ultimate64Client({
      host: ultimateConfig.host,
      https: ultimateConfig.https,
      password: ultimateConfig.password,
    });
    ultimate64Capture = new Ultimate64AudioCapture({
      port: ultimateConfig.audioPort ?? 11001,
      targetDurationMs,
      maxLossRate,
    });
  }

  const hvscRoot = path.resolve(config.sidPath);
  const availabilityManifestPath = config.availability?.manifestPath
    ? path.resolve(config.availability.manifestPath)
    : undefined;
  const availabilityAssetRoot = config.availability?.assetRoot
    ? path.resolve(config.availability.assetRoot)
    : undefined;

  const renderSettings = config.render;
  const audioEncoderConfig = renderSettings?.audioEncoder;
  const mergedWasmOptions = mergeWasmOptions(
    audioEncoderConfig?.wasm,
    encoderOverrides?.wasm
  );

  return new RenderOrchestrator({
    ultimate64Client,
    ultimate64Capture,
    sidplayfpCliPath: config.sidplayPath,
    ultimate64AudioPort: ultimateConfig?.audioPort,
    ultimate64StreamIp: ultimateConfig?.streamIp,
    hvscRoot,
    availabilityManifestPath,
    availabilityAssetRoot,
    availabilityPublicBaseUrl: config.availability?.publicBaseUrl,
    m4aBitrate: renderSettings?.m4aBitrate,
    flacCompressionLevel: renderSettings?.flacCompressionLevel,
    audioEncoderImplementation:
      encoderOverrides?.implementation ?? audioEncoderConfig?.implementation,
    ffmpegWasmOptions: mergedWasmOptions,
  });
}

if (import.meta.main) {
  runRenderCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      logger.error(`Render CLI failed: ${String(error)}`);
      process.exitCode = 1;
    });
}
