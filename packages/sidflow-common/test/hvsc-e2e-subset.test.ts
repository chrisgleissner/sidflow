import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  materializeHvscE2eSubset,
  selectHvscE2eSubset,
  type HvscE2eCatalogEntry,
  type HvscE2eSubsetManifest,
} from "../src/hvsc-e2e-subset.js";

function createCatalogEntry(sidPath: string, author: string): HvscE2eCatalogEntry {
  return {
    sidPath,
    author,
    title: sidPath,
    released: "1989",
    songs: 1,
    chipCount: 1,
    sidModel1: "MOS6581",
    clock: "PAL",
    year: 1989,
    category: sidPath.split("/")[0] ?? "MUSICIANS",
    styleBucket: sidPath.split("/").slice(0, 2).join("/"),
  };
}

describe("HVSC E2E subset selection", () => {
  test("allows problematic proof-set entries to exceed the base author cap", () => {
    const problematicPaths = [
      "MUSICIANS/A/Author/problem-1.sid",
      "MUSICIANS/A/Author/problem-2.sid",
      "MUSICIANS/A/Author/problem-3.sid",
      "MUSICIANS/A/Author/problem-4.sid",
      "MUSICIANS/A/Author/problem-5.sid",
      "MUSICIANS/A/Author/problem-6.sid",
    ];

    const catalog = [
      ...problematicPaths.map((sidPath) => createCatalogEntry(sidPath, "Author")),
      createCatalogEntry("MUSICIANS/B/Other/random-1.sid", "Other"),
    ];

    const manifest = selectHvscE2eSubset(catalog, {
      targetCount: 7,
      authorCap: 5,
      problematicPaths,
      seed: 1,
    });

    const authorSelections = manifest.entries.filter((entry) => entry.author === "Author");
    expect(authorSelections).toHaveLength(6);
    expect(manifest.entries).toHaveLength(7);
  });
});

describe("HVSC E2E subset materialization", () => {
  test("retries timed-out mirror fetches with an abort signal and succeeds on a later attempt", async () => {
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), "sidflow-hvsc-materialize-"));
    const manifest: HvscE2eSubsetManifest = {
      version: "1",
      seed: 1,
      targetCount: 1,
      authorCap: 5,
      sourceHvscCount: 1,
      generatedAt: "2026-03-30T00:00:00.000Z",
      problematicPaths: [],
      entries: [
        {
          ...createCatalogEntry("DEMOS/A-F/Test.sid", "Tester"),
          source: "random",
          selectionBucket: "DEMOS|1980s|chip1|MOS6581|DEMOS/A-F",
          stableHash: "hash",
        },
      ],
    };

    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      if (calls === 1) {
        return await new Promise<Response>((_resolve, reject) => {
          if (!init?.signal) {
            reject(new Error("Missing abort signal"));
            return;
          }
          init.signal.addEventListener("abort", () => {
            const reason = init.signal?.reason;
            reject(reason instanceof Error ? reason : new Error(String(reason ?? "aborted")));
          }, { once: true });
        });
      }
      return new Response("PSID", { status: 200 });
    };

    try {
      const materialized = await materializeHvscE2eSubset(manifest, targetRoot, {
        allowNetworkFetch: true,
        concurrency: 1,
        mirrorBaseUrls: ["https://example.invalid/HVSC/C64Music"],
        fetchTimeoutMs: 10,
        fetchRetryCount: 1,
        fetchRetryBackoffMs: 0,
        fetchImpl,
      });

      expect(calls).toBe(2);
      expect(materialized).toHaveLength(1);
      expect(await readFile(materialized[0]!, "utf8")).toBe("PSID");
    } finally {
      await rm(targetRoot, { recursive: true, force: true });
    }
  });
});