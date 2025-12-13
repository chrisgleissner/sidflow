/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { renderWavWithEngine } from "../src/render/wav-renderer.js";

interface FakeSidAudioEngine {
  loadSidBuffer: (buffer: Uint8Array) => Promise<void>;
  selectSong: (index: number) => Promise<void>;
  getSampleRate: () => number;
  getChannels: () => number;
  renderCycles: (cycles: number) => Int16Array | null;
}

function parseWavDurationMs(buffer: Buffer): { durationMs: number; sampleRate: number } {
  if (buffer.length < 44) {
    throw new Error("WAV too small");
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV header");
  }

  let offset = 12;
  let fmtChunkOffset = -1;
  let dataChunkSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      fmtChunkOffset = chunkStart;
    } else if (chunkId === "data") {
      dataChunkSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (fmtChunkOffset < 0) {
    throw new Error("Missing fmt chunk");
  }
  if (dataChunkSize <= 0) {
    throw new Error("Missing data chunk");
  }

  const channels = buffer.readUInt16LE(fmtChunkOffset + 2);
  const sampleRate = buffer.readUInt32LE(fmtChunkOffset + 4);
  const bitsPerSample = buffer.readUInt16LE(fmtChunkOffset + 14);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);

  const durationMs = Math.round((dataChunkSize / byteRate) * 1000);
  return { durationMs, sampleRate };
}

function createFakeEngine(sampleRate: number): FakeSidAudioEngine {
  return {
    async loadSidBuffer() {},
    async selectSong() {},
    getSampleRate: () => sampleRate,
    getChannels: () => 1,
    renderCycles: () => new Int16Array(1),
  };
}

describe("renderWavWithEngine duration caps", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sidflow-wav-cap-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function renderAndGetDurationMs(options: {
    targetDurationMs?: number;
    maxRenderSeconds?: number;
  }): Promise<number> {
    const sidFile = path.join(tempDir, "test.sid");
    const wavFile = path.join(tempDir, "out.wav");
    await writeFile(sidFile, Buffer.from([0, 1, 2, 3]));

    const engine = createFakeEngine(10);
    await renderWavWithEngine(engine as any, {
      sidFile,
      wavFile,
      targetDurationMs: options.targetDurationMs,
      maxRenderSeconds: options.maxRenderSeconds,
    });

    const wav = await readFile(wavFile);
    return parseWavDurationMs(wav).durationMs;
  }

  it("does not exceed targetDurationMs when provided", async () => {
    const durationMs = await renderAndGetDurationMs({ targetDurationMs: 10_000 });
    expect(durationMs).toBeLessThanOrEqual(10_000);
  });

  it("does not exceed maxRenderSeconds when targetDurationMs is longer", async () => {
    const durationMs = await renderAndGetDurationMs({
      targetDurationMs: 60_000,
      maxRenderSeconds: 10,
    });
    expect(durationMs).toBeLessThanOrEqual(10_000);
  });

  it("rounds down so sub-second targets never exceed the requested duration", async () => {
    const durationMs = await renderAndGetDurationMs({ targetDurationMs: 18_193 });
    expect(durationMs).toBeLessThanOrEqual(18_193);
  });
});
