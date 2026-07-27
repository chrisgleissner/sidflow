/**
 * Engine non-degradation gate. Runs on every CI run.
 *
 * WHY THIS EXISTS
 * ---------------
 * The published WASM artifact was wrong for months in ways every existing test
 * happily passed:
 *
 *   1. It was SIDLite (a lightweight cRSID-derived approximation), not reSIDfp,
 *      because `HAVE_RESIDFP` was never defined. Nothing asserted which engine
 *      was linked.
 *   2. A `sidemu` wrapper corrupted the mixer's buffer contract, feeding the
 *      mixer an ever-growing stale sample count.
 *   3. `selectSong()` re-ran `player.load()` without re-running `initMixer()`,
 *      so the mixer held freed SID sample buffers — a heap-use-after-free that
 *      made the engine ~10 dB too bright above 3 kHz.
 *
 * All three loaded, rendered, returned plausible sample counts and never threw.
 * Only an A/B against real C64 hardware revealed them. These tests turn that A/B
 * into properties CI can check in seconds — no hardware, no C64 ROMs, no native
 * toolchain.
 *
 * WHAT IS AND IS NOT AN INVARIANT
 * -------------------------------
 * Tempting but WRONG: "output must not depend on render chunk size". The broken
 * build did violate that, but so does a *correct* native libsidplayfp on several
 * fixtures — by a few LSBs, where the broken build differed by 10 dB. Asserting
 * exact chunk invariance would encode a false invariant and fail on good builds.
 *
 * What is safe to assert is a **golden comparison**: the metrics below, recorded
 * from a known-good build that was itself validated against a native build of
 * the same library (`scripts/native-parity.mjs`) and against a real C64. The
 * tolerances are wide enough to absorb last-ulp libm differences (the wasm and
 * native builds sit ~80 dB apart) and far tighter than any of the three defects
 * above, which moved these numbers by 6-60 dB.
 *
 * REGENERATING THE GOLDENS
 * ------------------------
 * Only when the engine legitimately changes — a `LIBSIDPLAYFP_REF` /
 * `LIBRESIDFP_REF` bump, or an emsdk upgrade:
 *
 *     bun run scripts/native-parity.mjs --update-goldens
 *
 * That rebuilds a matched *native* reference, verifies the wasm build against it
 * first, and only then rewrites `test/fixtures/engine-goldens.json`. Never
 * hand-edit the goldens to make a red test green — that is how defect 1 survived
 * for months.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLibsidplayfp } from "../src/index.js";
import { BANDS, CHANNELS, correlation, differenceDbfs, measure, SAMPLE_RATE } from "../scripts/engine-metrics.mjs";
import { FIXTURES, RENDER_SECONDS, CHUNK_CYCLES, renderWith } from "./helpers/engine-fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");

const goldens = JSON.parse(readFileSync(path.join(HERE, "fixtures/engine-goldens.json"), "utf8"));

/** Absorbs last-ulp libm differences; each defect above moved these by 6-60 dB. */
const TOLERANCE = {
  dc: 0.01,
  rmsDb: 0.5,
  peak: 0.05,
  bandDb: 1.5,
  envelopeCorrelation: 0.999,
};

/**
 * Run-to-run stability. The engine has a measured ~−80 dBFS noise floor between
 * successive renders of the same tune (allocation/last-ulp effects), so this is
 * a tolerance, not an equality.
 */
const STABILITY = {
  correlation: 0.9999,
  errorRmsDbfs: -60,
};

/**
 * These tests render real audio synchronously — RENDER_SECONDS per render, and
 * reSIDfp with three SID chips costs roughly three times a single-chip tune.
 * That is comfortably past Bun's 5 s default per-test timeout: Waterfall_3SID
 * needs ~7-8 s here for the two-render stability check, and a CI runner is
 * slower still. The old SIDLite artifact was cheap enough to hide this.
 *
 * This is CPU cost, not a hang, so the limit only has to sit well clear of it —
 * it is a guard against a wedged engine, not a performance assertion. Render
 * speed is covered by performance.test.ts.
 */
