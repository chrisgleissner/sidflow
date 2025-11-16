/// <reference types="bun-types" />

import path from "node:path";

import { describe, expect, it } from "bun:test";

import {
  parseRenderArgs,
  resolveEngineOrder,
  resolveFormats,
  resolveAudioEncoderOptions,
} from "../src/render/cli.js";
import type { SidflowConfig } from "@sidflow/common";

describe("render CLI argument parsing", () => {
  it("parses engine, format, and SID flags", () => {
    const { options, errors, helpRequested } = parseRenderArgs([
      "--engine",
      "wasm",
      "--formats",
      "wav,m4a",
      "--target-duration",
      "90",
      "--sid",
      "Rob_Hubbard/Delta.sid#2",
    ]);

    expect(errors).toHaveLength(0);
    expect(helpRequested).toBe(false);
    expect(options.engine).toBe("wasm");
    expect(options.formats).toEqual(["wav", "m4a"]);
    expect(options.targetDurationSeconds).toBe(90);
    expect(options.sidSpecs).toEqual(["Rob_Hubbard/Delta.sid#2"]);
  });

  it("parses encoder and ffmpeg.wasm overrides", () => {
    const { options, errors } = parseRenderArgs([
      "--encoder",
      "wasm",
      "--ffmpeg-wasm-core",
      "./vendor/ffmpeg-core.js",
      "--ffmpeg-wasm-wasm",
      "./vendor/ffmpeg-core.wasm",
      "--ffmpeg-wasm-worker",
      "./vendor/ffmpeg-core.worker.js",
      "--ffmpeg-wasm-log",
      "true",
      "--sid",
      "Test.sid",
    ]);

    expect(errors).toHaveLength(0);
    expect(options.encoderImplementation).toBe("wasm");
    expect(options.ffmpegWasmCorePath).toBe("./vendor/ffmpeg-core.js");
    expect(options.ffmpegWasmBinaryPath).toBe("./vendor/ffmpeg-core.wasm");
    expect(options.ffmpegWasmWorkerPath).toBe("./vendor/ffmpeg-core.worker.js");
    expect(options.ffmpegWasmLog).toBe(true);
  });
});

describe("render CLI helpers", () => {
  const baseConfig: SidflowConfig = {
    sidPath: "/hvsc",
    wavCachePath: "/cache",
    tagsPath: "/tags",
    threads: 1,
    classificationDepth: 1,
    render: {
      defaultFormats: ["wav", "flac"],
      preferredEngines: ["sidplayfp-cli", "ultimate64"],
    } as any,
  } as SidflowConfig;

  it("prefers user provided format overrides", () => {
    const formats = resolveFormats(
      { formats: ["m4a"] } as any,
      baseConfig
    );
    expect(formats).toEqual(["m4a"]);
  });

  it("falls back to config default formats", () => {
    const formats = resolveFormats({} as any, baseConfig);
    expect(formats).toEqual(["wav", "flac"]);
  });

  it("deduplicates engine order and appends wasm fallback", () => {
    const order = resolveEngineOrder(
      {
        engine: "sidplayfp-cli",
        preferredEngines: ["ultimate64"],
      } as any,
      baseConfig
    );
    expect(order).toEqual(["sidplayfp-cli", "ultimate64", "wasm"]);
  });
});

describe("resolveAudioEncoderOptions", () => {
  const baseConfig: SidflowConfig = {
    sidPath: "/hvsc",
    wavCachePath: "/cache",
    tagsPath: "/tags",
    threads: 1,
    classificationDepth: 1,
    render: {
      audioEncoder: {
        implementation: "native",
        wasm: {
          corePath: "/opt/ffmpeg-core.js",
        },
      },
    },
  } as SidflowConfig;

  it("returns undefined when no config or CLI overrides exist", () => {
    const resolved = resolveAudioEncoderOptions({} as any, {
      ...baseConfig,
      render: undefined,
    });
    expect(resolved).toBeUndefined();
  });

  it("uses config defaults when no CLI overrides are provided", () => {
    const resolved = resolveAudioEncoderOptions({} as any, baseConfig);
    expect(resolved).toEqual({
      implementation: "native",
      wasm: {
        corePath: "/opt/ffmpeg-core.js",
      },
    });
  });

  it("prefers CLI overrides and resolves wasm paths", () => {
    const resolved = resolveAudioEncoderOptions(
      {
        encoderImplementation: "wasm",
        ffmpegWasmCorePath: "./custom/core.js",
        ffmpegWasmBinaryPath: "./custom/core.wasm",
        ffmpegWasmWorkerPath: "./custom/core.worker.js",
        ffmpegWasmLog: false,
      } as any,
      baseConfig
    );

    expect(resolved).toEqual({
      implementation: "wasm",
      wasm: {
        corePath: path.resolve("./custom/core.js"),
        wasmPath: path.resolve("./custom/core.wasm"),
        workerPath: path.resolve("./custom/core.worker.js"),
        log: false,
      },
    });
  });
});
