/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { RenderOrchestrator } from "../src/render/render-orchestrator.js";
import { probeWavDurationMs } from "../src/render/wav-truncate.js";

const TEST_SID_PATH = path.join(
  process.cwd(),
  "test-data/C64Music/MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid"
);

describe("RenderOrchestrator (sidplayfp-cli time limits)", () => {
  let tempDir: string;
  let argsFile: string;
  let mockCliPath: string;
  let orchestrator: RenderOrchestrator;
  let renderCount = 0;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-render-cli-limit-"));
    argsFile = path.join(tempDir, "args.txt");
    mockCliPath = path.join(tempDir, "sidplayfp-mock.js");
    renderCount = 0;

    const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const argsFile = ${JSON.stringify(argsFile)};

let wavPath = "";
for (const arg of args) {
  if (arg.startsWith("-w")) {
    wavPath = arg.slice(2);
  }
}

function createSilentWav(durationSeconds, sampleRate = 44100) {
  const channels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * channels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize;
  const buffer = Buffer.alloc(fileSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

if (wavPath) {
  fs.mkdirSync(path.dirname(wavPath), { recursive: true });
  // Always write an oversized WAV; SIDFlow must truncate it.
  fs.writeFileSync(wavPath, createSilentWav(30));
}

fs.writeFileSync(argsFile, args.join("\\n") + "\\n");
`;

    await writeFile(mockCliPath, script, { mode: 0o755 });
    orchestrator = new RenderOrchestrator({ sidplayfpCliPath: mockCliPath });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function renderAndReadArgs(options: {
    targetDurationMs?: number;
    maxRenderSeconds?: number;
  }): Promise<{ args: string[]; wavPath: string }> {
    const outputDir = path.join(tempDir, `out-${renderCount++}`);

    const result = await orchestrator.render({
      sidPath: TEST_SID_PATH,
      outputDir,
      engine: "sidplayfp-cli",
      formats: ["wav"],
      songIndex: 1,
      targetDurationMs: options.targetDurationMs,
      maxRenderSeconds: options.maxRenderSeconds,
    });

    const raw = await readFile(argsFile, "utf8");
    const args = raw.trim().split(/\s+/);
    const wavPath = result.outputs.find((output) => output.format === "wav")?.path;
    if (!wavPath) {
      throw new Error("Expected orchestrator to produce a WAV output");
    }
    return { args, wavPath };
  }

  it("passes a Songlengths-based time limit to sidplayfp-cli", async () => {
    const { args } = await renderAndReadArgs({ targetDurationMs: 18_193 });
    const timeArg = args.find((arg) => arg.startsWith("-t"));
    expect(timeArg).toBe("-t19");
  });

  it("applies a fallback render cap when no songlength is provided", async () => {
    const { args } = await renderAndReadArgs({});
    const timeArg = args.find((arg) => arg.startsWith("-t"));
    expect(timeArg).toBe("-t600");
  });

  it("hard-truncates oversized sidplayfp-cli output to the requested cap", async () => {
    const { wavPath } = await renderAndReadArgs({ targetDurationMs: 10_000, maxRenderSeconds: 10 });
    const durationMs = await probeWavDurationMs(wavPath);
    expect(durationMs).toBeGreaterThan(0);
    // Allow tiny rounding noise but never exceed the cap meaningfully.
    expect(durationMs).toBeLessThanOrEqual(10_000 + 25);
  });
});
