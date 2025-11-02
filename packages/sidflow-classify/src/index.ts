import { ensureDir, loadConfig, pathExists, stringifyDeterministic, type SidflowConfig } from "@sidflow/common";
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface ClassifyOptions {
  configPath?: string;
  forceRebuild?: boolean;
}

export interface ClassificationPlan {
  config: SidflowConfig;
  wavCachePath: string;
  tagsPath: string;
  forceRebuild: boolean;
  classificationDepth: number;
  hvscPath: string;
  sidplayPath: string;
}

export async function planClassification(
  options: ClassifyOptions = {}
): Promise<ClassificationPlan> {
  const config = await loadConfig(options.configPath);
  void stringifyDeterministic({});
  return {
    config,
    wavCachePath: config.wavCachePath,
    tagsPath: config.tagsPath,
    forceRebuild: options.forceRebuild ?? false,
    classificationDepth: config.classificationDepth,
    hvscPath: config.hvscPath,
    sidplayPath: config.sidplayPath
  };
}

const SID_EXTENSION = ".sid";

export function resolveWavPath(plan: ClassificationPlan, sidFile: string): string {
  const relative = path.relative(plan.hvscPath, sidFile);
  if (relative.startsWith("..")) {
    throw new Error(`SID file ${sidFile} is not within HVSC path ${plan.hvscPath}`);
  }

  const directory = path.dirname(relative);
  const baseName = path.basename(relative, path.extname(relative));
  const wavName = `${baseName}.wav`;
  return path.join(plan.wavCachePath, directory, wavName);
}

export async function collectSidFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

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
      if (entry.name.toLowerCase().endsWith(SID_EXTENSION)) {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

export async function needsWavRefresh(
  sidFile: string,
  wavFile: string,
  forceRebuild: boolean
): Promise<boolean> {
  if (forceRebuild) {
    return true;
  }

  if (!(await pathExists(wavFile))) {
    return true;
  }

  const [sidStats, wavStats] = await Promise.all([stat(sidFile), stat(wavFile)]);
  return sidStats.mtimeMs > wavStats.mtimeMs;
}

export interface RenderWavOptions {
  sidFile: string;
  wavFile: string;
  sidplayPath: string;
}

export type RenderWav = (options: RenderWavOptions) => Promise<void>;

export const defaultRenderWav: RenderWav = async ({ sidFile, wavFile, sidplayPath }) => {
  await ensureDir(path.dirname(wavFile));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(sidplayPath, ["-w", wavFile, sidFile], {
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`sidplayfp exited with code ${code}`));
      }
    });
  });
};

export interface BuildWavCacheOptions {
  sidplayPath?: string;
  render?: RenderWav;
  forceRebuild?: boolean;
}

export interface BuildWavCacheResult {
  rendered: string[];
  skipped: string[];
}

export async function buildWavCache(
  plan: ClassificationPlan,
  options: BuildWavCacheOptions = {}
): Promise<BuildWavCacheResult> {
  const sidFiles = await collectSidFiles(plan.hvscPath);
  const rendered: string[] = [];
  const skipped: string[] = [];
  const sidplayPath = options.sidplayPath ?? plan.sidplayPath;
  const render = options.render ?? defaultRenderWav;
  const shouldForce = options.forceRebuild ?? plan.forceRebuild;

  for (const sidFile of sidFiles) {
    const wavFile = resolveWavPath(plan, sidFile);
    if (!(await needsWavRefresh(sidFile, wavFile, shouldForce))) {
      skipped.push(wavFile);
      continue;
    }

    await render({ sidFile, wavFile, sidplayPath });
    rendered.push(wavFile);
  }

  return { rendered, skipped };
}
