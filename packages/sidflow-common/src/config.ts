import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type {
  AudioEncoderConfig,
  AudioEncoderImplementation,
  FfmpegWasmOptions,
} from "./audio-types.js";
import { normalizeSidChip, type SidChipModel } from "./chip-model.js";
import {
  cacheConfig,
  getEnhancedCachedConfig,
  invalidateConfigCache,
  recordConfigLoadTime,
} from "./config-cache.js";

export type RenderEngine = "wasm" | "sidplayfp-cli" | "ultimate64";
export type RenderFormat = "wav" | "m4a" | "flac";

export interface Ultimate64RenderConfig {
  host: string;
  https?: boolean;
  password?: string;
  audioPort?: number;
  streamIp?: string;
}

export interface RenderSettings {
  outputPath?: string;
  defaultFormats?: RenderFormat[];
  preferredEngines?: RenderEngine[];
  defaultChip?: SidChipModel;
  m4aBitrate?: number;
  flacCompressionLevel?: number;
  audioEncoder?: AudioEncoderConfig;
  ultimate64?: Ultimate64RenderConfig;
}

export interface AvailabilityConfig {
  manifestPath?: string;
  assetRoot?: string;
  publicBaseUrl?: string;
}

export interface AlertThresholds {
  maxSessionFailureRate?: number; // 0.0-1.0, default 0.1 (10%)
  maxCacheAgeMs?: number; // milliseconds, default 7 days
  maxJobStallMs?: number; // milliseconds, default 1 hour
  maxCpuPercent?: number; // 0-100, default 80
  maxMemoryPercent?: number; // 0-100, default 90
}

export interface AlertConfig {
  enabled?: boolean;
  thresholds?: AlertThresholds;
  webhookUrl?: string;
  emailRecipients?: string[];
}

export interface SidflowConfig {
  /** Canonical SID collection root */
  sidPath: string;
  audioCachePath: string;
  tagsPath: string;
  classifiedPath?: string;
  sidplayPath?: string;
  threads: number;
  classificationDepth: number;
  render?: RenderSettings;
  availability?: AvailabilityConfig;
  alerts?: AlertConfig;
}

export const DEFAULT_CONFIG_FILENAME = ".sidflow.json";

let cachedConfig: SidflowConfig | null = null;
let cachedPath: string | null = null;
// sidplayPath deprecation warning REMOVED - this config key is still required
// for sidplayfp-cli renderer which is the preferred default engine.

export class SidflowConfigError extends Error {
  declare cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "SidflowConfigError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function getDefaultConfigPath(cwd: string = process.cwd()): string {
  return path.resolve(cwd, DEFAULT_CONFIG_FILENAME);
}

export function resetConfigCache(): void {
  cachedConfig = null;
  cachedPath = null;
  invalidateConfigCache();
}