const RENDER_TEST_TIMEOUT_MS = 60_000;

let wasmModule: Awaited<ReturnType<typeof loadLibsidplayfp>>;

beforeAll(async () => {
  // Pinned, not defaulted: this suite exists to assert reSIDfp specifically, and
  // SIDFLOW_SID_ENGINE=sidlite in the environment would otherwise quietly point
  // it at the other artifact and turn every assertion here into a lie.
  wasmModule = await loadLibsidplayfp({ engine: "residfp" });
});

const render = (file: string) => renderWith(wasmModule, file, CHUNK_CYCLES, RENDER_SECONDS);

describe("engine identity", () => {
  it("is reSIDfp, not the SIDLite approximation", () => {
    // Guards the defect that shipped silently: bindings.cpp falls back to
    // SIDLiteBuilder unless HAVE_RESIDFP is defined, and nothing noticed.
    const text = readFileSync(path.join(PACKAGE_ROOT, "dist/libsidplayfp.wasm")).toString("latin1");
    expect(
      text.includes("WasmReSIDfp"),
      "dist/libsidplayfp.wasm does not contain the reSIDfp builder name — the build fell back to " +
        "SIDLite. Rebuild with `bun run build:wasm`; libresidfp must be visible to pkg-config so " +
        "configure defines HAVE_RESIDFP.",
    ).toBe(true);
    expect(
      text.includes("WasmSIDLite"),
      "dist/libsidplayfp.wasm still contains the SIDLite builder name; the artifact is not a pure " +
        "reSIDfp build.",
    ).toBe(false);
  });
});

describe.each(FIXTURES)("engine non-degradation: $name", ({ name, file }) => {
  it("produces an audible, unclipped, DC-free signal", () => {
    const stats = measure(render(file));

    expect(stats.frames, "engine stopped producing samples early").toBeGreaterThan(SAMPLE_RATE);
    expect(stats.rms, `${name} rendered silence (rms ${stats.rms})`).toBeGreaterThan(0.0005);
    expect(stats.peak, `${name} clips (peak ${stats.peak})`).toBeLessThan(0.999);
    // No C64 audio path emits DC. The SIDLite artifact measured +0.17 full scale,
    // wasting headroom and clicking on start/stop.
    expect(Math.abs(stats.dc), `${name} carries a DC offset of ${stats.dc.toFixed(4)}`).toBeLessThan(0.02);
  }, RENDER_TEST_TIMEOUT_MS);

  it("is stable across repeated renders", () => {
    // NOT byte-equality. Measured: successive renders of the same tune in one
    // module instance differ by ~90 LSB peak at a −81 dBFS error floor, with DC
    // and RMS identical to six decimal places. That is the same magnitude as the
    // wasm-vs-native gap, i.e. last-ulp/allocation noise, and roughly 60 dB below
    // the defects this suite exists to catch. Asserting a hash here would encode
    // a false invariant and fail on a perfectly good build.
    const a = render(file);
    const b = render(file);
    const corr = correlation(a, b);
    const diff = differenceDbfs(a, b);
    expect(
      corr,
      `${name}: two identical renders correlate only ${corr.toFixed(6)} — the engine is not merely ` +
        `noisy at the ulp level, it is producing materially different audio run to run.`,
    ).toBeGreaterThan(STABILITY.correlation);
    expect(
      diff.rmsDbfs,
      `${name}: run-to-run difference is ${diff.rmsDbfs.toFixed(1)} dBFS (expected below ` +
        `${STABILITY.errorRmsDbfs} dBFS).`,
    ).toBeLessThan(STABILITY.errorRmsDbfs);
  }, RENDER_TEST_TIMEOUT_MS);

  it("matches the recorded golden within tolerance", () => {
    const golden = goldens.fixtures[name];
    expect(golden, `no golden recorded for ${name}; run scripts/native-parity.mjs --update-goldens`).toBeDefined();

    const stats = measure(render(file));
    const hint =
      `\nIf this is an intended engine change (LIBSIDPLAYFP_REF / LIBRESIDFP_REF / emsdk bump), ` +
      `re-validate against a native build and regenerate:\n` +
      `    bun run scripts/native-parity.mjs --update-goldens\n` +
      `Do NOT hand-edit test/fixtures/engine-goldens.json to silence this.`;

    expect(Math.abs(stats.dc - golden.dc), `${name}: DC moved ${golden.dc} -> ${stats.dc}${hint}`).toBeLessThan(
      TOLERANCE.dc,
    );

    const rmsDb = 20 * Math.log10((stats.rms + 1e-30) / (golden.rms + 1e-30));
    expect(Math.abs(rmsDb), `${name}: level moved ${rmsDb.toFixed(2)} dB${hint}`).toBeLessThan(TOLERANCE.rmsDb);

    expect(
      Math.abs(stats.peak - golden.peak),
      `${name}: peak moved ${golden.peak.toFixed(4)} -> ${stats.peak.toFixed(4)}${hint}`,
    ).toBeLessThan(TOLERANCE.peak);

    // The spectral check is the one that catches a use-after-free: it left level
    // and timing intact while adding ~10 dB from 3-10 kHz.
    stats.bandsDb.forEach((db: number, index: number) => {
      const [lo, hi] = BANDS[index]!;
      const delta = db - golden.bandsDb[index];
      expect(
        Math.abs(delta),
        `${name}: ${lo}-${hi} Hz band moved ${delta.toFixed(2)} dB${hint}`,
      ).toBeLessThan(TOLERANCE.bandDb);
    });

    // And the envelope check catches a tune that stops advancing or loops, which
    // a spectrum-only comparison would miss.
    const envCorr = correlation(stats.envelope, golden.envelope);
    expect(
      envCorr,
      `${name}: loudness envelope correlates only ${envCorr.toFixed(5)} with the golden — the tune is ` +
        `no longer progressing the same way${hint}`,
    ).toBeGreaterThan(TOLERANCE.envelopeCorrelation);
  }, RENDER_TEST_TIMEOUT_MS);
});

