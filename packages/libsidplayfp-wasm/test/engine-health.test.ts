/**
 * Engine health, asserted for EVERY engine this package ships.
 *
 * engine-parity.test.ts pins reSIDfp and compares it against recorded goldens.
 * That is the fidelity gate, and it deliberately says nothing about SIDLite.
 * This suite is the other half: the properties that must hold for any artifact
 * we publish, whichever emulation is compiled in.
 *
 * It exists because the SIDLite artifact rotted in exactly this space while
 * every test in the repo passed. Measured on the artifact that shipped for
 * months, against the same tunes:
 *
 *   - it clipped: peak 0.976-0.996 (a correct build measures 0.13-0.48)
 *   - it carried a DC offset of 0.12-0.15 (a correct build: -0.005 to 0.10)
 *   - it could not render a 3-SID tune at all — out-of-bounds access in
 *     selectSong
 *   - it aborted in the embind destructor after the first tune, so a single
 *     module instance could not render two files in a row
 *
 * None of that was the emulation. It was the mixer buffer contract and a
 * heap-use-after-free in the bindings, which is precisely why these checks are
 * engine-agnostic: a defect in shared code shows up in whichever engine you
 * happen to be looking at.
 *
 * Each assertion below maps to one of those four failures. Thresholds sit far
 * enough from a healthy build that ordinary engine differences do not trip
 * them, and far enough from the historical values that a regression cannot
 * hide: SIDLite legitimately carries more DC than reSIDfp (0.10 vs 0.003 on
 * Commando), so the DC bound is 0.12 — above honest SIDLite, below the 0.1516
 * the broken artifact produced.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLibsidplayfp, type SidEngine } from "../src/index.js";
import { measure, SAMPLE_RATE, correlation } from "../scripts/engine-metrics.mjs";
import { FIXTURES, RENDER_SECONDS, CHUNK_CYCLES, renderWith } from "./helpers/engine-fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");

/** Rendering is CPU-bound; see the note in engine-parity.test.ts. */
const RENDER_TEST_TIMEOUT_MS = 60_000;

const ENGINES: Array<{ engine: SidEngine; builder: string; artifact: string }> = [
  { engine: "residfp", builder: "WasmReSIDfp", artifact: "dist/libsidplayfp.wasm" },
  { engine: "sidlite", builder: "WasmSIDLite", artifact: "dist/sidlite/libsidplayfp.wasm" },
];

const HEALTH = {
  /** Above honest SIDLite (0.10), below the broken artifact (0.15). */
  maxAbsDc: 0.12,
  /** The broken artifact sat at 0.976-0.996; healthy builds at 0.13-0.48. */
  maxPeak: 0.9,
  /** Anything quieter than this is silence, not a tune. */
  minRms: 0.0005,
};

describe.each(ENGINES)("engine health: $engine", ({ engine, builder, artifact }) => {
  // Skipped rather than failed when the artifact is absent: a checkout that has
  // only ever built the default engine should not report a false defect.
  const artifactPath = path.join(PACKAGE_ROOT, artifact);
  const present = existsSync(artifactPath);
  const maybe = present ? describe : describe.skip;

  maybe(`${engine} artifact`, () => {
    let wasmModule: Awaited<ReturnType<typeof loadLibsidplayfp>>;

    beforeAll(async () => {
      wasmModule = await loadLibsidplayfp({ engine });
    });

    it("is the engine it claims to be", () => {
      expect(
        wasmModule.getSidEngineName(),
        `loadLibsidplayfp({ engine: "${engine}" }) returned a different artifact`,
      ).toBe(builder);
    });

    describe.each(FIXTURES)("$name", ({ name, file }) => {
      it("renders an audible, unclipped, DC-free signal", () => {
        const pcm = renderWith(wasmModule, file, CHUNK_CYCLES, RENDER_SECONDS);
        const stats = measure(pcm);

        expect(stats.frames, `${engine}/${name}: engine stopped producing samples early`).toBeGreaterThan(
          SAMPLE_RATE,
        );
        expect(stats.rms, `${engine}/${name}: rendered silence (rms ${stats.rms})`).toBeGreaterThan(
          HEALTH.minRms,
        );
        // The broken artifact pinned peaks at 0.98-1.00, wasting all headroom.
        expect(stats.peak, `${engine}/${name}: clips (peak ${stats.peak.toFixed(3)})`).toBeLessThan(
          HEALTH.maxPeak,
        );
        // No C64 audio path emits meaningful DC.
        expect(
          Math.abs(stats.dc),
          `${engine}/${name}: DC offset ${stats.dc.toFixed(4)} — the broken artifact measured 0.12-0.15`,
        ).toBeLessThan(HEALTH.maxAbsDc);
      }, RENDER_TEST_TIMEOUT_MS);
    });

    it("renders several tunes from one module instance", () => {
      // The broken artifact aborted in the embind destructor after the first
      // tune, so this needs no threshold: completing at all is the assertion.
      for (const fixture of FIXTURES) {
        const pcm = renderWith(wasmModule, fixture.file, CHUNK_CYCLES, 1);
        expect(pcm.length, `${engine}: ${fixture.name} produced nothing on a shared module`).toBeGreaterThan(0);
      }
    }, RENDER_TEST_TIMEOUT_MS);

    it("renders multi-SID tunes", () => {
      // Waterfall_3SID is the case the broken artifact could not survive: it
      // died in selectSong with an out-of-bounds access. Every buffer defect
      // this package has had lived in per-chip buffer bookkeeping, which a
      // single-SID tune barely exercises.
      const multi = FIXTURES.filter((fixture) => /\dSID/i.test(fixture.name));
      expect(multi.length, "expected multi-SID fixtures to be present").toBeGreaterThan(0);

      for (const fixture of multi) {
        const pcm = renderWith(wasmModule, fixture.file, CHUNK_CYCLES, RENDER_SECONDS);
        const stats = measure(pcm);
        expect(stats.frames, `${engine}: ${fixture.name} stopped early`).toBeGreaterThan(SAMPLE_RATE);
        expect(stats.rms, `${engine}: ${fixture.name} rendered silence`).toBeGreaterThan(HEALTH.minRms);
      }
    }, RENDER_TEST_TIMEOUT_MS);

    it("is deterministic across repeated renders", () => {
      // Not byte-equality: there is a ~-80 dBFS run-to-run floor. The broken
      // artifact correlated 0.47 and -0.02 between two identical renders.
      const fixture = FIXTURES[FIXTURES.length - 1]!;
      const a = renderWith(wasmModule, fixture.file, CHUNK_CYCLES, RENDER_SECONDS);
      const b = renderWith(wasmModule, fixture.file, CHUNK_CYCLES, RENDER_SECONDS);
      const corr = correlation(a, b);
      expect(
        corr,
        `${engine}/${fixture.name}: two identical renders correlate only ${corr.toFixed(6)}`,
      ).toBeGreaterThan(0.9999);
    }, RENDER_TEST_TIMEOUT_MS);
  });
});