export async function loadConfig(configPath?: string): Promise<SidflowConfig> {
  const startTime = performance.now();

  // Check for SIDFLOW_CONFIG environment variable if no explicit path provided
  const envConfigPath = process.env.SIDFLOW_CONFIG;
  const effectiveConfigPath = configPath ?? (envConfigPath || getDefaultConfigPath());
  // Use path.resolve only if effectiveConfigPath is not already absolute
  const resolvedPath = path.isAbsolute(effectiveConfigPath)
    ? effectiveConfigPath
    : path.resolve(effectiveConfigPath);

  // Try enhanced cache first (with hash validation)
  const cachedResult = await getEnhancedCachedConfig(resolvedPath);
  if (cachedResult) {
    recordConfigLoadTime(performance.now() - startTime);
    return cachedResult;
  }

  // Fallback to legacy cache check (will be removed once enhanced cache proven)
  if (cachedConfig && cachedPath === resolvedPath) {
    recordConfigLoadTime(performance.now() - startTime);
    return cachedConfig;
  }

  let fileContents: string;
  let fileMtime: number;
  try {
    fileContents = await readFile(resolvedPath, "utf8");
    const stats = await stat(resolvedPath);
    fileMtime = stats.mtimeMs;
  } catch (error) {
    throw new SidflowConfigError(
      `Unable to read SIDFlow config at ${resolvedPath}`,
      { cause: error }
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(fileContents);
  } catch (error) {
    throw new SidflowConfigError(
      `Invalid JSON in SIDFlow config at ${resolvedPath}`,
      { cause: error }
    );
  }

  const config = validateConfig(data, resolvedPath);
  const overrideSidBase = process.env.SIDFLOW_SID_BASE_PATH;
  if (overrideSidBase && overrideSidBase.trim().length > 0) {
    const normalizedOverride = path.normalize(overrideSidBase);
    config.sidPath = normalizedOverride;
  }

  // NOTE: sidplayPath is NOT deprecated - it's required for sidplayfp-cli renderer
  // which is the preferred default engine for classification and multi-format rendering.
  // The deprecation warning was incorrect and has been removed.

  // Update both legacy and enhanced caches
  cachedConfig = config;
  cachedPath = resolvedPath;
  await cacheConfig(config, resolvedPath, fileContents, fileMtime);

  recordConfigLoadTime(performance.now() - startTime);
  return config;
}

export function getCachedConfig(): SidflowConfig {
  if (!cachedConfig) {
    throw new SidflowConfigError(
      "Config has not been loaded yet. Call loadConfig() first."
    );
  }
  return cachedConfig;
}

function validateConfig(value: unknown, configPath: string): SidflowConfig {
  if (!value || typeof value !== "object") {
    throw new SidflowConfigError(
      `Config at ${configPath} must be a JSON object`
    );
  }

  const record = value as Record<string, unknown>;

  const requiredString = (key: keyof SidflowConfig): string => {
    const raw = record[key as string];
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new SidflowConfigError(
        `Config key \"${String(key)}\" must be a non-empty string`
      );
    }
    return path.normalize(raw);
  };

  const requiredNumber = (key: keyof SidflowConfig, predicate: (n: number) => boolean): number => {
    const raw = record[key as string];
    if (typeof raw !== "number" || Number.isNaN(raw)) {
      throw new SidflowConfigError(
        `Config key \"${String(key)}\" must be a number`
      );
    }
    if (!predicate(raw)) {
      throw new SidflowConfigError(
        `Config key \"${String(key)}\" failed validation`
      );
    }
    return raw;
  };

  const optionalString = (key: keyof SidflowConfig): string | undefined => {
    const raw = record[key as string];
    if (raw === undefined) {
      return undefined;
    }
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new SidflowConfigError(
        `Config key \"${String(key)}\" must be a non-empty string`
      );
    }
    return path.normalize(raw);
  };

  const sidPath = requiredString("sidPath");

  return {
    sidPath,
    audioCachePath: requiredString("audioCachePath"),
    tagsPath: requiredString("tagsPath"),
    classifiedPath: optionalString("classifiedPath"),
    sidplayPath: optionalString("sidplayPath"),
    threads: requiredNumber("threads", (n) => Number.isInteger(n) && n >= 0),
    classificationDepth: requiredNumber("classificationDepth", (n) => Number.isInteger(n) && n > 0),
    render: parseRenderSettings(record.render, configPath),
    availability: parseAvailabilityConfig(record.availability, configPath),
    alerts: parseAlertConfig(record.alerts, configPath),
  };
}