describe("golden provenance", () => {
  it("was taken from the upstream refs the build is currently pinned to", () => {
    // The real staleness risk: someone bumps LIBSIDPLAYFP_REF / LIBRESIDFP_REF,
    // rebuilds, and the goldens now describe a different engine. Comparing the
    // recorded refs against docker/entrypoint.sh catches that deterministically —
    // unlike regenerating and diffing, which is flaky because the engine has a
    // ~-80 dBFS run-to-run noise floor.
    const entrypoint = readFileSync(path.join(PACKAGE_ROOT, "docker/entrypoint.sh"), "utf8");
    const pinned = (name: string) =>
      entrypoint.match(new RegExp(`^${name}="\\$\\{${name}:-([^}]*)\\}"`, "m"))?.[1];

    const hint =
      "\nRe-validate against a native build and regenerate:\n" +
      "    bun run scripts/native-parity.mjs --update-goldens";

    expect(
      goldens.libsidplayfpRef,
      `goldens were taken from libsidplayfp ${goldens.libsidplayfpRef} but the build is pinned to ` +
        `${pinned("LIBSIDPLAYFP_REF")}${hint}`,
    ).toBe(pinned("LIBSIDPLAYFP_REF"));
    expect(
      goldens.libresidfpRef,
      `goldens were taken from libresidfp ${goldens.libresidfpRef} but the build is pinned to ` +
        `${pinned("LIBRESIDFP_REF")}${hint}`,
    ).toBe(pinned("LIBRESIDFP_REF"));
    expect(goldens.renderSeconds).toBe(RENDER_SECONDS);
    expect(goldens.chunkCycles).toBe(CHUNK_CYCLES);
    expect(goldens.sampleRate).toBe(SAMPLE_RATE);
    expect(goldens.channels).toBe(CHANNELS);
    expect(
      Object.keys(goldens.fixtures).sort(),
      "goldens cover a different fixture set than the tests render",
    ).toEqual(FIXTURES.map((f) => f.name).sort());
  });
});
