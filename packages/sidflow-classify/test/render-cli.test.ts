/// <reference types="bun-types" />

import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
  parseRenderArgs,
  resolveEngineOrder,
  resolveFormats,
  resolveAudioEncoderOptions,
  parseSidSpec,
  loadSidListFile,
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
    audioCachePath: "/cache",
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
    audioCachePath: "/cache",
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

describe("parseRenderArgs — error paths", () => {
  it("records error when flag is missing its value", () => {
    const { errors } = parseRenderArgs(["--engine"]);
    expect(errors).toContain("--engine requires a value");
  });

  it("records error when two flags are adjacent (looks like missing value)", () => {
    const { errors } = parseRenderArgs(["--engine", "--formats", "wav"]);
    expect(errors).toContain("--engine requires a value");
  });

  it("records error for unsupported engine", () => {
    const { errors } = parseRenderArgs(["--engine", "nonexistent", "--sid", "x.sid"]);
    expect(errors).toContain("Unsupported engine: nonexistent");
  });

  it("accepts auto as engine", () => {
    const { options, errors } = parseRenderArgs(["--engine", "auto", "--sid", "x.sid"]);
    expect(errors).toHaveLength(0);
    expect(options.engine).toBe("auto");
  });

  it("records error for unsupported encoder", () => {
    const { errors } = parseRenderArgs(["--encoder", "ffmpeg9000"]);
    expect(errors).toContain("Unsupported encoder implementation: ffmpeg9000");
  });

  it("records error for unsupported format in --formats", () => {
    const { errors } = parseRenderArgs(["--formats", "wav,xyz"]);
    expect(errors).toContain("Unsupported format: xyz");
  });

  it("records error for invalid --chip value", () => {
    const { errors } = parseRenderArgs(["--chip", "9999"]);
    expect(errors).toContain("--chip must be 6581 or 8580r5");
  });

  it("accepts valid --chip values", () => {
    const { options: o1, errors: e1 } = parseRenderArgs(["--chip", "6581"]);
    expect(e1).toHaveLength(0);
    expect(o1.chip).toBe("6581");

    const { options: o2, errors: e2 } = parseRenderArgs(["--chip", "8580r5"]);
    expect(e2).toHaveLength(0);
    expect(o2.chip).toBe("8580r5");
  });

  it("records error for non-numeric --target-duration", () => {
    const { errors } = parseRenderArgs(["--target-duration", "abc"]);
    expect(errors).toContain("--target-duration must be a positive number of seconds");
  });

  it("records error for zero --target-duration", () => {
    const { errors } = parseRenderArgs(["--target-duration", "0"]);
    expect(errors).toContain("--target-duration must be a positive number of seconds");
  });

  it("records error for --max-loss outside [0,1)", () => {
    const { errors: e1 } = parseRenderArgs(["--max-loss", "1.5"]);
    expect(e1).toContain("--max-loss must be between 0 and 1 (exclusive)");

    const { errors: e2 } = parseRenderArgs(["--max-loss", "-0.1"]);
    expect(e2).toContain("--max-loss must be between 0 and 1 (exclusive)");
  });

  it("accepts valid --max-loss of 0", () => {
    const { options, errors } = parseRenderArgs(["--max-loss", "0"]);
    expect(errors).toHaveLength(0);
    expect(options.maxLossRate).toBe(0);
  });

  it("records error for unknown flag", () => {
    const { errors } = parseRenderArgs(["--unknown-flag"]);
    expect(errors).toContain("Unknown option: --unknown-flag");
  });

  it("records error for unsupported engine in --prefer", () => {
    const { errors } = parseRenderArgs(["--prefer", "wasm,badengine"]);
    expect(errors).toContain("Unsupported engine in --prefer: badengine");
  });

  it("accepts valid --prefer list", () => {
    const { options, errors } = parseRenderArgs(["--prefer", "wasm,sidplayfp-cli"]);
    expect(errors).toHaveLength(0);
    expect(options.preferredEngines).toEqual(["wasm", "sidplayfp-cli"]);
  });

  it("records error for invalid --ffmpeg-wasm-log value", () => {
    const { errors } = parseRenderArgs(["--ffmpeg-wasm-log", "maybe"]);
    expect(errors).toContain("--ffmpeg-wasm-log must be true or false");
  });

  it("accepts --ffmpeg-wasm-log true and false", () => {
    const { options: o1, errors: e1 } = parseRenderArgs(["--ffmpeg-wasm-log", "true"]);
    expect(e1).toHaveLength(0);
    expect(o1.ffmpegWasmLog).toBe(true);

    const { options: o2, errors: e2 } = parseRenderArgs(["--ffmpeg-wasm-log", "false"]);
    expect(e2).toHaveLength(0);
    expect(o2.ffmpegWasmLog).toBe(false);
  });

  it("--help sets helpRequested flag", () => {
    const { helpRequested } = parseRenderArgs(["--help"]);
    expect(helpRequested).toBe(true);
  });

  it("positional args are treated as sid specs", () => {
    const { options, errors } = parseRenderArgs(["some/track.sid"]);
    expect(errors).toHaveLength(0);
    expect(options.sidSpecs).toContain("some/track.sid");
  });

  it("--config sets configPath", () => {
    const { options, errors } = parseRenderArgs(["--config", "/path/to/.sidflow.json"]);
    expect(errors).toHaveLength(0);
    expect(options.configPath).toBe("/path/to/.sidflow.json");
  });

  it("--output sets outputPath", () => {
    const { options, errors } = parseRenderArgs(["--output", "/out/dir"]);
    expect(errors).toHaveLength(0);
    expect(options.outputPath).toBe("/out/dir");
  });

  it("--sid-file appends to sidListFiles", () => {
    const { options, errors } = parseRenderArgs(["--sid-file", "sids.txt"]);
    expect(errors).toHaveLength(0);
    expect(options.sidListFiles).toContain("sids.txt");
  });
});

