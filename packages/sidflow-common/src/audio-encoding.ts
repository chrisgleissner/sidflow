/**
 * Audio encoding utilities for converting PCM/WAV to M4A and FLAC
 * Supports both ffmpeg.wasm (portable) and native ffmpeg (optimized)
 */

import { createLogger } from "./logger.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { writeFile, readFile } from "node:fs/promises";
import { createFFmpeg, fetchFile, type FFmpeg } from "@ffmpeg/ffmpeg";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import type {
  AudioEncoderImplementation,
  FfmpegWasmOptions,
} from "./audio-types.js";

const logger = createLogger("audio-encoding");
const require = createRequire(import.meta.url);

export const DEFAULT_M4A_BITRATE = 256; // kbps
export const DEFAULT_FLAC_COMPRESSION_LEVEL = 5;
export const DEFAULT_AUDIO_ENCODER_IMPLEMENTATION: AudioEncoderImplementation = "auto";

const FFMPEG_PATH = "ffmpeg";
const FFPROBE_PATH = "ffprobe";

/**
 * Check if ffmpeg is available in the system PATH
 */
export async function isFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG_PATH, ["-version"], {
      stdio: "ignore",
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Check if ffprobe is available in the system PATH
 */
export async function isFfprobeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(FFPROBE_PATH, ["-version"], {
      stdio: "ignore",
    });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

const FFMPEG_STATIC_RESOLUTION: Record<string, readonly string[]> = {
  "@ffmpeg/core/dist/ffmpeg-core.js": ["@ffmpeg/core/dist/ffmpeg-core.js"],
  "@ffmpeg/core/dist/ffmpeg-core.wasm": ["@ffmpeg/core/dist/ffmpeg-core.wasm"],
  "@ffmpeg/core/dist/ffmpeg-core.worker.js": ["@ffmpeg/core/dist/ffmpeg-core.worker.js"],
} as const;

const literalRequireResolvers = new Map<string, () => string>([
  ["@ffmpeg/core/dist/ffmpeg-core.js", () => require.resolve("@ffmpeg/core/dist/ffmpeg-core.js")],
  ["@ffmpeg/core/dist/ffmpeg-core.wasm", () => require.resolve("@ffmpeg/core/dist/ffmpeg-core.wasm")],
  [
    "@ffmpeg/core/dist/ffmpeg-core.worker.js",
    () => require.resolve("@ffmpeg/core/dist/ffmpeg-core.worker.js"),
  ],
]);

function resolveWithRequire(specifier: string): string | undefined {
  const resolver = literalRequireResolvers.get(specifier);
  if (!resolver) {
    return undefined;
  }
  try {
    return resolver();
  } catch {
    return undefined;
  }
}

function resolveWithImportMeta(
  resolver: ((specifier: string) => string) | undefined,
  specifier: string
): string | undefined {
  if (!resolver) {
    return undefined;
  }
  try {
    const resolvedUrl = resolver(specifier);
    return resolvedUrl.startsWith("file://")
      ? fileURLToPath(resolvedUrl)
      : resolvedUrl;
  } catch {
    return undefined;
  }
}

function tryResolve(moduleId: string): string | undefined {
  const staticCandidates =
    FFMPEG_STATIC_RESOLUTION[moduleId as keyof typeof FFMPEG_STATIC_RESOLUTION];
  const candidates = staticCandidates ?? [moduleId];

  for (const specifier of candidates) {
    const resolved = resolveWithRequire(specifier);
    if (resolved) {
      return resolved;
    }
  }

  const metaResolver = (import.meta as ImportMeta & {
    resolve?(specifier: string): string;
  }).resolve;

  for (const specifier of candidates) {
    const resolved = resolveWithImportMeta(metaResolver, specifier);
    if (resolved) {
      return resolved;
    }
  }

  return resolveFromBunStore(moduleId);
}

const DEFAULT_FFMPEG_CORE_PATH = tryResolve("@ffmpeg/core/dist/ffmpeg-core.js");
const DEFAULT_FFMPEG_WASM_PATH = tryResolve("@ffmpeg/core/dist/ffmpeg-core.wasm");
const DEFAULT_FFMPEG_WORKER_PATH = tryResolve("@ffmpeg/core/dist/ffmpeg-core.worker.js");

let wasmEncoder: FFmpeg | null = null;

function resolveFromBunStore(moduleId: string): string | undefined {
  if (!moduleId.startsWith("@ffmpeg/core/")) {
    return undefined;
  }

  const bunRoot = path.resolve(process.cwd(), "node_modules/.bun");
  const suffix = moduleId.replace("@ffmpeg/core/", "");

  try {
    const entries = readdirSync(bunRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("@ffmpeg+core@")) {
        continue;
      }
      const candidate = path.join(
        bunRoot,
        entry.name,
        "node_modules",
        "@ffmpeg",
        "core",
        suffix
      );
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export interface EncodeOptions {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly m4aBitrate?: number;
  readonly flacCompressionLevel?: number;
  readonly implementation?: AudioEncoderImplementation;
  readonly wasm?: FfmpegWasmOptions;
}

export interface EncodingResult {
  readonly success: boolean;
  readonly outputPath: string;
  readonly outputSizeBytes?: number;
  readonly error?: string;
  readonly implementation: AudioEncoderImplementation;
}

interface WasmRunOptions {
  readonly format: string;
  readonly buildArgs: (input: string, output: string) => string[];
}

function resolveImplementation(
  requested?: AudioEncoderImplementation
): AudioEncoderImplementation {
  return requested ?? DEFAULT_AUDIO_ENCODER_IMPLEMENTATION;
}

function normalizeWasmOptions(options?: FfmpegWasmOptions): FfmpegWasmOptions {
  const fetchImplementation = createFileAwareFetch(options?.fetch);
  ensureGlobalFetchPatched(fetchImplementation);

  return {
    log: options?.log ?? false,
    corePath: resolveCoreModulePath(options?.corePath ?? DEFAULT_FFMPEG_CORE_PATH),
    wasmPath: resolveWasmAssetPath(options?.wasmPath ?? DEFAULT_FFMPEG_WASM_PATH),
    workerPath: resolveWasmAssetPath(options?.workerPath ?? DEFAULT_FFMPEG_WORKER_PATH),
    fetch: fetchImplementation,
  };
}

async function getWasmEncoder(options?: FfmpegWasmOptions): Promise<FFmpeg> {
  if (!wasmEncoder) {
    const initOptions = normalizeWasmOptions(options);
    wasmEncoder = createFFmpeg(initOptions);
  }

  if (!wasmEncoder.isLoaded()) {
    await wasmEncoder.load();
  }

  if (options?.log) {
    wasmEncoder.setLogger?.(({ message }: { message: string }) =>
      logger.debug(message)
    );
  }

  return wasmEncoder;
}

async function runNativeEncoding(
  inputPath: string,
  outputPath: string,
  args: string[],
  format: string
): Promise<EncodingResult> {
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(FFMPEG_PATH, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

    const stats = await import("node:fs/promises").then((fs) =>
      fs.stat(outputPath)
    );
    const outputSizeBytes = stats.size;

    logger.debug(`Encoded ${inputPath} to ${format} (native): ${outputSizeBytes} bytes`);

    return {
      success: true,
      outputPath,
      outputSizeBytes,
      implementation: "native",
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to encode ${inputPath} to ${format} (native): ${errorMessage}`);
    return {
      success: false,
      outputPath,
      error: errorMessage,
      implementation: "native",
    };
  }
}

async function runWasmEncoding(
  options: EncodeOptions,
  wasmOptions: WasmRunOptions
): Promise<EncodingResult> {
  const { inputPath, outputPath } = options;
  const ffmpeg = await getWasmEncoder(options.wasm);
  const tempInput = `${randomUUID()}.wav`;
  const tempOutput = `${randomUUID()}.bin`;

  try {
    const data = await loadWasmInput(inputPath);
    ffmpeg.FS("writeFile", tempInput, data);

    const args = wasmOptions.buildArgs(tempInput, tempOutput);
    logger.debug(`Encoding ${inputPath} to ${wasmOptions.format} (wasm)`);
    await ffmpeg.run(...args);

    const outputData = ffmpeg.FS("readFile", tempOutput);
    await writeFile(outputPath, Buffer.from(outputData));

    const stats = await import("node:fs/promises").then((fs) =>
      fs.stat(outputPath)
    );

    return {
      success: true,
      outputPath,
      outputSizeBytes: stats.size,
      implementation: "wasm",
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to encode ${inputPath} to ${wasmOptions.format} (wasm): ${errorMessage}`);
    return {
      success: false,
      outputPath,
      error: errorMessage,
      implementation: "wasm",
    };
  } finally {
    try {
      ffmpeg.FS("unlink", tempInput);
      ffmpeg.FS("unlink", tempOutput);
    } catch {
      // ignore cleanup errors
    }
  }
}

function isLikelyUrl(value: string): boolean {
  if (value.startsWith("data:")) {
    return true;
  }
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value);
}

async function loadWasmInput(inputPath: string): Promise<Uint8Array> {
  if (isLikelyUrl(inputPath)) {
    return fetchFile(inputPath);
  }

  const fileBuffer = await readFile(inputPath);
  return fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer);
}

function resolveCoreModulePath(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (isLikelyUrl(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith(".") || path.isAbsolute(trimmed)) {
    // Convert to file:// URL for proper fetch handling
    const absolutePath = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
    return `file://${absolutePath}`;
  }

  return trimmed;
}

function resolveWasmAssetPath(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (isLikelyUrl(trimmed)) {
    return trimmed;
  }

  // Convert absolute paths to file:// URLs for proper fetch handling
  const absolutePath = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
  return `file://${absolutePath}`;
}

type FetchArgs = Parameters<typeof fetch>;
type FetchInput = FetchArgs[0];
type FetchInit = FetchArgs[1];
type FetchPreconnect = typeof fetch extends { preconnect: infer T }
  ? T extends (...args: any[]) => any
    ? T
    : () => Promise<void>
  : () => Promise<void>;

let activeGlobalFetch: typeof fetch | undefined;

function createFileAwareFetch(customFetch?: typeof fetch): typeof fetch {
  const baseFetch = customFetch ?? globalThis.fetch;
  if (!baseFetch) {
    throw new Error(
      "ffmpeg.wasm requires a fetch implementation; provide one via wasm.fetch or ensure global fetch is available."
    );
  }

  const ResponseCtor = globalThis.Response;
  if (!ResponseCtor) {
    throw new Error(
      "ffmpeg.wasm requires the Response constructor; ensure the runtime provides fetch/Response polyfills."
    );
  }

  const wrappedFetch = (async (resource: FetchInput, init?: FetchInit) => {
    const url = resolveFetchUrl(resource);
    if (url) {
      const fileResponse = await tryFetchLocalFile(url, init, ResponseCtor);
      if (fileResponse) {
        return fileResponse;
      }
    }

    return baseFetch(resource as FetchInput, init as FetchInit);
  }) as typeof fetch;

  const basePreconnect = (baseFetch as typeof baseFetch & {
    preconnect?: FetchPreconnect;
  }).preconnect;

  if (typeof basePreconnect === "function") {
    (wrappedFetch as typeof wrappedFetch & { preconnect: FetchPreconnect }).preconnect =
      basePreconnect.bind(baseFetch) as FetchPreconnect;
  } else {
    (wrappedFetch as typeof wrappedFetch & { preconnect: FetchPreconnect }).preconnect =
      ((() => Promise.resolve()) as FetchPreconnect);
  }

  return wrappedFetch;
}

function ensureGlobalFetchPatched(fetchImpl: typeof fetch): void {
  const target = globalThis as typeof globalThis & { fetch: typeof fetch };
  if (target.fetch === fetchImpl) {
    activeGlobalFetch = fetchImpl;
    return;
  }

  if (activeGlobalFetch && target.fetch === activeGlobalFetch) {
    target.fetch = fetchImpl;
    activeGlobalFetch = fetchImpl;
    logger.debug("Replaced patched global fetch for ffmpeg.wasm asset loading");
    return;
  }

  target.fetch = fetchImpl;
  activeGlobalFetch = fetchImpl;
  logger.debug("Patched global fetch to handle ffmpeg.wasm asset URLs");
}

function resolveFetchUrl(resource: FetchInput): string | undefined {
  if (typeof resource === "string") {
    return resource;
  }

  if (resource instanceof URL) {
    return resource.toString();
  }

  if (typeof resource === "object" && resource !== null && "url" in resource) {
    const candidate = (resource as { url?: unknown }).url;
    if (typeof candidate === "string") {
      return candidate;
    }
  }

  return undefined;
}

async function tryFetchLocalFile(
  url: string,
  init: FetchInit,
  ResponseCtor: typeof Response
): Promise<Response | undefined> {
  const method = init?.method?.toUpperCase() ?? "GET";
  if (method !== "GET") {
    return undefined;
  }

  const filePath = resolveLocalFilePath(url);
  if (!filePath) {
    return undefined;
  }

  const data = await readFile(filePath);
  logger.debug(`Serving ffmpeg.wasm asset from disk: ${url} -> ${filePath}`);
  return new ResponseCtor(data, {
    status: 200,
    headers: {
      "content-length": String(data.byteLength ?? data.length ?? 0),
    },
  });
}

function resolveLocalFilePath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return fileURLToPath(parsed);
    }
  } catch {
    // ignore URL parsing errors and fall through to path checks
  }

  if (!isLikelyUrl(url) && path.isAbsolute(url)) {
    return url;
  }

  return undefined;
}

