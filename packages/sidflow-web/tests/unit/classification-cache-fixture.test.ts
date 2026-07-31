/**
 * The E2E cache fixture must stay identical to what the renderer actually writes.
 *
 * `tests/e2e/utils/classification-cache-fixture.ts` seeds a pre-rendered WAV plus the
 * sidecar that makes classification treat it as a cache hit. It cannot call
 * `writeWavRenderSettingsSidecar` directly, because Playwright loads it under Node and
 * `@sidflow/classify` reaches `bun:sqlite`. So it keeps a copy of the sidecar, and this
 * test — which runs under Bun and can import both sides — is what stops the copy drifting.
 *
 * This exists because the copy did drift. Adding `sidEngine` and moving the sidecar to v4
 * made every seeded WAV a cache miss, so `classify-api-e2e` and `classify-essentia-e2e`
 * tried to render synthetic SID files for real and failed with a renderer error that said
 * nothing about the fixture.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveClassifyEngine, writeWavRenderSettingsSidecar } from "@sidflow/classify";

import { CACHE_HIT_RENDER_SETTINGS } from "../e2e/utils/classification-cache-fixture.js";

describe("E2E classification cache fixture", () => {
  test("writes the sidecar the production writer would write", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sidflow-cache-fixture-"));
    try {
      const wavFile = path.join(root, "fixture.wav");
      await writeWavRenderSettingsSidecar(wavFile, {
        maxRenderSec: CACHE_HIT_RENDER_SETTINGS.maxRenderSec,
        introSkipSec: CACHE_HIT_RENDER_SETTINGS.introSkipSec,
        maxClassifySec: CACHE_HIT_RENDER_SETTINGS.maxClassifySec,
        sourceOffsetSec: CACHE_HIT_RENDER_SETTINGS.sourceOffsetSec,
        renderEngine: CACHE_HIT_RENDER_SETTINGS.renderEngine,
        sidEngine: CACHE_HIT_RENDER_SETTINGS.sidEngine,
        traceCaptureEnabled: CACHE_HIT_RENDER_SETTINGS.traceCaptureEnabled,
        traceSidecarVersion: CACHE_HIT_RENDER_SETTINGS.traceSidecarVersion,
      });

      const written = JSON.parse(await readFile(`${wavFile}.render.json`, "utf8")) as Record<string, unknown>;

      // The fixture omits the optional fields the writer defaults to null, so compare only
      // the keys the fixture states. A version or value that no longer matches is the
      // failure this test exists to produce.
      for (const [key, value] of Object.entries(CACHE_HIT_RENDER_SETTINGS)) {
        expect({ [key]: written[key] }).toEqual({ [key]: value });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("names the SID emulation classification actually defaults to", () => {
    // needsWavRefresh compares the sidecar's sidEngine against resolveClassifyEngine().
    // If the fixture hardcodes an engine the default run does not select, every seeded
    // WAV is a cache miss again.
    expect(CACHE_HIT_RENDER_SETTINGS.sidEngine).toBe(resolveClassifyEngine());
  });
});
