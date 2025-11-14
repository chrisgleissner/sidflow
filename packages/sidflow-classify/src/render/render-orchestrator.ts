/**
 * Render orchestration for generating audio assets from SID files
 * Supports multiple engines: WASM, sidplayfp CLI, and Ultimate 64 hardware
 */

import { createLogger, ensureDir } from "@sidflow/common";
import type {
  Ultimate64Client,
  Ultimate64AudioCapture,
  CaptureStatistics,
} from "@sidflow/common";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderWavWithEngine } from "./wav-renderer.js";
import { createEngine } from "./engine-factory.js";
import type { SidAudioEngine } from "@sidflow/libsidplayfp-wasm";
import {
  encodeWavToM4aNative,
  encodeWavToFlacNative,
  DEFAULT_M4A_BITRATE,
  DEFAULT_FLAC_COMPRESSION_LEVEL,
} from "@sidflow/common";

const logger = createLogger("render-orchestrator");

export type RenderEngine = "wasm" | "sidplayfp-cli" | "ultimate64";
export type RenderFormat = "wav" | "m4a" | "flac";

export interface RenderRequest {
  readonly sidPath: string;
  readonly outputDir: string;
  readonly engine: RenderEngine;
  readonly formats: RenderFormat[];
  readonly chip?: "6581" | "8580r5";
  readonly songIndex?: number;
  readonly maxRenderSeconds?: number;
  readonly targetDurationMs?: number;
  readonly maxLossRate?: number;
}

export interface RenderResult {
  readonly sidPath: string;
  readonly engine: RenderEngine;
  readonly chip: "6581" | "8580r5";
  readonly outputs: {
    readonly format: RenderFormat;
    readonly path: string;
    readonly sizeBytes: number;
  }[];
  readonly durationMs: number;
  readonly errors?: string[];
}

export interface RenderOrchestratorConfig {
  readonly ultimate64Client?: Ultimate64Client;
  readonly ultimate64Capture?: Ultimate64AudioCapture;
  readonly sidplayfpCliPath?: string;
  readonly m4aBitrate?: number;
  readonly flacCompressionLevel?: number;
  readonly ultimate64AudioPort?: number;
  readonly ultimate64StreamIp?: string;
}

export class RenderOrchestrator {
  private readonly config: RenderOrchestratorConfig;

  constructor(config: RenderOrchestratorConfig = {}) {
    this.config = config;
  }