async function encodeWithImplementation(
  options: EncodeOptions,
  nativeHandler: (opts: EncodeOptions) => Promise<EncodingResult>,
  wasmHandler: (opts: EncodeOptions) => Promise<EncodingResult>
): Promise<EncodingResult> {
  const implementation = resolveImplementation(options.implementation);
  if (implementation === "native") {
    return nativeHandler(options);
  }
  if (implementation === "wasm") {
    return wasmHandler(options);
  }

  const nativeResult = await nativeHandler(options);
  if (nativeResult.success) {
    return nativeResult;
  }

  logger.warn("Native ffmpeg encoding failed; falling back to ffmpeg.wasm");
  return wasmHandler({ ...options, implementation: "wasm" });
}

/**
 * Encode WAV to M4A using the preferred implementation (default auto)
 */
export function encodeWavToM4a(options: EncodeOptions): Promise<EncodingResult> {
  return encodeWithImplementation(options, encodeWavToM4aNative, encodeWavToM4aWasm);
}

/**
 * Encode WAV to FLAC using the preferred implementation (default auto)
 */
export function encodeWavToFlac(options: EncodeOptions): Promise<EncodingResult> {
  return encodeWithImplementation(options, encodeWavToFlacNative, encodeWavToFlacWasm);
}

/**
 * Encode WAV to M4A using native ffmpeg
 * Uses AAC-LC codec at specified bitrate (default 256 kbps)
 */
