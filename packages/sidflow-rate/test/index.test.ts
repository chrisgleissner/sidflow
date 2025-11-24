import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import {
  DEFAULT_RATINGS,
  createTagFilePath,
  findUntaggedSids,
  interpretKey,
  planTagSession,
  shuffleInPlace,
  writeManualTag,
  type KeyState
} from "@sidflow/rate";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-rate-");

describe("planTagSession", () => {
  it("creates tagging plan with defaults", async () => {
    const dir = await mkdtemp(TEMP_PREFIX);
    const configPath = path.join(dir, ".sidflow.json");
    const payload = {
      sidPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      threads: 4,
      classificationDepth: 2
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const plan = await planTagSession({ configPath });
    expect(plan.random).toBeFalse();

    await rm(dir, { recursive: true, force: true });
  });
});

describe("tagging workflow helpers", () => {
  it("resolves tag file paths relative to HVSC root", () => {
    const sidPath = "/workspace/hvsc";
    const tagsPath = "/workspace/tags";
    const sidFile = "/workspace/hvsc/C64Music/first.sid";
    const expected = path.join(tagsPath, "C64Music", "first.sid.tags.json");
    expect(createTagFilePath(sidPath, tagsPath, sidFile)).toBe(expected);
  });

  it("finds untagged SIDs and skips tagged ones", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const sidPath = path.join(root, "hvsc");
    const tagsPath = path.join(root, "tags");
    await Promise.all([mkdir(sidPath, { recursive: true }), mkdir(tagsPath, { recursive: true })]);

    const firstSid = path.join(sidPath, "first.sid");
    const secondSid = path.join(sidPath, "second.sid");
    await Promise.all([writeFile(firstSid, "one"), writeFile(secondSid, "two")]);

    const taggedPath = createTagFilePath(sidPath, tagsPath, secondSid);
    await mkdir(path.dirname(taggedPath), { recursive: true });
    await writeFile(taggedPath, "{}\n");

    const result = await findUntaggedSids(sidPath, tagsPath);
    expect(result).toEqual([firstSid]);

    await rm(root, { recursive: true, force: true });
  });

  it("writes deterministic manual tag files", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const target = path.join(root, "tag.json");

    await writeManualTag(target, { e: 5, m: 2, c: 4 }, new Date("2025-01-01T00:00:00.000Z"));

    const contents = await readFile(target, "utf8");
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    expect(parsed).toEqual({ e: 5, m: 2, c: 4, source: "manual", timestamp: "2025-01-01T00:00:00.000Z" });

    await rm(root, { recursive: true, force: true });
  });

  it("interprets keyboard sequences for slider updates and actions", () => {
    let state: KeyState = { ratings: { ...DEFAULT_RATINGS } };

    let result = interpretKey("e", state);
    state = result.state;
    expect(state.pendingDimension).toBe("e");

    result = interpretKey("5", state);
    state = result.state;
    expect(state.pendingDimension).toBeUndefined();
    expect(state.ratings.e).toBe(5);

    result = interpretKey("\n", state);
    expect(result.action).toBe("save");

    result = interpretKey("Q", state);
    expect(result.action).toBe("quit");
  });

  it("clears pending dimension on invalid key", () => {
    const state: KeyState = { ratings: { ...DEFAULT_RATINGS }, pendingDimension: "e" };
    const result = interpretKey("x", state);
    expect(result.state.pendingDimension).toBeUndefined();
    expect(result.action).toBe("none");
  });

  it("includes preference rating when present", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const target = path.join(root, "tag-with-p.json");

    await writeManualTag(target, { e: 5, m: 3, c: 4, p: 5 }, new Date("2025-01-15T00:00:00.000Z"));

    const contents = await readFile(target, "utf8");
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    expect(parsed.p).toBe(5);

    await rm(root, { recursive: true, force: true });
  });

  it("handles non-directory root path gracefully", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const filePath = path.join(root, "file.txt");
    await writeFile(filePath, "not a directory");

    const result = await findUntaggedSids(filePath, root);
    expect(result).toEqual([]);

    await rm(root, { recursive: true, force: true });
  });
});

describe("shuffleInPlace", () => {
  it("shuffles array deterministically with seeded random", () => {
    const values = ["a", "b", "c", "d", "e"];
    const seededRandom = () => 0.5;
    shuffleInPlace(values, seededRandom);
    expect(values.length).toBe(5);
    expect(values).toContain("a");
  });

  it("shuffles array with default Math.random", () => {
    const values = ["x", "y", "z"];
    const original = [...values];
    shuffleInPlace(values);
    expect(values.length).toBe(3);
    expect(values.sort()).toEqual(original.sort());
  });
});
