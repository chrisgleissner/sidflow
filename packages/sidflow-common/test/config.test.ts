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

  it("treats sidplayPath as optional", async () => {
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4
    };

    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const config = await loadConfig(configPath);
    expect(config.hvscPath).toBe(path.normalize(payload.hvscPath));
    expect(config.sidplayPath).toBeUndefined();
  });

  it("throws SidflowConfigError for malformed config", async () => {
    await writeFile(configPath, "{}", "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws when getCachedConfig is called before loadConfig", () => {
    expect(() => getCachedConfig()).toThrow(SidflowConfigError);
  });

  it("throws SidflowConfigError for non-existent config file", async () => {
    const nonExistentPath = path.join(tempDir, "non-existent.json");
    await expect(loadConfig(nonExistentPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for invalid JSON", async () => {
    await writeFile(configPath, "not valid json{", "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for non-object config", async () => {
    await writeFile(configPath, "[]", "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for missing required string fields", async () => {
    const payload = {
      hvscPath: "",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 0,
      classificationDepth: 3
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for invalid threads value", async () => {
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: -1,
      classificationDepth: 3
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for non-integer threads", async () => {
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 1.5,
      classificationDepth: 3
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for invalid classificationDepth value", async () => {
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 0,
      classificationDepth: 0
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });
});
