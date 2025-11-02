import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";

import { planTagSession } from "@sidflow/tag";

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
