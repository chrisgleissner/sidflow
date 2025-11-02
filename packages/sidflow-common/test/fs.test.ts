import { describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureDir, pathExists } from "@sidflow/common";

const TEMP_PREFIX = path.join(os.tmpdir(), "sidflow-fs-");

describe("fs helpers", () => {
  it("ensures directories exist", async () => {
    const base = await mkdtemp(TEMP_PREFIX);
    const target = path.join(base, "nested", "dir");

    await ensureDir(target);
    expect(await pathExists(target)).toBeTrue();

    await rm(base, { recursive: true, force: true });
  });

  it("returns false when path is missing", async () => {
    const base = await mkdtemp(TEMP_PREFIX);
    const target = path.join(base, "nonexistent");

    expect(await pathExists(target)).toBeFalse();

    await rm(base, { recursive: true, force: true });
  });

  it("rethrows unexpected filesystem errors", async () => {
    const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const statSpy = spyOn(fsPromises, "stat").mockRejectedValueOnce(error);

    await expect(pathExists("/nowhere"))
      .rejects.toThrow("permission denied");

    statSpy.mockRestore();
  });
});
