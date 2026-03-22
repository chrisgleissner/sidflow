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

  it("returns cached result on second call", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    const first = await loadConfig(configPath);
    const second = await loadConfig(configPath);
    expect(second.sidPath).toBe(first.sidPath);
  });

  it("throws SidflowConfigError for null config", async () => {
    await writeFile(configPath, "null", "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when required number field is non-number", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: "three",
      classificationDepth: 4,
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for invalid optional string field (empty classifiedPath)", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      classifiedPath: "",
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for optional number field with wrong type", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      maxRenderSec: "sixty",
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for optional number field failing validation", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      maxRenderSec: -1,
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("overrides sidPath when SIDFLOW_SID_BASE_PATH env var is set", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    const originalEnv = process.env.SIDFLOW_SID_BASE_PATH;
    try {
      process.env.SIDFLOW_SID_BASE_PATH = "/custom/sid/path";
      const config = await loadConfig(configPath);
      expect(config.sidPath).toBe(path.normalize("/custom/sid/path"));
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SIDFLOW_SID_BASE_PATH;
      } else {
        process.env.SIDFLOW_SID_BASE_PATH = originalEnv;
      }
    }
  });

  it("accepts valid optional number fields (analysisSampleRate)", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      analysisSampleRate: 44100,
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    const config = await loadConfig(configPath);
    expect(config.analysisSampleRate).toBe(44100);
  });

  it("throws SidflowConfigError for analysisSampleRate out of range", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      analysisSampleRate: 999999,
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when render is not an object", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: null,
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for empty render.outputPath", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { outputPath: "" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.defaultFormats non-array", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { defaultFormats: "wav" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.defaultFormats with invalid format", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { defaultFormats: ["wav", "opus"] },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.preferredEngines non-array", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { preferredEngines: "wasm" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.defaultChip invalid value", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { defaultChip: "7890" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.m4aBitrate non-positive", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { m4aBitrate: 0 },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.flacCompressionLevel out of range", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { flacCompressionLevel: 13 },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when render.audioEncoder is not an object", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { audioEncoder: null },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.audioEncoder.implementation invalid value", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { audioEncoder: { implementation: "native2" } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when render.audioEncoder.wasm is not an object", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { audioEncoder: { wasm: "path/to/lib" } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for empty render.audioEncoder.wasm.corePath", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { audioEncoder: { wasm: { corePath: "" } } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for empty render.audioEncoder.wasm.wasmPath", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { audioEncoder: { wasm: { wasmPath: "" } } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for empty render.audioEncoder.wasm.workerPath", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { audioEncoder: { wasm: { workerPath: "" } } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.audioEncoder.wasm.log non-boolean", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { audioEncoder: { wasm: { log: "yes" } } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when render.ultimate64 is not an object", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { ultimate64: "127.0.0.1" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.ultimate64.https non-boolean", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { ultimate64: { host: "127.0.0.1", https: "yes" } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.ultimate64.password non-string", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { ultimate64: { host: "127.0.0.1", password: 12345 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.ultimate64.audioPort invalid", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { ultimate64: { host: "127.0.0.1", audioPort: -1 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for render.ultimate64.streamIp empty", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      render: { ultimate64: { host: "127.0.0.1", streamIp: "" } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when availability is not an object", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      availability: null,
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for empty availability.manifestPath", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      availability: { manifestPath: "" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for empty availability.assetRoot", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      availability: { assetRoot: "" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError for empty availability.publicBaseUrl", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      availability: { publicBaseUrl: "" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("accepts valid availability config", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      availability: {
        manifestPath: "./data/availability.json",
        assetRoot: "./data/assets",
        publicBaseUrl: "https://example.com",
      },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    const config = await loadConfig(configPath);
    expect(config.availability?.publicBaseUrl).toBe("https://example.com");
    expect(config.availability?.manifestPath).toBeDefined();
    expect(config.availability?.assetRoot).toBeDefined();
  });

  // --- parseAlertConfig tests ---

  it("accepts valid alerts config", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: {
        enabled: true,
        webhookUrl: "https://example.com/hook",
        emailRecipients: ["admin@example.com"],
        thresholds: {
          maxSessionFailureRate: 0.5,
          maxCacheAgeMs: 3600000,
          maxJobStallMs: 120000,
          maxCpuPercent: 90,
          maxMemoryPercent: 80,
        },
      },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    const config = await loadConfig(configPath);
    expect(config.alerts?.enabled).toBe(true);
    expect(config.alerts?.webhookUrl).toBe("https://example.com/hook");
    expect(config.alerts?.emailRecipients).toContain("admin@example.com");
    expect(config.alerts?.thresholds?.maxCpuPercent).toBe(90);
  });

  it("throws SidflowConfigError when alerts is not an object", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: "invalid",
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when alerts.enabled is not a boolean", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { enabled: "yes" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when alerts.webhookUrl is empty", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { webhookUrl: "" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when alerts.webhookUrl is not a string", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { webhookUrl: 42 },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when alerts.emailRecipients is not an array", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { emailRecipients: "admin@example.com" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when alerts.emailRecipients contains empty string", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { emailRecipients: ["valid@example.com", ""] },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when alerts.thresholds is not an object", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { thresholds: "high" },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when maxSessionFailureRate is out of range", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { thresholds: { maxSessionFailureRate: 1.5 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when maxCacheAgeMs is non-positive", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { thresholds: { maxCacheAgeMs: 0 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when maxJobStallMs is non-positive", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { thresholds: { maxJobStallMs: -100 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when maxCpuPercent is out of range", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { thresholds: { maxCpuPercent: 110 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when maxCpuPercent is 0", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { thresholds: { maxCpuPercent: 0 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when maxMemoryPercent is out of range", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { thresholds: { maxMemoryPercent: 120 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });

  it("throws SidflowConfigError when maxMemoryPercent is 0", async () => {
    const payload = {
      sidPath: "./hvsc",
      audioCachePath: "./wav",
      tagsPath: "./tags",
      threads: 1,
      classificationDepth: 4,
      alerts: { thresholds: { maxMemoryPercent: 0 } },
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");
    await expect(loadConfig(configPath)).rejects.toBeInstanceOf(SidflowConfigError);
  });
});
