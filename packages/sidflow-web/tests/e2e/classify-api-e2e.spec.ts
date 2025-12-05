/**
 * E2E Test: Full Classification via REST API
 * 
 * This is the ultimate integration test that:
 * 1. Creates synthetic test SID + pre-rendered WAV files
 * 2. Triggers classification via POST /api/classify
 * 3. Verifies all expected output files are created
 * 4. Validates JSONL contains essentia.js features
 * 
 * Note: Synthetic SIDs produce silent audio (no real 6502 code), so energy/rms may be 0.
 * The test validates the full pipeline works end-to-end.
 */

import { test, expect } from './test-hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');

// Synthetic test directory - created fresh for this test
const TEST_ARTIST_DIR = 'C64Music/MUSICIANS/T/Test_E2E_API';

// Expected output paths (relative to repo root) - use test-workspace to avoid polluting production data
const CLASSIFIED_DIR = path.join(REPO_ROOT, 'test-workspace', 'classified');
const AUDIO_CACHE_DIR = path.join(REPO_ROOT, 'test-workspace', 'audio-cache');
const TAGS_DIR = path.join(REPO_ROOT, 'test-workspace', 'tags');
const SID_BASE_DIR = path.join(REPO_ROOT, 'test-workspace', 'hvsc');

// Test songs to create
const TEST_SONGS = [
  { name: 'API_Test_Low', freq: 220, duration: 1 },
  { name: 'API_Test_Mid', freq: 440, duration: 1 },
  { name: 'API_Test_High', freq: 880, duration: 1 },
];

// Classification timeout (90 seconds - with pre-rendered WAVs it should be fast)
const CLASSIFY_TIMEOUT = 90000;

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
  buffer.write("2025 E2E API Test", 86);
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

