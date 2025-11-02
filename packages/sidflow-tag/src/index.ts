import {
  createLogger,
  ensureDir,
  clampRating,
  DEFAULT_RATINGS,
  loadConfig,
  pathExists,
  resolveManualTagPath,
  stringifyDeterministic,
  type TagRatings,
  type JsonValue,
  type SidflowConfig
} from "@sidflow/common";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface KeyState {
  ratings: TagRatings;
  pendingDimension?: keyof TagRatings;
}

export type KeyAction = "none" | "save" | "quit";

export interface TagCliOptions {
  configPath?: string;
  random?: boolean;
}

export interface TagSessionPlan {
  config: SidflowConfig;
  random: boolean;
  sidplayPath: string;
  tagsPath: string;
  hvscPath: string;
}

export async function planTagSession(
  options: TagCliOptions = {}
): Promise<TagSessionPlan> {
  const config = await loadConfig(options.configPath);
  const logger = createLogger("sidflow-tag");
  logger.debug("Loaded configuration for tagging session");

  return {
    config,
    random: options.random ?? false,
    sidplayPath: config.sidplayPath,
    tagsPath: config.tagsPath,
    hvscPath: config.hvscPath
  };
}

export function createTagFilePath(hvscPath: string, tagsPath: string, sidFile: string): string {
  return resolveManualTagPath(hvscPath, tagsPath, sidFile);
}

export async function ensureDirectory(filePath: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
}

export async function tagFileExists(tagFilePath: string): Promise<boolean> {
  return pathExists(tagFilePath);
}

export function interpretKey(key: string, state: KeyState): { state: KeyState; action: KeyAction } {
  if (key === "q" || key === "Q") {
    return { state, action: "quit" };
  }

  if (key === "\r" || key === "\n") {
    return { state, action: "save" };
  }

  if (key === "s" || key === "m" || key === "c") {
    return { state: { ...state, pendingDimension: key as keyof TagRatings }, action: "none" };
  }

  if (state.pendingDimension && key >= "1" && key <= "5") {
    const dimension = state.pendingDimension;
    const value = clampRating(Number.parseInt(key, 10));
    return {
      state: {
        ratings: { ...state.ratings, [dimension]: value },
        pendingDimension: undefined
      },
      action: "none"
    };
  }

  return { state: { ...state, pendingDimension: undefined }, action: "none" };
}

export async function writeManualTag(
  tagFilePath: string,
  ratings: TagRatings,
  timestamp: Date
): Promise<void> {
  const record: Record<string, JsonValue> = {
    s: ratings.s,
    m: ratings.m,
    c: ratings.c,
    source: "manual",
    timestamp: timestamp.toISOString()
  };
  await ensureDirectory(tagFilePath);
  await writeFile(tagFilePath, stringifyDeterministic(record));
}

export async function findUntaggedSids(hvscPath: string, tagsPath: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!fullPath.toLowerCase().endsWith(".sid")) {
        continue;
      }
      const tagPath = resolveManualTagPath(hvscPath, tagsPath, fullPath);
      if (!(await tagFileExists(tagPath))) {
        results.push(fullPath);
      }
    }
  }

  const rootStats = await stat(hvscPath);
  if (!rootStats.isDirectory()) {
    return results;
  }

  await walk(hvscPath);
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

export function shuffleInPlace(values: string[], random: () => number = Math.random): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

export { DEFAULT_RATINGS, clampRating, type TagRatings } from "@sidflow/common";
