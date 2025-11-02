import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";

import {
  loadConfig,
  resetConfigCache,
  getCachedConfig,
  SidflowConfigError
} from "@sidflow/common";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-config-");

describe("config", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(TEMP_PREFIX);
    configPath = path.join(tempDir, ".sidflow.json");
    resetConfigCache();
  });

  afterEach(async () => {
    resetConfigCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads and caches config", async () => {
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 0,
      classificationDepth: 3
    };

    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const config = await loadConfig(configPath);
    expect(config).toEqual({
      ...payload,
      hvscPath: path.normalize(payload.hvscPath),
      wavCachePath: path.normalize(payload.wavCachePath),
      tagsPath: path.normalize(payload.tagsPath),
      sidplayPath: path.normalize(payload.sidplayPath)
    });

    // Should return cached config
    const cached = getCachedConfig();
    expect(cached).toBe(config);
  });

  it("throws SidflowConfigError for malformed config", async () => {
    await writeFile(configPath, "{}", "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws when getCachedConfig is called before loadConfig", () => {
    expect(() => getCachedConfig()).toThrow(SidflowConfigError);
  });
});
