/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test";

import {
  parseRenderArgs,
  resolveEngineOrder,
  resolveFormats,
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
});

describe("render CLI helpers", () => {
  const baseConfig: SidflowConfig = {
    hvscPath: "/hvsc",
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