function parseRenderSettings(value: unknown, configPath: string): RenderSettings | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object") {
    throw new SidflowConfigError(
      `Config key "render" must be an object in ${configPath}`
    );
  }

  const record = value as Record<string, unknown>;
  const settings: RenderSettings = {};

  if (record.outputPath !== undefined) {
    if (typeof record.outputPath !== "string" || record.outputPath.trim() === "") {
      throw new SidflowConfigError(
        `Config key "render.outputPath" must be a non-empty string`
      );
    }
    settings.outputPath = path.normalize(record.outputPath);
  }

  if (record.defaultFormats !== undefined) {
    if (!Array.isArray(record.defaultFormats) || record.defaultFormats.length === 0) {
      throw new SidflowConfigError(
        `Config key "render.defaultFormats" must be a non-empty array`
      );
    }
    const allowedFormats: RenderFormat[] = ["wav", "m4a", "flac"];
    settings.defaultFormats = record.defaultFormats.map((entry, index) => {
      if (typeof entry !== "string" || !allowedFormats.includes(entry as RenderFormat)) {
        throw new SidflowConfigError(
          `Config key "render.defaultFormats[${index}]" must be one of ${allowedFormats.join(", ")}`
        );
      }
      return entry as RenderFormat;
    });
  }

  if (record.preferredEngines !== undefined) {
    if (!Array.isArray(record.preferredEngines) || record.preferredEngines.length === 0) {
      throw new SidflowConfigError(
        `Config key "render.preferredEngines" must be a non-empty array`
      );
    }
    const allowedEngines: RenderEngine[] = ["sidplayfp-cli", "ultimate64", "wasm"];
    settings.preferredEngines = record.preferredEngines.map((entry, index) => {
      if (typeof entry !== "string" || !allowedEngines.includes(entry as RenderEngine)) {
        throw new SidflowConfigError(
          `Config key "render.preferredEngines[${index}]" must be one of ${allowedEngines.join(", ")}`
        );
      }
      return entry as RenderEngine;
    });
  }

  if (record.defaultChip !== undefined) {
    const normalizedChip = normalizeSidChip(record.defaultChip);
    if (!normalizedChip) {
      throw new SidflowConfigError(
        `Config key "render.defaultChip" must be either "6581" or "8580"`
      );
    }
    settings.defaultChip = normalizedChip;
  }

  if (record.m4aBitrate !== undefined) {
    if (
      typeof record.m4aBitrate !== "number" ||
      !Number.isInteger(record.m4aBitrate) ||
      record.m4aBitrate <= 0
    ) {
      throw new SidflowConfigError(
        `Config key "render.m4aBitrate" must be a positive integer number of kbps`
      );
    }
    settings.m4aBitrate = record.m4aBitrate;
  }

  if (record.flacCompressionLevel !== undefined) {
    if (
      typeof record.flacCompressionLevel !== "number" ||
      !Number.isInteger(record.flacCompressionLevel) ||
      record.flacCompressionLevel < 0 ||
      record.flacCompressionLevel > 12
    ) {
      throw new SidflowConfigError(
        `Config key "render.flacCompressionLevel" must be an integer between 0 and 12`
      );
    }
    settings.flacCompressionLevel = record.flacCompressionLevel;
  }

  if (record.audioEncoder !== undefined) {
    if (!record.audioEncoder || typeof record.audioEncoder !== "object") {
      throw new SidflowConfigError(
        `Config key "render.audioEncoder" must be an object`
      );
    }

    const encoderRecord = record.audioEncoder as Record<string, unknown>;
    let audioEncoder: AudioEncoderConfig = {};

    if (encoderRecord.implementation !== undefined) {
      if (!isAudioEncoderImplementation(encoderRecord.implementation)) {
        throw new SidflowConfigError(
          `Config key "render.audioEncoder.implementation" must be one of native, wasm, auto`
        );
      }
      audioEncoder = {
        ...audioEncoder,
        implementation: encoderRecord.implementation,
      };
    }

    if (encoderRecord.wasm !== undefined) {
      if (!encoderRecord.wasm || typeof encoderRecord.wasm !== "object") {
        throw new SidflowConfigError(
          `Config key "render.audioEncoder.wasm" must be an object`
        );
      }

      const wasmRecord = encoderRecord.wasm as Record<string, unknown>;
      let wasmOptions: FfmpegWasmOptions = {};

      if (wasmRecord.corePath !== undefined) {
        if (typeof wasmRecord.corePath !== "string" || wasmRecord.corePath.trim() === "") {
          throw new SidflowConfigError(
            `Config key "render.audioEncoder.wasm.corePath" must be a non-empty string`
          );
        }
        wasmOptions = {
          ...wasmOptions,
          corePath: path.normalize(wasmRecord.corePath),
        };
      }

      if (wasmRecord.wasmPath !== undefined) {
        if (typeof wasmRecord.wasmPath !== "string" || wasmRecord.wasmPath.trim() === "") {
          throw new SidflowConfigError(
            `Config key "render.audioEncoder.wasm.wasmPath" must be a non-empty string`
          );
        }
        wasmOptions = {
          ...wasmOptions,
          wasmPath: path.normalize(wasmRecord.wasmPath),
        };
      }

      if (wasmRecord.workerPath !== undefined) {
        if (
          typeof wasmRecord.workerPath !== "string" ||
          wasmRecord.workerPath.trim() === ""
        ) {
          throw new SidflowConfigError(
            `Config key "render.audioEncoder.wasm.workerPath" must be a non-empty string`
          );
        }
        wasmOptions = {
          ...wasmOptions,
          workerPath: path.normalize(wasmRecord.workerPath),
        };
      }

      if (wasmRecord.log !== undefined) {
        if (typeof wasmRecord.log !== "boolean") {
          throw new SidflowConfigError(
            `Config key "render.audioEncoder.wasm.log" must be a boolean`
          );
        }
        wasmOptions = {
          ...wasmOptions,
          log: wasmRecord.log,
        };
      }

      audioEncoder = {
        ...audioEncoder,
        wasm: wasmOptions,
      };
    }

    settings.audioEncoder = audioEncoder;
  }

  if (record.ultimate64 !== undefined) {
    if (!record.ultimate64 || typeof record.ultimate64 !== "object") {
      throw new SidflowConfigError(
        `Config key "render.ultimate64" must be an object`
      );
    }
    const ultimateRecord = record.ultimate64 as Record<string, unknown>;
    const host = ultimateRecord.host;
    if (typeof host !== "string" || host.trim() === "") {
      throw new SidflowConfigError(
        `Config key "render.ultimate64.host" must be a non-empty string`
      );
    }

    const ultimate: Ultimate64RenderConfig = {
      host,
    };

    if (ultimateRecord.https !== undefined) {
      if (typeof ultimateRecord.https !== "boolean") {
        throw new SidflowConfigError(
          `Config key "render.ultimate64.https" must be a boolean`
        );
      }
      ultimate.https = ultimateRecord.https;
    }

    if (ultimateRecord.password !== undefined) {
      if (typeof ultimateRecord.password !== "string") {
        throw new SidflowConfigError(
          `Config key "render.ultimate64.password" must be a string`
        );
      }
      ultimate.password = ultimateRecord.password;
    }

    if (ultimateRecord.audioPort !== undefined) {
      if (
        typeof ultimateRecord.audioPort !== "number" ||
        !Number.isInteger(ultimateRecord.audioPort) ||
        ultimateRecord.audioPort <= 0
      ) {
        throw new SidflowConfigError(
          `Config key "render.ultimate64.audioPort" must be a positive integer`
        );
      }
      ultimate.audioPort = ultimateRecord.audioPort;
    }

    if (ultimateRecord.streamIp !== undefined) {
      if (typeof ultimateRecord.streamIp !== "string" || ultimateRecord.streamIp.trim() === "") {
        throw new SidflowConfigError(
          `Config key "render.ultimate64.streamIp" must be a non-empty string`
        );
      }
      ultimate.streamIp = ultimateRecord.streamIp;
    }

    settings.ultimate64 = ultimate;
  }

  return settings;
}