export async function encodeWavToM4aNative(
  options: EncodeOptions
): Promise<EncodingResult> {
  const { inputPath, outputPath, m4aBitrate = DEFAULT_M4A_BITRATE } = options;

  const args = [
    "-i",
    inputPath,
    "-c:a",
    "aac",
    "-b:a",
    `${m4aBitrate}k`,
    "-movflags",
    "+faststart",
    "-y",
    outputPath,
  ];

  return runNativeEncoding(inputPath, outputPath, args, "M4A");
}

export function encodeWavToM4aWasm(options: EncodeOptions): Promise<EncodingResult> {
  const bitrate = options.m4aBitrate ?? DEFAULT_M4A_BITRATE;
  return runWasmEncoding(options, {
    format: "M4A",
    buildArgs: (input, output) => [
      "-i",
      input,
      "-c:a",
      "aac",
      "-b:a",
      `${bitrate}k`,
      "-movflags",
      "+faststart",
      output,
    ],
  });
}

/**
 * Encode WAV to FLAC using native ffmpeg
 * Uses compression level 5 by default (balanced size/speed)
 */
export async function encodeWavToFlacNative(
  options: EncodeOptions
): Promise<EncodingResult> {
  const {
    inputPath,
    outputPath,
    flacCompressionLevel = DEFAULT_FLAC_COMPRESSION_LEVEL,
  } = options;

  const args = [
    "-i",
    inputPath,
    "-c:a",
    "flac",
    "-compression_level",
    String(flacCompressionLevel),
    "-y",
    outputPath,
  ];

  return runNativeEncoding(inputPath, outputPath, args, "FLAC");
}

export function encodeWavToFlacWasm(options: EncodeOptions): Promise<EncodingResult> {
  const compressionLevel = options.flacCompressionLevel ?? DEFAULT_FLAC_COMPRESSION_LEVEL;
  return runWasmEncoding(options, {
    format: "FLAC",
    buildArgs: (input, output) => [
      "-i",
      input,
      "-c:a",
      "flac",
      "-compression_level",
      String(compressionLevel),
      output,
    ],
  });
}

/**
 * Determine M4A bitrate from encoded file using ffprobe
 */
export async function getM4aBitrate(filePath: string): Promise<number | null> {
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const args = [
        "-v",
        "error",
        "-show_entries",
        "format=bit_rate",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ];

      const proc = spawn(FFPROBE_PATH, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

    const bitrate = Number.parseInt(output, 10);
    if (Number.isNaN(bitrate)) {
      return null;
    }

    return Math.round(bitrate / 1000);
  } catch (err) {
    logger.warn(`Failed to get bitrate for ${filePath}:`, err);
    return null;
  }
}