describe("parseSidSpec", () => {
  it("returns null for empty string", () => {
    expect(parseSidSpec("")).toBeNull();
    expect(parseSidSpec("   ")).toBeNull();
  });

  it("parses a plain path", () => {
    const spec = parseSidSpec("Rob_Hubbard/Delta.sid");
    expect(spec).toEqual({ path: "Rob_Hubbard/Delta.sid" });
  });

  it("parses path with valid song index", () => {
    const spec = parseSidSpec("Martin_Galway/Cobra.sid#3");
    expect(spec).toEqual({ path: "Martin_Galway/Cobra.sid", songIndex: 3 });
  });

  it("ignores non-numeric song index", () => {
    const spec = parseSidSpec("track.sid#abc");
    expect(spec?.path).toBe("track.sid");
    expect(spec?.songIndex).toBeUndefined();
  });

  it("ignores zero song index", () => {
    const spec = parseSidSpec("track.sid#0");
    expect(spec?.path).toBe("track.sid");
    expect(spec?.songIndex).toBeUndefined();
  });
});

describe("loadSidListFile", () => {
  async function makeTmpDir(): Promise<string> {
    const dir = path.join(tmpdir(), `render-cli-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  it("returns empty array when file does not exist", async () => {
    const specs = await loadSidListFile("/nonexistent/path/sids.txt");
    expect(specs).toEqual([]);
  });

  it("parses plain-text file with paths", async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, "sids.txt");
    await writeFile(file, "Rob_Hubbard/Delta.sid\n# comment\n\nMartin_Galway/Cobra.sid#2\n");
    const specs = await loadSidListFile(file);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual({ path: "Rob_Hubbard/Delta.sid" });
    expect(specs[1]).toEqual({ path: "Martin_Galway/Cobra.sid", songIndex: 2 });
  });

  it("parses JSONL file with sid_path keys", async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, "sids.jsonl");
    const lines = [
      JSON.stringify({ sid_path: "Track_A/song.sid", song_index: 1 }),
      JSON.stringify({ sid_path: "Track_B/song.sid" }),
      "",
    ].join("\n");
    await writeFile(file, lines);
    const specs = await loadSidListFile(file);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual({ path: "Track_A/song.sid", songIndex: 1 });
    expect(specs[1]).toEqual({ path: "Track_B/song.sid" });
  });

  it("skips JSONL lines missing sid_path", async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, "sids.jsonl");
    await writeFile(file, JSON.stringify({ title: "no path here" }) + "\n");
    const specs = await loadSidListFile(file);
    expect(specs).toEqual([]);
  });

  it("skips malformed JSON lines in JSONL file", async () => {
    const dir = await makeTmpDir();
    const file = path.join(dir, "sids.jsonl");
    await writeFile(file, "not-json\n" + JSON.stringify({ sid_path: "good.sid" }) + "\n");
    const specs = await loadSidListFile(file);
    expect(specs).toHaveLength(1);
    expect(specs[0]?.path).toBe("good.sid");
  });
});

describe("resolveEngineOrder — edge cases", () => {
  const cfg: SidflowConfig = {
    sidPath: "/hvsc",
    audioCachePath: "/cache",
    tagsPath: "/tags",
    threads: 1,
    classificationDepth: 1,
    render: {
      preferredEngines: [],
    } as any,
  } as SidflowConfig;

  it("returns wasm fallback when no engines configured", () => {
    const order = resolveEngineOrder({} as any, cfg);
    expect(order).toContain("wasm");
  });

  it("does not duplicate wasm when already in list", () => {
    const order = resolveEngineOrder({ engine: "wasm" } as any, cfg);
    const wasmCount = order.filter((e) => e === "wasm").length;
    expect(wasmCount).toBe(1);
  });
});

describe("resolveFormats — unsupported format", () => {
  const cfg: SidflowConfig = {
    sidPath: "/hvsc",
    audioCachePath: "/cache",
    tagsPath: "/tags",
    threads: 1,
    classificationDepth: 1,
  } as SidflowConfig;

  it("skips unsupported format entries", () => {
    const formats = resolveFormats(
      { formats: ["wav", "mp3" as any, "flac"] } as any,
      cfg
    );
    expect(formats).toEqual(["wav", "flac"]);
  });

  it("deduplicates repeated formats", () => {
    const formats = resolveFormats(
      { formats: ["wav", "wav", "flac"] } as any,
      cfg
    );
    expect(formats).toEqual(["wav", "flac"]);
  });
});

describe("parseSidSpec — empty path part", () => {
  it("returns null when pathPart is empty (value starts with #)", () => {
    expect(parseSidSpec("#3")).toBeNull();
    expect(parseSidSpec("#")).toBeNull();
  });
});
