import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fallbackMetadataFromPath,
  heuristicFeatureExtractor,
  heuristicPredictRatings,
  parseSidMetadataOutput
} from "@sidflow/classify";

const TEMP_PREFIX = path.join(tmpdir(), "sidflow-heuristics-");
const tempDirs: string[] = [];

describe("classification heuristics", () => {
  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("extracts basic file statistics for heuristic features", async () => {
    const dir = await mkdtemp(TEMP_PREFIX);
    tempDirs.push(dir);
    const wavPath = path.join(dir, "sample.wav");
    const sidPath = path.join(dir, "sample.sid");

    await writeFile(wavPath, Buffer.alloc(16, 1));
    await writeFile(sidPath, Buffer.alloc(8, 2));

    const features = await heuristicFeatureExtractor({ wavFile: wavPath, sidFile: sidPath });

    expect(features.wavBytes).toBe(16);
    expect(features.sidBytes).toBe(8);
    expect(features.nameSeed).toBeGreaterThan(0);
  });

  it("predicts ratings deterministically using heuristics", async () => {
    const result = await heuristicPredictRatings({
      sidFile: "/tmp/demo.sid",
      features: { wavBytes: 1024, sidBytes: 512, nameSeed: 1234 },
      relativePath: "C64Music/MUSICIANS/D/Demo.sid",
      metadata: { title: "Demo Track", author: "Demo Author" }
    });

    expect(result.e).toBeGreaterThanOrEqual(1);
    expect(result.e).toBeLessThanOrEqual(5);
    expect(result.m).toBeGreaterThanOrEqual(1);
    expect(result.m).toBeLessThanOrEqual(5);
    expect(result.c).toBeGreaterThanOrEqual(1);
    expect(result.c).toBeLessThanOrEqual(5);

    const repeat = await heuristicPredictRatings({
      sidFile: "/tmp/demo.sid",
      features: { wavBytes: 1024, sidBytes: 512, nameSeed: 1234 },
      relativePath: "C64Music/MUSICIANS/D/Demo.sid",
      metadata: { title: "Demo Track", author: "Demo Author" }
    });

    expect(repeat).toEqual(result);
  });

  it("parses sidplayfp metadata output", () => {
    const output = `
| Title   : Cybernoid II |\n
| Author  : Jeroen Tel  |\n
| Released: 1988        |\n
`;
    const metadata = parseSidMetadataOutput(output);

    expect(metadata.title).toBe("Cybernoid II");
    expect(metadata.author).toBe("Jeroen Tel");
    expect(metadata.released).toBe("1988");
  });

  it("falls back to deriving metadata from path", () => {
    const metadata = fallbackMetadataFromPath("MUSICIANS/Jerome_Tel/Cybernoid_II.sid");

    expect(metadata.title).toBe("Cybernoid II");
    expect(metadata.author).toBe("Jerome Tel");
  });
});