function isAudioEncoderImplementation(value: unknown): value is AudioEncoderImplementation {
  return value === "native" || value === "wasm" || value === "auto";
}

function parseAvailabilityConfig(value: unknown, configPath: string): AvailabilityConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object") {
    throw new SidflowConfigError(
      `Config key "availability" must be an object in ${configPath}`
    );
  }

  const record = value as Record<string, unknown>;
  const config: AvailabilityConfig = {};

  if (record.manifestPath !== undefined) {
    if (typeof record.manifestPath !== "string" || record.manifestPath.trim() === "") {
      throw new SidflowConfigError(
        `Config key "availability.manifestPath" must be a non-empty string`
      );
    }
    config.manifestPath = path.normalize(record.manifestPath);
  }

  if (record.assetRoot !== undefined) {
    if (typeof record.assetRoot !== "string" || record.assetRoot.trim() === "") {
      throw new SidflowConfigError(
        `Config key "availability.assetRoot" must be a non-empty string`
      );
    }
    config.assetRoot = path.normalize(record.assetRoot);
  }

  if (record.publicBaseUrl !== undefined) {
    if (typeof record.publicBaseUrl !== "string" || record.publicBaseUrl.trim() === "") {
      throw new SidflowConfigError(
        `Config key "availability.publicBaseUrl" must be a non-empty string`
      );
    }
    config.publicBaseUrl = record.publicBaseUrl;
  }

  return config;
}

