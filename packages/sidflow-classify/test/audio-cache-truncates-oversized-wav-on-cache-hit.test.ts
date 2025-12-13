/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";

import { buildAudioCache, planClassification } from "../src/index.js";
import { stringifyDeterministic } from "@sidflow/common";
import { probeWavDurationMs } from "../src/render/wav-truncate.js";
import { computeFileHash, type RenderWavOptions } from "../src/render/wav-renderer.js";

function createSilentWav(durationSeconds: number, sampleRate = 44100): Buffer {
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

function createMinimalSid(): Buffer {
  const headerSize = 124;
  const codeSize = 4;
  const buffer = Buffer.alloc(headerSize + codeSize);
  buffer.write("PSID", 0);
  buffer.writeUInt16BE(0x0002, 4);
  buffer.writeUInt16BE(headerSize, 6);
  buffer.writeUInt16BE(0x1000, 8);
  buffer.writeUInt16BE(0x1000, 10);
  buffer.writeUInt16BE(0x1003, 12);
  buffer.writeUInt16BE(0x0001, 14);
  buffer.writeUInt16BE(0x0001, 16);
  buffer.writeUInt32BE(0x00000001, 18);
  buffer.write("Test", 22);
  buffer.write("E2E", 54);
  buffer.write("2025", 86);
  buffer.writeUInt16BE(0x0000, 118);
  buffer.writeUInt8(0x60, headerSize);
  buffer.writeUInt8(0x4C, headerSize + 1);
  buffer.writeUInt8(0x03, headerSize + 2);
  buffer.writeUInt8(0x10, headerSize + 3);
  return buffer;
}

describe("buildAudioCache (cache-hit preserves WAV)", () => {
  let tempRoot: string;
  let sidPath: string;
  let audioCachePath: string;
  let tagsPath: string;
  let classifiedPath: string;
  let configPath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-cache-hit-truncate-"));
    sidPath = path.join(tempRoot, "hvsc");
    audioCachePath = path.join(tempRoot, "audio-cache");
    tagsPath = path.join(tempRoot, "tags");
    classifiedPath = path.join(tempRoot, "classified");

    const config = {
      sidPath,
      audioCachePath,
      tagsPath,
      classifiedPath,
      threads: 0,
      classificationDepth: 1,
      // Strict cap for classification renders/extraction
      maxClassifySec: 10,
    };
    configPath = path.join(tempRoot, "test.sidflow.json");
    await writeFile(configPath, stringifyDeterministic(config));
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not truncate an oversized cached WAV when needsWavRefresh is false", async () => {
    const plan = await planClassification({ configPath, forceRebuild: false });

    const relativeSidPath = path.join("C64Music", "TEST", "Oversized.sid");
    const sidFile = path.join(sidPath, relativeSidPath);
    const wavFile = path.join(audioCachePath, relativeSidPath.replace(/\.sid$/i, ".wav"));
    const hashFile = `${wavFile}.sha256`;

    await mkdir(path.dirname(sidFile), { recursive: true });
    await mkdir(path.dirname(wavFile), { recursive: true });

    // Create a tiny SID payload (content doesn't matter for this test).
    await writeFile(sidFile, createMinimalSid());
    // Create an oversized WAV (30s) that must NOT be modified on cache hit.
    await writeFile(wavFile, createSilentWav(30));
    // Store the correct SID hash so needsWavRefresh can treat this as a cache hit.
    const sidHash = await computeFileHash(sidFile);
    await writeFile(hashFile, sidHash, "utf8");

    // Make SID older than WAV so mtime doesn't trigger a rebuild.
    const now = new Date();
    const sidTime = new Date(now.getTime() - 60_000);
    await utimes(sidFile, sidTime, sidTime);
    await utimes(wavFile, now, now);

    const render = async (_options: RenderWavOptions) => {
      throw new Error("render() should not be called on cache hit");
    };

    await buildAudioCache(plan, { render, forceRebuild: false });

    const durationMs = await probeWavDurationMs(wavFile);
    expect(durationMs).toBeGreaterThan(0);
    expect(durationMs).toBeGreaterThanOrEqual(30_000 - 25);
  });
});