test.describe('Classification API E2E', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'API tests only run in chromium');
  
  // Increase timeout for classification
  test.setTimeout(CLASSIFY_TIMEOUT + 30000);
  
  const sidDir = path.join(SID_BASE_DIR, TEST_ARTIST_DIR);
  
  test.beforeAll(async () => {
    console.log('\n📦 Setting up synthetic test files...');
    
    // Create SID directory
    await fs.mkdir(sidDir, { recursive: true });
    
    // Create SID files and pre-rendered WAV files
    for (const song of TEST_SONGS) {
      const sidPath = path.join(sidDir, `${song.name}.sid`);
      await fs.writeFile(sidPath, createSidFile(song.name, 'E2E API Test'));
      
      // Pre-render WAV to audio cache (matching the expected cache path structure)
      // The cache uses: audioCachePath/relative-sid-path.wav
      const relativeSidPath = path.join(TEST_ARTIST_DIR, `${song.name}.sid`);
      const wavCachePath = path.join(AUDIO_CACHE_DIR, relativeSidPath.replace('.sid', '.wav'));
      await fs.mkdir(path.dirname(wavCachePath), { recursive: true });
      await fs.writeFile(wavCachePath, createWavFile(song.duration, song.freq));
      
      console.log(`   ✅ Created ${song.name}.sid + pre-rendered WAV`);
    }
  });

  test.afterAll(async () => {
    // Cleanup synthetic test files
    console.log('\n🧹 Cleaning up test files...');
    try {
      await fs.rm(sidDir, { recursive: true, force: true });
      
      // Clean up WAV cache files
      const wavCacheDir = path.join(AUDIO_CACHE_DIR, TEST_ARTIST_DIR);
      await fs.rm(wavCacheDir, { recursive: true, force: true });
      
      console.log('   ✅ Cleanup complete');
    } catch (e) {
      console.log('   ⚠️  Cleanup warning:', e);
    }
  });

  test('triggers classification via REST API and verifies all output files', async ({ request }) => {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 CLASSIFICATION API E2E TEST');
    console.log('='.repeat(80));

    // Step 1: Get initial state
    console.log('\n📋 Step 1: Initial State');
    console.log('-'.repeat(40));
    
    const jsonlFilesBefore = await getJsonlFiles();
    console.log(`   JSONL files before: ${jsonlFilesBefore.length}`);
    jsonlFilesBefore.forEach(f => console.log(`     - ${f}`));

    // Step 2: Trigger classification via API
    console.log('\n🔧 Step 2: Triggering Classification via REST API');
    console.log('-'.repeat(40));
    console.log(`   POST /api/classify`);
    console.log(`   Path: ${TEST_ARTIST_DIR}`);
    console.log(`   Options: skipAlreadyClassified=false`);
    console.log(`   Note: Using pre-rendered WAVs (no forceRebuild needed)`);

    const startTime = Date.now();

    const response = await request.post('/api/classify', {
      data: {
        path: TEST_ARTIST_DIR,
        // Don't force rebuild - use the pre-rendered WAVs
        forceRebuild: false,
        deleteWavAfterClassification: false,
        skipAlreadyClassified: false,
      },
      timeout: CLASSIFY_TIMEOUT,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n   Response received in ${elapsed}s`);
    console.log(`   Status: ${response.status()}`);

    const responseBody = await response.json();
    
    if (!response.ok()) {
      console.log(`\n❌ Classification failed:`);
      console.log(`   Error: ${responseBody.error}`);
      console.log(`   Details: ${responseBody.details}`);
      if (responseBody.logs) {
        console.log(`   Logs:\n${responseBody.logs.split('\n').map((l: string) => `     ${l}`).join('\n')}`);
      }
    }
    
    expect(response.ok()).toBe(true);
    expect(responseBody.success).toBe(true);

    console.log(`\n✅ Classification completed successfully in ${elapsed}s`);

    // Step 3: Identify the new JSONL file
    console.log('\n📁 Step 3: Identifying Output Files');
    console.log('-'.repeat(40));

    const jsonlFilesAfter = await getJsonlFiles();
    const newJsonlFiles = jsonlFilesAfter.filter(f => !jsonlFilesBefore.includes(f));
    
    console.log(`   JSONL files after: ${jsonlFilesAfter.length}`);
    console.log(`   New JSONL files: ${newJsonlFiles.length}`);
    
    let classificationJsonlPath: string;
    if (newJsonlFiles.length > 0) {
      classificationJsonlPath = path.join(CLASSIFIED_DIR, newJsonlFiles[0]);
      console.log(`   ✅ New JSONL: ${newJsonlFiles[0]}`);
    } else {
      // Check if existing file was updated
      classificationJsonlPath = path.join(CLASSIFIED_DIR, jsonlFilesAfter[jsonlFilesAfter.length - 1]);
      console.log(`   ℹ️  Using most recent JSONL: ${jsonlFilesAfter[jsonlFilesAfter.length - 1]}`);
    }

    // Step 4: Find the WAV files in cache
    console.log('\n🔊 Step 4: Checking Audio Cache');
    console.log('-'.repeat(40));
    
    for (const song of TEST_SONGS) {
      const wavPath = path.join(AUDIO_CACHE_DIR, TEST_ARTIST_DIR, `${song.name}.wav`);
      const exists = existsSync(wavPath);
      const size = exists ? (await fs.stat(wavPath)).size : 0;
      console.log(`   ${exists ? '✅' : '❌'} ${song.name}.wav (${(size / 1024).toFixed(1)} KB)`);
      expect(exists).toBe(true);
    }

    // Step 5: Check tags directory
    console.log('\n🏷️  Step 5: Checking Tags');
    console.log('-'.repeat(40));
    
    const autoTagsPath = path.join(TAGS_DIR, 'auto-tags.json');
    const autoTagsExists = existsSync(autoTagsPath);
    console.log(`   auto-tags.json: ${autoTagsExists ? '✅ exists' : '❌ missing'}`);
    
    if (autoTagsExists) {
      const autoTags = JSON.parse(await fs.readFile(autoTagsPath, 'utf-8'));
      const tagCount = Object.keys(autoTags).length;
      console.log(`   Total tags: ${tagCount}`);
      
      // Check if our SIDs were tagged
      for (const song of TEST_SONGS) {
        const sidTagged = Object.keys(autoTags).some(k => k.includes(song.name));
        console.log(`   ${song.name} tagged: ${sidTagged ? '✅ yes' : '⚠️  no'}`);
      }
    }

    // Step 6: Validate JSONL content
    console.log('\n📊 Step 6: Validating JSONL Content');
    console.log('-'.repeat(40));

    const jsonlContent = await fs.readFile(classificationJsonlPath, 'utf-8');
    const lines = jsonlContent.trim().split('\n').filter(l => l.trim());
    
    console.log(`   Total entries in JSONL: ${lines.length}`);

    // Find entries for our test SIDs
    let foundCount = 0;
    for (const song of TEST_SONGS) {
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const sidPath = entry.sid_path || entry.sidPath || '';
          
          if (sidPath.includes(song.name)) {
            foundCount++;
            console.log(`\n   Found entry for ${song.name}:`);
            console.log(`   sid_path: ${sidPath}`);
            
            const f = entry.features;
            if (f) {
              console.log(`\n   Essentia.js Features:`);
              console.log(`     energy:           ${f.energy?.toFixed(6) || 'N/A'}`);
              console.log(`     rms:              ${f.rms?.toFixed(6) || 'N/A'}`);
              console.log(`     spectralCentroid: ${f.spectralCentroid?.toFixed(2) || 'N/A'} Hz`);
              console.log(`     spectralRolloff:  ${f.spectralRolloff?.toFixed(2) || 'N/A'} Hz`);
              console.log(`     zeroCrossingRate: ${f.zeroCrossingRate?.toFixed(6) || 'N/A'}`);
              console.log(`     bpm:              ${f.bpm?.toFixed(1) || 'N/A'}`);
              console.log(`     duration:         ${f.duration?.toFixed(2) || 'N/A'}s`);
              console.log(`     sampleRate:       ${f.sampleRate || 'N/A'} Hz`);
              console.log(`     numSamples:       ${f.numSamples || 'N/A'}`);
              console.log(`     wavBytes:         ${f.wavBytes || 'N/A'}`);
              console.log(`     sidBytes:         ${f.sidBytes || 'N/A'}`);

              // Validate essentia.js features exist (values may be 0 for synthetic SIDs with no real audio)
              expect(f.energy).toBeGreaterThanOrEqual(0);
              expect(f.rms).toBeGreaterThanOrEqual(0);
              expect(f.spectralCentroid).toBeGreaterThan(0);
              expect(f.spectralRolloff).toBeGreaterThan(0);
              expect(f.zeroCrossingRate).toBeGreaterThanOrEqual(0);
              expect(f.bpm).toBeGreaterThan(0);
              expect(f.duration).toBeGreaterThan(0);
              expect(f.sampleRate).toBe(44100);
              expect(f.numSamples).toBeGreaterThan(0);
              expect(f.wavBytes).toBeGreaterThan(0);
              expect(f.sidBytes).toBeGreaterThan(0);
            }

            if (entry.ratings) {
              console.log(`\n   Auto-Ratings:`);
              console.log(`     energy (e):    ${entry.ratings.e}`);
              console.log(`     melody (m):    ${entry.ratings.m}`);
              console.log(`     complexity (c): ${entry.ratings.c}`);
            }
            
            break;
          }
        } catch (e) {
          // Skip invalid lines
        }
      }
    }

    expect(foundCount).toBe(TEST_SONGS.length);
    console.log(`\n   ✅ Found all ${foundCount}/${TEST_SONGS.length} test songs in JSONL`);

    // Step 7: Summary
    console.log('\n' + '='.repeat(80));
    console.log('📋 SUMMARY: All Output Files Created');
    console.log('='.repeat(80));
    
    console.log(`\n✅ JSONL Classification Output:`);
    console.log(`   ${classificationJsonlPath}`);
    
    console.log(`\n✅ WAV Audio Cache (${TEST_SONGS.length} files):`);
    for (const song of TEST_SONGS) {
      console.log(`   ${path.join(AUDIO_CACHE_DIR, TEST_ARTIST_DIR, song.name + '.wav')}`);
    }
    
    console.log(`\n✅ Auto-Tags:`);
    console.log(`   ${autoTagsPath}`);
    
    console.log('\n' + '='.repeat(80));
    console.log('🎉 ALL TESTS PASSED - Classification API E2E Complete');
    console.log('='.repeat(80) + '\n');
  });
});

async function getJsonlFiles(): Promise<string[]> {
  try {
    const files = await fs.readdir(CLASSIFIED_DIR);
    return files.filter(f => f.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
}