function parseAlertConfig(value: unknown, configPath: string): AlertConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== "object") {
    throw new SidflowConfigError(
      `Config key "alerts" must be an object in ${configPath}`
    );
  }

  const record = value as Record<string, unknown>;
  const config: AlertConfig = {};

  if (record.enabled !== undefined) {
    if (typeof record.enabled !== "boolean") {
      throw new SidflowConfigError(
        `Config key "alerts.enabled" must be a boolean`
      );
    }
    config.enabled = record.enabled;
  }

  if (record.webhookUrl !== undefined) {
    if (typeof record.webhookUrl !== "string" || record.webhookUrl.trim() === "") {
      throw new SidflowConfigError(
        `Config key "alerts.webhookUrl" must be a non-empty string`
      );
    }
    config.webhookUrl = record.webhookUrl;
  }

  if (record.emailRecipients !== undefined) {
    if (!Array.isArray(record.emailRecipients)) {
      throw new SidflowConfigError(
        `Config key "alerts.emailRecipients" must be an array`
      );
    }
    for (const email of record.emailRecipients) {
      if (typeof email !== "string" || email.trim() === "") {
        throw new SidflowConfigError(
          `Config key "alerts.emailRecipients" must contain non-empty strings`
        );
      }
    }
    config.emailRecipients = record.emailRecipients as string[];
  }

  if (record.thresholds !== undefined) {
    if (!record.thresholds || typeof record.thresholds !== "object") {
      throw new SidflowConfigError(
        `Config key "alerts.thresholds" must be an object`
      );
    }

    const thresholds = record.thresholds as Record<string, unknown>;
    const parsed: AlertThresholds = {};

    if (thresholds.maxSessionFailureRate !== undefined) {
      if (
        typeof thresholds.maxSessionFailureRate !== "number" ||
        thresholds.maxSessionFailureRate < 0 ||
        thresholds.maxSessionFailureRate > 1
      ) {
        throw new SidflowConfigError(
          `Config key "alerts.thresholds.maxSessionFailureRate" must be between 0 and 1`
        );
      }
      parsed.maxSessionFailureRate = thresholds.maxSessionFailureRate;
    }

    if (thresholds.maxCacheAgeMs !== undefined) {
      if (typeof thresholds.maxCacheAgeMs !== "number" || thresholds.maxCacheAgeMs <= 0) {
        throw new SidflowConfigError(
          `Config key "alerts.thresholds.maxCacheAgeMs" must be a positive number`
        );
      }
      parsed.maxCacheAgeMs = thresholds.maxCacheAgeMs;
    }

    if (thresholds.maxJobStallMs !== undefined) {
      if (typeof thresholds.maxJobStallMs !== "number" || thresholds.maxJobStallMs <= 0) {
        throw new SidflowConfigError(
          `Config key "alerts.thresholds.maxJobStallMs" must be a positive number`
        );
      }
      parsed.maxJobStallMs = thresholds.maxJobStallMs;
    }

    if (thresholds.maxCpuPercent !== undefined) {
      if (
        typeof thresholds.maxCpuPercent !== "number" ||
        thresholds.maxCpuPercent <= 0 ||
        thresholds.maxCpuPercent > 100
      ) {
        throw new SidflowConfigError(
          `Config key "alerts.thresholds.maxCpuPercent" must be between 0 and 100`
        );
      }
      parsed.maxCpuPercent = thresholds.maxCpuPercent;
    }

    if (thresholds.maxMemoryPercent !== undefined) {
      if (
        typeof thresholds.maxMemoryPercent !== "number" ||
        thresholds.maxMemoryPercent <= 0 ||
        thresholds.maxMemoryPercent > 100
      ) {
        throw new SidflowConfigError(
          `Config key "alerts.thresholds.maxMemoryPercent" must be between 0 and 100`
        );
      }
      parsed.maxMemoryPercent = thresholds.maxMemoryPercent;
    }

    config.thresholds = parsed;
  }

  return config;
}
