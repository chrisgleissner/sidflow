/**
 * Audio encoding utilities for converting PCM/WAV to M4A and FLAC
 * Supports both ffmpeg.wasm (portable) and native ffmpeg (optimized)
 */

import { createLogger } from "./logger.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { createFFmpeg, fetchFile, type FFmpeg } from "@ffmpeg/ffmpeg";
import type { AudioEncoderImplementation } from "./audio-types.js";

const logger = createLogger("audio-encoding");
const require = createRequire(import.meta.url);

export const DEFAULT_M4A_BITRATE = 256; // kbps
export const DEFAULT_FLAC_COMPRESSION_LEVEL = 5;
export const DEFAULT_AUDIO_ENCODER_IMPLEMENTATION: AudioEncoderImplementation = "auto";

const FFMPEG_PATH = "ffmpeg";
const FFPROBE_PATH = "ffprobe";

const DEFAULT_FFMPEG_CORE_PATH = tryResolve("@ffmpeg/core/dist/ffmpeg-core.js");
const DEFAULT_FFMPEG_WASM_PATH = tryResolve("@ffmpeg/core/dist/ffmpeg-core.wasm");
const DEFAULT_FFMPEG_WORKER_PATH = tryResolve("@ffmpeg/core/dist/ffmpeg-core.worker.js");

let wasmEncoder: FFmpeg | null = null;

function tryResolve(moduleId: string): string | undefined {
  try {
    return require.resolve(moduleId);
  } catch {
    return undefined;
  }
}

export interface FfmpegWasmOptions {
  readonly log?: boolean;
  readonly corePath?: string;
  readonly wasmPath?: string;
  readonly workerPath?: string;
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
  return {
    log: options?.log ?? false,
    corePath: options?.corePath ?? DEFAULT_FFMPEG_CORE_PATH,
    wasmPath: options?.wasmPath ?? DEFAULT_FFMPEG_WASM_PATH,
    workerPath: options?.workerPath ?? DEFAULT_FFMPEG_WORKER_PATH,
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
    const data = await fetchFile(inputPath);
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
