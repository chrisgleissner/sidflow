/**
 * Render orchestration for generating audio assets from SID files
 * Supports multiple engines: WASM, sidplayfp CLI, and Ultimate 64 hardware
 */

import {
  createAvailabilityAssetId,
  createLogger,
  encodeWavToFlacNative,
  encodeWavToM4aNative,
  ensureDir,
  registerAvailabilityAsset,
  DEFAULT_FLAC_COMPRESSION_LEVEL,
  DEFAULT_M4A_BITRATE,
  type AvailabilityAsset,
  type RenderMode,
} from "@sidflow/common";
import type {
  Ultimate64Client,
  Ultimate64AudioCapture,
  CaptureStatistics,
} from "@sidflow/common";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderWavWithEngine } from "./wav-renderer.js";
import { createEngine } from "./engine-factory.js";

const logger = createLogger("render-orchestrator");
export type RenderEngine = "wasm" | "sidplayfp-cli" | "ultimate64";
export type RenderFormat = "wav" | "m4a" | "flac";

export interface RenderRequest {
  readonly sidPath: string;
  readonly outputDir: string;
  readonly engine: RenderEngine;
  readonly formats: RenderFormat[];
  readonly relativeSidPath?: string;
  readonly renderMode?: RenderMode;
  readonly chip?: "6581" | "8580r5";
  readonly songIndex?: number;
  readonly maxRenderSeconds?: number;
  readonly targetDurationMs?: number;
  readonly maxLossRate?: number;
}

interface RegisterAssetParams {
  readonly format: RenderFormat;
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly codec?: string;
  readonly bitrateKbps?: number;
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly relativeSidPath: string;
  readonly songIndex: number;
  readonly renderMode: RenderMode;
  readonly engine: RenderEngine;
  readonly capture?: CaptureStatistics;
  readonly checksum?: string;
  readonly metadata?: Record<string, unknown>;
}

interface WavFileMetadata {
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly byteRate: number;
}

function computeBitrateKbps(
  sizeBytes: number,
  durationMs: number
): number | undefined {
  if (sizeBytes <= 0 || durationMs <= 0) {
    return undefined;
  }
  const durationSeconds = durationMs / 1000;
  if (durationSeconds <= 0) {
    return undefined;
  }
  const bitsPerSecond = (sizeBytes * 8) / durationSeconds;
  return Math.max(1, Math.round(bitsPerSecond / 1000));
}

async function probeWavMetadata(filePath: string): Promise<WavFileMetadata> {
  const buffer = await readFile(filePath);
  if (buffer.length < 44) {
    throw new Error("WAV file is too small to contain required headers");
  }

  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV header");
  }

  let offset = 12;
  let fmtChunkOffset = -1;
  let dataChunkSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      fmtChunkOffset = chunkStart;
    } else if (chunkId === "data") {
      dataChunkSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (fmtChunkOffset < 0) {
    throw new Error("Missing fmt chunk in WAV file");
  }

  if (dataChunkSize <= 0) {
    throw new Error("Missing data chunk in WAV file");
  }

  const channels = buffer.readUInt16LE(fmtChunkOffset + 2);
  const sampleRate = buffer.readUInt32LE(fmtChunkOffset + 4);
  const byteRate = buffer.readUInt32LE(fmtChunkOffset + 8);
  const bitsPerSample = buffer.readUInt16LE(fmtChunkOffset + 14);
  const resolvedByteRate =
    byteRate > 0 ? byteRate : sampleRate * channels * (bitsPerSample / 8);
  const durationMs = resolvedByteRate
    ? Math.max(1, Math.round((dataChunkSize / resolvedByteRate) * 1000))
    : 0;

  return {
    durationMs,
    sampleRate,
    channels,
    bitsPerSample,
    byteRate: resolvedByteRate,
  };
}

