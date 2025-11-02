import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, rm } from "fs/promises";
import os from "os";
import path from "path";

import { planClassification } from "@sidflow/classify";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-classify-");

describe("planClassification", () => {
  it("maps config into plan", async () => {
    const dir = await mkdtemp(TEMP_PREFIX);
    const configPath = path.join(dir, ".sidflow.json");
    const payload = {
      hvscPath: "./hvsc",
      wavCachePath: "./wav",
      tagsPath: "./tags",
      sidplayPath: "sidplayfp",
      threads: 2,
      classificationDepth: 5
    };
    await writeFile(configPath, JSON.stringify(payload), "utf8");

    const plan = await planClassification({ configPath, forceRebuild: true });
    expect(plan.forceRebuild).toBeTrue();
    expect(plan.classificationDepth).toBe(5);

    await rm(dir, { recursive: true, force: true });
  });
});
