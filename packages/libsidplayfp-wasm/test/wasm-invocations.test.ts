import { beforeAll, describe, expect, it } from "bun:test";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { SidAudioEngine } from "../src/player.js";

const SAMPLE_SID = path.join(
  process.cwd(),
  "test-data",
  "C64Music",
  "DEMOS",
  "0-9",
  "10_Orbyte.sid"
);

const PLAYBACK_DURATION = 0.02;
const SEEK_DURATION = 0.02;
const PLAYBACK_CHUNK_SAMPLES = Math.floor(PLAYBACK_DURATION * 44_100 * 2);
const SEEK_CHUNK_SAMPLES = Math.floor(SEEK_DURATION * 44_100 * 2);

describe("SidAudioEngine WASM flows", () => {
  let playbackChunk: Int16Array;
  let tuneInfo: Record<string, unknown> | null;
  let songSelectResult = 0;
  let followupChunkLen = 0;
  let cachedMid: Int16Array;
  let cachedTail: Int16Array;
  let midAfterSeek: Int16Array;
  let tailAfterSeek: Int16Array;
  let tailLatencyMs = 0;

  beforeAll(async () => {
    const sidBuffer = await readFile(SAMPLE_SID);

    const playbackEngine = new SidAudioEngine({ cacheSecondsLimit: 2 });
    await playbackEngine.loadSidBuffer(sidBuffer);
    playbackChunk = await playbackEngine.renderSeconds(PLAYBACK_DURATION, 5_000);
    tuneInfo = playbackEngine.getTuneInfo();
    songSelectResult = await playbackEngine.selectSong(1);
    followupChunkLen = (await playbackEngine.renderSeconds(PLAYBACK_DURATION, 5_000)).length;

    const cacheEngine = new SidAudioEngine({ cacheSecondsLimit: 4 });
    await cacheEngine.loadSidBuffer(sidBuffer);
    await cacheEngine.waitForCacheReady();
    const mid = cacheEngine.getCachedSegment(1.5, SEEK_DURATION);
    const tail = cacheEngine.getCachedSegment(3.0, SEEK_DURATION);
    if (!mid || !tail) {
      throw new Error("Cache did not capture required segments");
    }
    cachedMid = mid;
    cachedTail = tail;

    await cacheEngine.seekSeconds(1.5);
    midAfterSeek = await cacheEngine.renderSeconds(SEEK_DURATION, 5_000);

    await cacheEngine.seekSeconds(3.0);
    const before = performance.now();
    tailAfterSeek = await cacheEngine.renderSeconds(SEEK_DURATION, 5_000);
    tailLatencyMs = performance.now() - before;
  });

  it("streams PCM, exposes metadata, and supports song selection", () => {
    expect(playbackChunk.length).toBe(PLAYBACK_CHUNK_SAMPLES);
    expect(tuneInfo?.infoStrings).toBeInstanceOf(Array);
    expect(tuneInfo?.infoStrings?.[0]).toContain("Orbyte");
    expect(songSelectResult).toBeGreaterThanOrEqual(0);
    expect(followupChunkLen).toBeGreaterThan(0);
  });

  it("uses the eager cache to provide precise slider seeks", () => {
    expect(cachedMid.length).toBe(SEEK_CHUNK_SAMPLES);
    expect(cachedTail.length).toBe(SEEK_CHUNK_SAMPLES);
    expect(Array.from(midAfterSeek)).toEqual(Array.from(cachedMid));
    expect(Array.from(tailAfterSeek)).toEqual(Array.from(cachedTail));
    expect(tailLatencyMs).toBeLessThan(20);
  });
});
