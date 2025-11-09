import { describe, expect, it } from "bun:test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { SidAudioEngine } from "../src/player.js";

const SAMPLE_SID = path.join(
  process.cwd(),
  "test-data",
  "C64Music",
  "MUSICIANS",
  "H",
  "Huelsbeck_Chris",
  "Great_Giana_Sisters.sid"
);

describe("SidAudioEngine song selection", () => {
  it("patches start song byte to focus playback on a specific song", async () => {
    const buffer = await readFile(SAMPLE_SID);
    const engine = new SidAudioEngine();

    await engine.loadSidBuffer(buffer);
    const info = engine.getTuneInfo();
    expect(info?.songs).toBeGreaterThan(1);
    expect(info?.startSong).toBe(1);

    const applied = await engine.selectSong(5);
    expect(applied).toBe(5);

    const patchedInfo = engine.getTuneInfo();
    expect(patchedInfo?.startSong).toBe(6);
  });
});
