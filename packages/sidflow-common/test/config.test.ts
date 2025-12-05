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
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 0,
      classificationDepth: 3,
      render: {
        outputPath: "./renders",
        defaultFormats: ["wav", "m4a"],
        preferredEngines: ["wasm", "sidplayfp-cli"],
        defaultChip: "8580r5",
        ultimate64: {
          host: "127.0.0.1:11080",
          https: true,
          password: "secret",
          audioPort: 11002,
          streamIp: "10.0.0.5"
        }
      }
    };

    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const config = await loadConfig(configPath);
    expect(config.sidPath).toBe(path.normalize(payload.sidPath));
    expect(config.audioCachePath).toBe(path.normalize(payload.audioCachePath));
    expect(config.tagsPath).toBe(path.normalize(payload.tagsPath));
    expect(config.sidplayPath).toBe(path.normalize(payload.sidplayPath));
    expect(config.threads).toBe(payload.threads);
    expect(config.classificationDepth).toBe(payload.classificationDepth);
    expect(config.render).toBeDefined();
    expect(config.render?.outputPath).toBe(path.normalize(payload.render!.outputPath!));
    expect(config.render?.defaultFormats).toEqual(["wav", "m4a"]);
    expect(config.render?.preferredEngines).toEqual(["wasm", "sidplayfp-cli"]);
    expect(config.render?.defaultChip).toBe("8580"); // normalized from "8580r5"
    expect(config.render?.ultimate64).toEqual(payload.render!.ultimate64);

    // Should return cached config
    const cached = getCachedConfig();
    expect(cached).toBe(config);
  });

  it("treats sidplayPath and render as optional", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4
    };

    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const config = await loadConfig(configPath);
    expect(config.sidPath).toBe(path.normalize(payload.sidPath));
    expect(config.sidplayPath).toBeUndefined();
    expect(config.render).toBeUndefined();
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
      sidPath: "",
      audioCachePath: "./wav",
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
      sidPath: "./hvsc",
      audioCachePath: "./wav",
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
      sidPath: "./hvsc",
      audioCachePath: "./wav",
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
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 0,
      classificationDepth: 0
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("validates render settings - empty defaultFormats", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: {
        defaultFormats: [],
      }
    };

    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("validates render settings - invalid preferredEngines", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: {
        preferredEngines: ["invalid"],
      }
    };

    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("validates render settings - missing ultimate64 host", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: {
        ultimate64: {}
      }
    };

    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });
});
