import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export interface SidflowConfig {
  hvscPath: string;
  wavCachePath: string;
  tagsPath: string;
  classifiedPath?: string;
  sidplayPath?: string;
  threads: number;
  classificationDepth: number;
}

export const DEFAULT_CONFIG_FILENAME = ".sidflow.json";

let cachedConfig: SidflowConfig | null = null;
let cachedPath: string | null = null;
let sidplayWarningEmitted = false;

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
}

export async function loadConfig(configPath?: string): Promise<SidflowConfig> {
  const resolvedPath = path.resolve(configPath ?? getDefaultConfigPath());

  if (cachedConfig && cachedPath === resolvedPath) {
    return cachedConfig;
  }

  let fileContents: string;
  try {
    fileContents = await readFile(resolvedPath, "utf8");
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
    config.hvscPath = path.normalize(overrideSidBase);
  }
  if (config.sidplayPath && !sidplayWarningEmitted) {
    sidplayWarningEmitted = true;
    process.stderr.write(
      "[sidflow] Config key \"sidplayPath\" is deprecated. The WASM renderer is now used by default; remove this key once native fallbacks are retired.\n"
    );
  }
  cachedConfig = config;
  cachedPath = resolvedPath;
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

  return {
    hvscPath: requiredString("hvscPath"),
    wavCachePath: requiredString("wavCachePath"),
    tagsPath: requiredString("tagsPath"),
    classifiedPath: optionalString("classifiedPath"),
    sidplayPath: optionalString("sidplayPath"),
    threads: requiredNumber("threads", (n) => Number.isInteger(n) && n >= 0),
    classificationDepth: requiredNumber("classificationDepth", (n) => Number.isInteger(n) && n > 0)
  };
}
