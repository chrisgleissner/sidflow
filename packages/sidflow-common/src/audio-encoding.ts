/**
 * Audio encoding utilities for converting PCM/WAV to M4A and FLAC
 * Supports both ffmpeg.wasm (portable) and native ffmpeg (optimized)
 */

import { createLogger } from "./logger.js";
import { spawn } from "node:child_process";

const logger = createLogger("audio-encoding");

export const DEFAULT_M4A_BITRATE = 256; // kbps
export const DEFAULT_FLAC_COMPRESSION_LEVEL = 5;

export interface EncodeOptions {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly m4aBitrate?: number;
  readonly flacCompressionLevel?: number;
}

export interface EncodingResult {
  readonly success: boolean;
  readonly outputPath: string;
  readonly outputSizeBytes?: number;
  readonly error?: string;
}

/**
 * Encode WAV to M4A using native ffmpeg
 * Uses AAC-LC codec at specified bitrate (default 256 kbps)
 */
export async function encodeWavToM4aNative(options: EncodeOptions): Promise<EncodingResult> {
  const { inputPath, outputPath, m4aBitrate = DEFAULT_M4A_BITRATE } = options;

  logger.debug(`Encoding ${inputPath} to M4A (native ffmpeg, ${m4aBitrate}k)`);

  try {
    // Use system ffmpeg
    const ffmpegPath = "ffmpeg";

    await new Promise<void>((resolve, reject) => {
      const args = [
        "-i",
        inputPath,
        "-c:a",
        "aac",
        "-b:a",
        `${m4aBitrate}k`,
        "-y", // overwrite output file
        outputPath,
      ];

      const proc = spawn(ffmpegPath, args, {
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

    logger.debug(
      `Encoded ${inputPath} to M4A: ${outputSizeBytes} bytes`
    );

    return {
      success: true,
      outputPath,
      outputSizeBytes,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    logger.error(`Failed to encode ${inputPath} to M4A: ${errorMessage}`);
    return {
      success: false,
      outputPath,
      error: errorMessage,
    };
  }
}

/**
 * Encode WAV to FLAC using native ffmpeg
 * Uses compression level 5 by default (balanced size/speed)
 */
export async function encodeWavToFlacNative(options: EncodeOptions): Promise<EncodingResult> {
  const {
    inputPath,
    outputPath,
    flacCompressionLevel = DEFAULT_FLAC_COMPRESSION_LEVEL,
  } = options;

  logger.debug(
    `Encoding ${inputPath} to FLAC (native ffmpeg, level ${flacCompressionLevel})`
  );

  try {
    // Use system ffmpeg
    let ffmpegPath = "ffmpeg";

    await new Promise<void>((resolve, reject) => {
      const args = [
        "-i",
        inputPath,
        "-c:a",
        "flac",
        "-compression_level",
        String(flacCompressionLevel),
        "-y", // overwrite output file
        outputPath,
      ];

      const proc = spawn(ffmpegPath, args, {
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

    logger.debug(
      `Encoded ${inputPath} to FLAC: ${outputSizeBytes} bytes`
    );

    return {
      success: true,
      outputPath,
      outputSizeBytes,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    logger.error(`Failed to encode ${inputPath} to FLAC: ${errorMessage}`);
    return {
      success: false,
      outputPath,
      error: errorMessage,
    };
  }
}

/**
 * Determine M4A bitrate from encoded file using ffprobe
 */
export async function getM4aBitrate(filePath: string): Promise<number | null> {
  try {
    // Use system ffprobe
    const ffprobePath = "ffprobe";

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

      const proc = spawn(ffprobePath, args, {
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

    // Convert from bits per second to kilobits per second
    return Math.round(bitrate / 1000);
  } catch (err) {
    logger.warn(`Failed to get bitrate for ${filePath}:`, err);
    return null;
  }
}
