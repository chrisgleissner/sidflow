import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadAvailabilityManifest,
  Ultimate64AudioCapture,
} from "@sidflow/common";

import { RenderOrchestrator } from "../src/render/render-orchestrator.js";

function createTestWavBuffer(durationSeconds: number, sampleRate: number): Buffer {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples * 4; // stereo 16-bit
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i += 1) {
    const value = Math.sin((i / sampleRate) * Math.PI * 2 * 440);
    const sample = Math.floor(value * 32767);
    buffer.writeInt16LE(sample, 44 + i * 4);
    buffer.writeInt16LE(sample, 46 + i * 4);
  }

  return buffer;
}

describe("RenderOrchestrator render mode validation", () => {
  it("rejects invalid render mode combinations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sidflow-render-"));
    const outputDir = path.join(root, "renders");
    const sidPath = path.join(root, "test.sid");

    try {
      await writeFile(sidPath, Buffer.from("dummy sid"));
      const orchestrator = new RenderOrchestrator();

      // Invalid combination: client + prepared (should be realtime)
      await expect(
        orchestrator.render({
          sidPath,
          outputDir,
          engine: "wasm",
          formats: ["wav"],
          renderMode: {
            location: "client",
            time: "prepared",
            technology: "wasm",
            target: "playback-only",
          },
        })
      ).rejects.toThrow("Invalid render mode");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts valid render mode combinations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sidflow-render-"));
    const hvscRoot = path.join(root, "hvsc");
    const outputDir = path.join(root, "renders");

    try {
      await mkdir(path.join(hvscRoot, "MUSICIANS", "Test"), { recursive: true });
      const sidPath = path.join(hvscRoot, "MUSICIANS", "Test", "demo.sid");
      await writeFile(sidPath, Buffer.from("dummy sid"));

      const orchestrator = new RenderOrchestrator({ hvscRoot });
      const wavBuffer = createTestWavBuffer(1, 44100);

      const orchestratorAny = orchestrator as unknown as {
        renderWav: typeof orchestrator["renderWav"];
      };

      orchestratorAny.renderWav = async (_request, wavPath) => {
        await writeFile(wavPath, wavBuffer);
        return undefined;
      };

      // Valid combination: server + prepared + sidplayfp-cli
      const result = await orchestrator.render({
        sidPath,
        outputDir,
        engine: "sidplayfp-cli",
        formats: ["wav"],
        renderMode: {
          location: "server",
          time: "prepared",
          technology: "sidplayfp-cli",
          target: "wav-m4a-flac",
        },
      });

      expect(result.errors).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("RenderOrchestrator availability registration", () => {
  it("records capture metadata when manifests are enabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sidflow-render-"));
    const hvscRoot = path.join(root, "hvsc");
    const outputDir = path.join(root, "renders");
    const manifestPath = path.join(root, "availability", "streams.json");

    try {
      await mkdir(path.join(hvscRoot, "MUSICIANS", "Test"), { recursive: true });

      const sidPath = path.join(hvscRoot, "MUSICIANS", "Test", "demo.sid");
      await writeFile(sidPath, Buffer.from("dummy sid"));

      const orchestrator = new RenderOrchestrator({
        hvscRoot,
        availabilityManifestPath: manifestPath,
        availabilityAssetRoot: outputDir,
        registerAvailabilityAssets: true,
        ultimate64Capture: new Ultimate64AudioCapture({
          port: 12000,
          bufferTimeMs: 180,
        }),
      });

      const wavBuffer = createTestWavBuffer(1, 44100);
      const captureStats = {
        packetsReceived: 10,
        packetsReordered: 2,
        packetsLost: 0,
        lossRate: 0,
        durationMs: 1000,
      };

      const orchestratorAny = orchestrator as unknown as {
        renderWav: typeof orchestrator["renderWav"];
      };

      orchestratorAny.renderWav = async (_request, wavPath) => {
        await writeFile(wavPath, wavBuffer);
        return captureStats;
      };

      await orchestrator.render({
        sidPath,
        outputDir,
        engine: "ultimate64",
        formats: ["wav"],
        songIndex: 1,
        targetDurationMs: 1_000,
        renderMode: {
          location: "server",
          time: "prepared",
          technology: "ultimate64",
          target: "wav-m4a-flac",
        },
      });

      const manifest = await loadAvailabilityManifest(manifestPath);
      expect(manifest.assets).toHaveLength(1);

      const asset = manifest.assets[0];
      expect(asset.relativeSidPath).toBe("MUSICIANS/Test/demo.sid");
      expect(asset.capture?.bufferTimeMs).toBe(180);
      expect(asset.storagePath).toBe("demo-1-ultimate64-6581.wav");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