function toPosixPath(input: string): string {
  return input.replace(/\\+/g, "/");
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
  readonly hvscRoot?: string;
  readonly availabilityManifestPath?: string;
  readonly availabilityAssetRoot?: string;
  readonly availabilityPublicBaseUrl?: string;
  readonly registerAvailabilityAssets?: boolean;
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
    const renderMode =
      request.renderMode ?? this.buildDefaultRenderMode(request.engine);
    const relativeSidPathCandidate =
      request.relativeSidPath ??
      this.resolveRelativeSidPath(request.sidPath);
    const manifestRelativeSidPath = this.shouldRegisterAssets(
      relativeSidPathCandidate
    )
      ? relativeSidPathCandidate
      : null;
    const songIndex = request.songIndex ?? 1;

    logger.debug(
      `Rendering ${path.basename(request.sidPath)} with ${request.engine} engine (${chip})`
    );

    await ensureDir(request.outputDir);

    const fs = await import("node:fs/promises");

    // Step 1: Generate WAV file
    const baseName = path.basename(request.sidPath, ".sid");
    const trackSuffix =
      request.songIndex !== undefined ? `-${request.songIndex}` : "";
    const filePrefix = `${baseName}${trackSuffix}-${request.engine}-${chip}`;
    const wavPath = path.join(request.outputDir, `${filePrefix}.wav`);
    let captureStats: CaptureStatistics | undefined;

    try {
      captureStats = await this.renderWav(request, wavPath, chip);
      logger.debug(`WAV rendered: ${wavPath}`);

      if (request.formats.includes("wav")) {
        const stats = await fs.stat(wavPath);
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

    let wavMetadata: WavFileMetadata | null = null;
    try {
      wavMetadata = await probeWavMetadata(wavPath);
    } catch (error) {
      logger.warn(`Failed to parse WAV metadata for ${wavPath}`, error);
    }

    if (manifestRelativeSidPath && request.formats.includes("wav") && wavMetadata) {
      try {
        const wavStats = await fs.stat(wavPath);
        await this.recordAvailabilityAsset({
          format: "wav",
          filePath: wavPath,
          sizeBytes: wavStats.size,
          codec: "pcm_s16le",
          durationMs: wavMetadata.durationMs,
          sampleRate: wavMetadata.sampleRate,
          channels: wavMetadata.channels,
          bitrateKbps: computeBitrateKbps(
            wavStats.size,
            wavMetadata.durationMs
          ),
          relativeSidPath: manifestRelativeSidPath,
          songIndex,
          renderMode,
          engine: request.engine,
          capture: captureStats,
        });
      } catch (error) {
        logger.warn("Failed to register WAV availability asset", error);
      }
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
          const fileStats = await fs.stat(m4aPath);
          outputs.push({
            format: "m4a",
            path: m4aPath,
            sizeBytes: fileStats.size,
          });
          logger.debug(`M4A encoded: ${m4aPath}`);

          if (manifestRelativeSidPath && wavMetadata) {
            try {
              await this.recordAvailabilityAsset({
                format: "m4a",
                filePath: m4aPath,
                sizeBytes: fileStats.size,
                codec: "aac",
                bitrateKbps: computeBitrateKbps(
                  fileStats.size,
                  wavMetadata.durationMs
                ),
                durationMs: wavMetadata.durationMs,
                sampleRate: wavMetadata.sampleRate,
                channels: wavMetadata.channels,
                relativeSidPath: manifestRelativeSidPath,
                songIndex,
                renderMode,
                engine: request.engine,
                capture: captureStats,
              });
            } catch (error) {
              logger.warn("Failed to register M4A availability asset", error);
            }
          }
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
          const fileStats = await fs.stat(flacPath);
          outputs.push({
            format: "flac",
            path: flacPath,
            sizeBytes: fileStats.size,
          });
          logger.debug(`FLAC encoded: ${flacPath}`);

          if (manifestRelativeSidPath && wavMetadata) {
            try {
              await this.recordAvailabilityAsset({
                format: "flac",
                filePath: flacPath,
                sizeBytes: fileStats.size,
                codec: "flac",
                bitrateKbps: computeBitrateKbps(
                  fileStats.size,
                  wavMetadata.durationMs
                ),
                durationMs: wavMetadata.durationMs,
                sampleRate: wavMetadata.sampleRate,
                channels: wavMetadata.channels,
                relativeSidPath: manifestRelativeSidPath,
                songIndex,
                renderMode,
                engine: request.engine,
                capture: captureStats,
              });
            } catch (error) {
              logger.warn("Failed to register FLAC availability asset", error);
            }
          }
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
  ): Promise<CaptureStatistics | undefined> {
    switch (request.engine) {
      case "wasm":
        await this.renderWavWasm(request, wavPath);
        return undefined;
      case "sidplayfp-cli":
        await this.renderWavCli(request, wavPath);
        return undefined;
      case "ultimate64":
        return this.renderWavUltimate64(request, wavPath, chip);
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
  ): Promise<CaptureStatistics | undefined> {
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

    let captureStats: CaptureStatistics | undefined;

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
      captureStats = stats;

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

    return captureStats;
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

  private buildDefaultRenderMode(engine: RenderEngine): RenderMode {
    return {
      location: "server",
      time: "prepared",
      technology: engine,
      target: "wav-m4a-flac",
    };
  }

  private resolveRelativeSidPath(sidPath: string): string | null {
    if (!this.config.hvscRoot) {
      return null;
    }

    const relative = path.relative(this.config.hvscRoot, sidPath);
    if (relative.startsWith("..")) {
      return null;
    }

    return toPosixPath(relative);
  }

  private shouldRegisterAssets(
    relativeSidPath?: string | null
  ): relativeSidPath is string {
    if (this.config.registerAvailabilityAssets === false) {
      return false;
    }
    if (!this.config.availabilityManifestPath) {
      return false;
    }
    return Boolean(relativeSidPath);
  }

  private async recordAvailabilityAsset(
    params: RegisterAssetParams
  ): Promise<void> {
    if (!this.config.availabilityManifestPath) {
      return;
    }

    const storagePath = this.resolveStoragePath(params.filePath);
    const publicPath = this.buildPublicPath(storagePath);

    const asset: AvailabilityAsset = {
      id: createAvailabilityAssetId({
        relativeSidPath: params.relativeSidPath,
        songIndex: params.songIndex,
        format: params.format,
        engine: params.engine,
        renderMode: params.renderMode,
      }),
      relativeSidPath: params.relativeSidPath,
      songIndex: params.songIndex,
      format: params.format,
      engine: params.engine,
      renderMode: params.renderMode,
      durationMs: params.durationMs,
      sampleRate: params.sampleRate,
      channels: params.channels,
      sizeBytes: params.sizeBytes,
      bitrateKbps: params.bitrateKbps,
      codec: params.codec,
      storagePath,
      publicPath,
      checksum: params.checksum,
      capture: params.capture
        ? {
            ...params.capture,
            sampleRate: params.sampleRate,
            channels: params.channels,
          }
        : undefined,
      metadata: params.metadata,
      generatedAt: new Date().toISOString(),
    };

    await registerAvailabilityAsset(this.config.availabilityManifestPath, asset, {
      details: {
        format: params.format,
        songIndex: params.songIndex,
        relativeSidPath: params.relativeSidPath,
      },
    });
  }

  private resolveStoragePath(filePath: string): string {
    if (this.config.availabilityAssetRoot) {
      const relative = path.relative(this.config.availabilityAssetRoot, filePath);
      if (!relative.startsWith("..")) {
        return toPosixPath(relative);
      }
    }
    return toPosixPath(path.relative(process.cwd(), filePath));
  }

  private buildPublicPath(storagePath: string): string | undefined {
    if (!this.config.availabilityPublicBaseUrl) {
      return undefined;
    }
    const base = this.config.availabilityPublicBaseUrl.replace(/\/+$/, "");
    return `${base}/${storagePath}`;
  }
}
