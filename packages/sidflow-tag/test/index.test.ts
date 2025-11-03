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
  writeManualTag,
  type KeyState
} from "@sidflow/tag";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-tag-");

describe("planTagSession", () => {
  it("creates tagging plan with defaults", async () => {
    const dir = await mkdtemp(TEMP_PREFIX);
    const configPath = path.join(dir, ".sidflow.json");
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 4,
      classificationDepth: 2
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const plan = await planTagSession({ configPath });
    expect(plan.random).toBeFalse();
    expect(plan.sidplayPath).toBe(path.normalize(payload.sidplayPath));

    await rm(dir, { recursive: true, force: true });
  });
});

describe("tagging workflow helpers", () => {
  it("resolves tag file paths relative to HVSC root", () => {
    const hvscPath = "/workspace/hvsc";
    const tagsPath = "/workspace/tags";
    const sidFile = "/workspace/hvsc/C64Music/first.sid";
    const expected = path.join(tagsPath, "C64Music", "first.sid.sid.tags.json");
    expect(createTagFilePath(hvscPath, tagsPath, sidFile)).toBe(expected);
  });

  it("finds untagged SIDs and skips tagged ones", async () => {
    const root = await mkdtemp(TEMP_PREFIX);
    const hvscPath = path.join(root, "hvsc");
    const tagsPath = path.join(root, "tags");
    await Promise.all([mkdir(hvscPath, { recursive: true }), mkdir(tagsPath, { recursive: true })]);

    const firstSid = path.join(hvscPath, "first.sid");
    const secondSid = path.join(hvscPath, "second.sid");
    await Promise.all([writeFile(firstSid, "one"), writeFile(secondSid, "two")]);

    const taggedPath = createTagFilePath(hvscPath, tagsPath, secondSid);
    await mkdir(path.dirname(taggedPath), { recursive: true });
    await writeFile(taggedPath, "{}\n");

    const result = await findUntaggedSids(hvscPath, tagsPath);
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
});
