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

  it("handles existing directories gracefully", async () => {
    const base = await mkdtemp(TEMP_PREFIX);

    await ensureDir(base);
    expect(await pathExists(base)).toBeTrue();

    // Calling again should not throw
    await ensureDir(base);
    expect(await pathExists(base)).toBeTrue();

    await rm(base, { recursive: true, force: true });
  });

  it("returns true for existing files", async () => {
    const base = await mkdtemp(TEMP_PREFIX);
    const filePath = path.join(base, "file.txt");
    await fsPromises.writeFile(filePath, "content");

    expect(await pathExists(filePath)).toBeTrue();

    await rm(base, { recursive: true, force: true });
  });

  it("handles deeply nested paths", async () => {
    const base = await mkdtemp(TEMP_PREFIX);
    const deepPath = path.join(base, "a", "b", "c", "d", "e");

    await ensureDir(deepPath);
    expect(await pathExists(deepPath)).toBeTrue();

    await rm(base, { recursive: true, force: true });
  });
});