  /**
   * Render a SID file to multiple formats
   */
  async render(request: RenderRequest): Promise<RenderResult> {
    const startTime = Date.now();
    const chip = request.chip ?? "6581";
    const errors: string[] = [];
    const outputs: RenderResult["outputs"] = [];

    logger.debug(
      `Rendering ${path.basename(request.sidPath)} with ${request.engine} engine (${chip})`
    );

    await ensureDir(request.outputDir);

    // Step 1: Generate WAV file
    const baseName = path.basename(request.sidPath, ".sid");
    const trackSuffix =
      request.songIndex !== undefined ? `-${request.songIndex}` : "";
    const filePrefix = `${baseName}${trackSuffix}-${request.engine}-${chip}`;
    const wavPath = path.join(request.outputDir, `${filePrefix}.wav`);

    try {
      await this.renderWav(request, wavPath, chip);
      logger.debug(`WAV rendered: ${wavPath}`);

      if (request.formats.includes("wav")) {
        const stats = await import("node:fs/promises").then((fs) =>
          fs.stat(wavPath)
        );
        outputs.push({
          format: "wav",
          path: wavPath,
          sizeBytes: stats.size,
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      errors.push(`WAV rendering failed: ${message}`);
      logger.error(`Failed to render WAV: ${message}`);

      // If WAV fails, we can't continue with other formats
      return {
        sidPath: request.sidPath,
        engine: request.engine,
        chip,
        outputs,
        durationMs: Date.now() - startTime,
        errors,
      };
    }

    // Step 2: Encode to M4A if requested
    if (request.formats.includes("m4a")) {
      const m4aPath = path.join(request.outputDir, `${filePrefix}.m4a`);
      try {
        const result = await encodeWavToM4aNative({
          inputPath: wavPath,
          outputPath: m4aPath,
          m4aBitrate: this.config.m4aBitrate ?? DEFAULT_M4A_BITRATE,
        });

        if (result.success) {
          outputs.push({
            format: "m4a",
            path: m4aPath,
            sizeBytes: result.outputSizeBytes ?? 0,
          });
          logger.debug(`M4A encoded: ${m4aPath}`);
        } else {
          errors.push(`M4A encoding failed: ${result.error}`);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        errors.push(`M4A encoding failed: ${message}`);
        logger.error(`Failed to encode M4A: ${message}`);
      }
    }

    // Step 3: Encode to FLAC if requested
    if (request.formats.includes("flac")) {
      const flacPath = path.join(request.outputDir, `${filePrefix}.flac`);
      try {
        const result = await encodeWavToFlacNative({
          inputPath: wavPath,
          outputPath: flacPath,
          flacCompressionLevel:
            this.config.flacCompressionLevel ??
            DEFAULT_FLAC_COMPRESSION_LEVEL,
        });

        if (result.success) {
          outputs.push({
            format: "flac",
            path: flacPath,
            sizeBytes: result.outputSizeBytes ?? 0,
          });
          logger.debug(`FLAC encoded: ${flacPath}`);
        } else {
          errors.push(`FLAC encoding failed: ${result.error}`);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        errors.push(`FLAC encoding failed: ${message}`);
        logger.error(`Failed to encode FLAC: ${message}`);
      }
    }

    const durationMs = Date.now() - startTime;
    logger.debug(
      `Rendering complete: ${outputs.length} outputs in ${durationMs}ms`
    );

    return {
      sidPath: request.sidPath,
      engine: request.engine,
      chip,
      outputs,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Render WAV using selected engine
   */
  private async renderWav(
    request: RenderRequest,
    wavPath: string,
    chip: "6581" | "8580r5"
  ): Promise<void> {
    switch (request.engine) {
      case "wasm":
        await this.renderWavWasm(request, wavPath);
        break;
      case "sidplayfp-cli":
        await this.renderWavCli(request, wavPath);
        break;
      case "ultimate64":
        await this.renderWavUltimate64(request, wavPath, chip);
        break;
      default:
        throw new Error(`Unsupported render engine: ${request.engine}`);
    }
  }

  /**
   * Render WAV using WASM engine
   */
  private async renderWavWasm(
    request: RenderRequest,
    wavPath: string
  ): Promise<void> {
    const engine = await createEngine();
    try {
      await renderWavWithEngine(engine, {
        sidFile: request.sidPath,
        wavFile: wavPath,
        songIndex: request.songIndex,
        maxRenderSeconds: request.maxRenderSeconds,
        targetDurationMs: request.targetDurationMs,
      });
    } finally {
      // Clean up engine resources
      if (typeof (engine as any).destroy === "function") {
        await (engine as any).destroy();
      }
    }
  }

  /**
   * Render WAV using sidplayfp CLI
   */
  private async renderWavCli(
    request: RenderRequest,
    wavPath: string
  ): Promise<void> {
    const { spawn } = await import("node:child_process");
    const sidplayfpPath = this.config.sidplayfpCliPath ?? "sidplayfp";

    const args = ["-w", wavPath];

    if (request.songIndex !== undefined) {
      args.push("-o", String(request.songIndex));
    }

    if (request.maxRenderSeconds) {
      args.push("-t", String(request.maxRenderSeconds));
    }

    args.push(request.sidPath);

    logger.debug(`Running: ${sidplayfpPath} ${args.join(" ")}`);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(sidplayfpPath, args, {
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
          reject(
            new Error(
              `sidplayfp exited with code ${code}: ${stderr}`
            )
          );
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });
  }

  /**
   * Render WAV using Ultimate 64 hardware
   */
  private async renderWavUltimate64(
    request: RenderRequest,
    wavPath: string,
    chip: "6581" | "8580r5"
  ): Promise<void> {
    if (!this.config.ultimate64Client || !this.config.ultimate64Capture) {
      throw new Error(
        "Ultimate 64 client and capture not configured"
      );
    }

    const client = this.config.ultimate64Client;
    const capture = this.config.ultimate64Capture;
    const audioPort = this.config.ultimate64AudioPort ?? 11001;
    const streamIp = this.config.ultimate64StreamIp ?? "127.0.0.1";

    // Load SID file
    const sidBuffer = new Uint8Array(await readFile(request.sidPath));

    // Configure SID chip
    await client.setSidChip(chip);

    let captureCompleted = false;

    const requestedDurationMs = request.targetDurationMs ?? 120_000;

    const captureResultPromise = new Promise<{
      samples: Int16Array;
      stats: CaptureStatistics;
    }>((resolve, reject) => {
      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const handleStopped = () => {
        cleanup();
        captureCompleted = true;
        try {
          const result = capture.stop();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      const cleanup = () => {
        capture.off("error", handleError);
        capture.off("stopped", handleStopped);
      };
      capture.once("error", handleError);
      capture.once("stopped", handleStopped);
    });

    const captureTimeout = setTimeout(() => {
      if (!captureCompleted) {
        logger.debug(
          `Ultimate 64 capture timeout reached after ${requestedDurationMs}ms; stopping capture`
        );
        try {
          capture.stop();
        } catch (err) {
          logger.warn("Ultimate 64 capture timeout stop failed", err);
        }
      }
    }, requestedDurationMs + 1000);

    await capture.start(audioPort);

    let streamStarted = false;

    try {
      await client.startStream({
        stream: "audio",
        ip: streamIp,
        port: audioPort,
      });
      streamStarted = true;

      // Start playback
      await client.sidplay({
        sidBuffer,
        songNumber: request.songIndex,
      });

      // Wait for capture to complete
      const { samples, stats } = await captureResultPromise;

      if (
        typeof request.maxLossRate === "number" &&
        stats.lossRate > request.maxLossRate
      ) {
        throw new Error(
          `Ultimate 64 capture loss rate ${(stats.lossRate * 100).toFixed(2)}% exceeded threshold ${(request.maxLossRate * 100).toFixed(2)}%`
        );
      }

      // Convert to WAV
      // Note: Ultimate 64 outputs at PAL (47983 Hz) or NTSC (47940 Hz) sample rates,
      // but we use standard 44.1 kHz for compatibility with common audio tools
      const { encodePcmToWav } = await import("./wav-renderer.js");
      const STANDARD_SAMPLE_RATE = 44100;
      const wavBuffer = encodePcmToWav(samples, STANDARD_SAMPLE_RATE, 2);

      // Write WAV file
      await import("node:fs/promises").then((fs) =>
        fs.writeFile(wavPath, wavBuffer)
      );

      logger.debug(`Ultimate 64 capture complete: ${samples.length} samples`);
    } finally {
      clearTimeout(captureTimeout);

      if (!captureCompleted) {
        try {
          capture.stop();
        } catch (err) {
          logger.warn("Ultimate 64 capture stop failed", err);
        }
      }

      if (streamStarted) {
        try {
          await client.stopStream("audio");
        } catch (err) {
          logger.warn("Failed to stop Ultimate 64 audio stream", err);
        }
      }
    }
  }

  /**
   * Check if an engine is available
   */
  async checkEngineAvailability(
    engine: RenderEngine
  ): Promise<{ available: boolean; reason?: string }> {
    switch (engine) {
      case "wasm":
        // WASM is always available
        return { available: true };

      case "sidplayfp-cli": {
        // Check if sidplayfp binary exists
        const { spawn } = await import("node:child_process");
        const sidplayfpPath =
          this.config.sidplayfpCliPath ?? "sidplayfp";

        try {
          await new Promise<void>((resolve, reject) => {
            const proc = spawn(sidplayfpPath, ["--version"], {
              stdio: ["ignore", "pipe", "pipe"],
            });

            proc.on("close", (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error("sidplayfp not found"));
              }
            });

            proc.on("error", (err) => {
              reject(err);
            });

            // Timeout after 2 seconds
            setTimeout(() => {
              proc.kill();
              reject(new Error("sidplayfp check timeout"));
            }, 2000);
          });

          return { available: true };
        } catch {
          return {
            available: false,
            reason: "sidplayfp CLI not found or not executable",
          };
        }
      }

      case "ultimate64": {
        if (!this.config.ultimate64Client) {
          return {
            available: false,
            reason: "Ultimate 64 client not configured",
          };
        }

        // Try to ping the Ultimate 64
        try {
          await this.config.ultimate64Client.getVersion();
          return { available: true };
        } catch (err) {
          return {
            available: false,
            reason: `Ultimate 64 not reachable: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      default:
        return { available: false, reason: "Unknown engine" };
    }
  }
}
