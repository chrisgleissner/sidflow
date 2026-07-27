/**
 * The ROM auto-fetch.
 *
 * The pins matter more than the download does: a ROM that is not the one we
 * pinned is a different machine, and every feature extracted afterwards would
 * be measuring it. These tests do not hit the network — they cover the guard
 * rails around it.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ensureSystemRoms,
  isRomAutoFetchEnabled,
  SYSTEM_ROMS,
} from "../src/render/system-roms-fetch.js";

const created: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "sidflow-roms-"));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  const previous = process.env.SIDFLOW_ROMS_AUTO_FETCH;
  if (previous === "") {
    delete process.env.SIDFLOW_ROMS_AUTO_FETCH;
  }
  while (created.length > 0) {
    await rm(created.pop()!, { recursive: true, force: true });
  }
});

describe("system ROM specs", () => {
  it("pins all three ROMs with the sizes libsidplayfp requires", () => {
    expect(SYSTEM_ROMS).toHaveLength(3);
    const bySize = Object.fromEntries(SYSTEM_ROMS.map((spec) => [spec.localName, spec.bytes]));
    expect(bySize["kernal.901227-03.bin"]).toBe(8192);
    expect(bySize["basic.901226-01.bin"]).toBe(8192);
    expect(bySize["characters.901225-01.bin"]).toBe(4096);
  });

  it("pins a full SHA-256 for every ROM", () => {
    for (const spec of SYSTEM_ROMS) {
      expect(spec.sha256, `${spec.localName} has no usable digest`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("uses the local names the ROM loader searches for", () => {
    // engine-factory looks for these exact names first; a rename here would
    // download ROMs that are then never found.
    const names = SYSTEM_ROMS.map((spec) => spec.localName).sort();
    expect(names).toEqual([
      "basic.901226-01.bin",
      "characters.901225-01.bin",
      "kernal.901227-03.bin",
    ]);
  });
});

describe("ensureSystemRoms", () => {
  it("reports the ROMs as present without downloading anything", async () => {
    const dir = await scratch();
    for (const spec of SYSTEM_ROMS) {
      await writeFile(path.join(dir, spec.localName), new Uint8Array(spec.bytes));
    }

    const result = await ensureSystemRoms(dir);

    expect(result.status).toBe("present");
    expect(result.dir).toBe(dir);
  });

  it("does not download when auto-fetch is disabled", async () => {
    const dir = await scratch();
    process.env.SIDFLOW_ROMS_AUTO_FETCH = "0";
    try {
      const result = await ensureSystemRoms(dir);
      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("SIDFLOW_ROMS_AUTO_FETCH");
      expect(await readdir(dir)).toHaveLength(0);
    } finally {
      delete process.env.SIDFLOW_ROMS_AUTO_FETCH;
    }
  });

  it("treats a partial ROM set as incomplete", async () => {
    const dir = await scratch();
    // Only the KERNAL: libsidplayfp needs all three, so this must not count.
    await writeFile(path.join(dir, "kernal.901227-03.bin"), new Uint8Array(8192));
    process.env.SIDFLOW_ROMS_AUTO_FETCH = "0";
    try {
      expect((await ensureSystemRoms(dir)).status).toBe("skipped");
    } finally {
      delete process.env.SIDFLOW_ROMS_AUTO_FETCH;
    }
  });
});

describe("isRomAutoFetchEnabled", () => {
  const cases: Array<[string | undefined, boolean]> = [
    [undefined, true],
    ["1", true],
    ["true", true],
    ["0", false],
    ["false", false],
    ["no", false],
    ["FALSE", false],
  ];

  for (const [value, expected] of cases) {
    it(`is ${expected} for ${value ?? "unset"}`, () => {
      if (value === undefined) {
        delete process.env.SIDFLOW_ROMS_AUTO_FETCH;
      } else {
        process.env.SIDFLOW_ROMS_AUTO_FETCH = value;
      }
      try {
        expect(isRomAutoFetchEnabled()).toBe(expected);
      } finally {
        delete process.env.SIDFLOW_ROMS_AUTO_FETCH;
      }
    });
  }
});
