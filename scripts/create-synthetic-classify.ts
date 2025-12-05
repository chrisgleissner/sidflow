/**
 * Creates synthetic SID + WAV test data and runs classification
 * Verifies essentia.js features are extracted and written to output files
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * Generate a minimal valid PSID file
 */
function createSidFile(title: string, author: string): Buffer {
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
  buffer.write(title.slice(0, 31), 22);
  buffer.write(author.slice(0, 31), 54);
  buffer.write("2025 Synthetic", 86);
  buffer.writeUInt16BE(0x0000, 118);
  buffer.writeUInt8(0x60, headerSize);
  buffer.writeUInt8(0x4C, headerSize + 1);
  buffer.writeUInt8(0x03, headerSize + 2);
  buffer.writeUInt8(0x10, headerSize + 3);

  return buffer;
}

/**
 * Generate a WAV file with a sine wave
 */
function createWavFile(durationSec: number, freq: number): Buffer {
  const sampleRate = 44100;
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buffer = Buffer.alloc(fileSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const value = Math.sin(2 * Math.PI * freq * t);
    buffer.writeInt16LE(Math.floor(value * 32767), 44 + i * 2);
  }

  return buffer;
}

async function main() {
  console.log("=== Creating Synthetic SID + WAV Test Data ===\n");

  const sidPath = path.join(REPO_ROOT, "test-workspace/hvsc/C64Music/TEST_SYNTHETIC");
  const wavPath = path.join(REPO_ROOT, "test-workspace/audio-cache/C64Music/TEST_SYNTHETIC");

  // Create directories
  await mkdir(sidPath, { recursive: true });
  await mkdir(wavPath, { recursive: true });

  // Create 3 synthetic test files with different characteristics
  const testSongs = [
    { name: "Synth_Low", freq: 220, duration: 2 },
    { name: "Synth_Mid", freq: 440, duration: 2 },
    { name: "Synth_High", freq: 880, duration: 2 },
  ];

  for (const song of testSongs) {
    const sidFile = path.join(sidPath, `${song.name}.sid`);
    const wavFile = path.join(wavPath, `${song.name}.wav`);

    await writeFile(sidFile, createSidFile(song.name, "Synthetic"));
    await writeFile(wavFile, createWavFile(song.duration, song.freq));

    console.log(`Created: ${song.name}.sid (${song.freq}Hz, ${song.duration}s)`);
  }

  console.log("\n=== Extracting Essentia.js Features ===\n");

  // Import essentia feature extractor
  const { essentiaFeatureExtractor } = await import(
    "../packages/sidflow-classify/src/index.js"
  );

  // Extract features from each synthetic WAV
  const results: Array<{ name: string; freq: number; features: any }> = [];

  for (const song of testSongs) {
    const sidFile = path.join(sidPath, `${song.name}.sid`);
    const wavFile = path.join(wavPath, `${song.name}.wav`);

    const features = await essentiaFeatureExtractor({ wavFile, sidFile });
    results.push({ name: song.name, freq: song.freq, features });

    console.log(`${song.name} (${song.freq}Hz):`);
    console.log(`  energy: ${features.energy.toFixed(4)}`);
    console.log(`  rms: ${features.rms.toFixed(4)}`);
    console.log(`  spectralCentroid: ${features.spectralCentroid.toFixed(0)}`);
    console.log(`  spectralRolloff: ${features.spectralRolloff.toFixed(0)}`);
    console.log(`  bpm: ${features.bpm}`);
    console.log(`  zeroCrossingRate: ${features.zeroCrossingRate.toFixed(4)}`);
    console.log(`  duration: ${features.duration}s`);
    console.log(`  sampleRate: ${features.sampleRate}`);
    console.log("");
  }

  // Write results to a JSONL file  
  const classifiedPath = path.join(REPO_ROOT, "data/classified");
  await mkdir(classifiedPath, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jsonlFile = path.join(classifiedPath, `synthetic_${timestamp}.jsonl`);
  
  const jsonlContent = results.map(r => JSON.stringify({
    sid_path: `C64Music/TEST_SYNTHETIC/${r.name}.sid`,
    features: r.features,
    ratings: { e: 3, m: 3, c: 3 }, // Placeholder ratings
  })).join("\n") + "\n";
  
  await writeFile(jsonlFile, jsonlContent);
  console.log(`=== JSONL Output Written ===`);
  console.log(`File: ${jsonlFile}`);
  console.log(`\nContent:`);
  console.log(jsonlContent);

  console.log("✅ Synthetic classification complete!");
  console.log("\nFiles created:");
  console.log("  - test-workspace/hvsc/C64Music/TEST_SYNTHETIC/*.sid");
  console.log("  - test-workspace/audio-cache/C64Music/TEST_SYNTHETIC/*.wav");
  console.log(`  - ${jsonlFile}`);
}

main().catch(console.error);
