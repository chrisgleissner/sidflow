#!/usr/bin/env bun
/**
 * Comparative engine analysis: WASM vs a NATIVE build of the same libsidplayfp.
 *
 * This is the rigorous half of the engine story. `test/engine-parity.test.ts`
 * compares the wasm build against recorded goldens and runs in seconds on every
 * CI run; this compares it against a freshly built native reference at the same
 * pinned refs, with the same SidConfig and the same render loop, so the only
 * remaining variable is the wasm target itself.
 *
 * Why a purpose-built native reference rather than the distro `sidplayfp`:
 * distros ship libsidplayfp 2.x, so comparing against `/usr/bin/sidplayfp`
 * conflates "our build is wrong" with "upstream changed between major versions".
 * That mistake cost real time before it was spotted.
 *
 *   bun run scripts/native-parity.mjs                  # verify
 *   bun run scripts/native-parity.mjs --update-goldens # verify, then re-record
 *
 * Exit code is non-zero if any fixture fails a threshold.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadLibsidplayfp } from "../src/index.js";
import { CHANNELS, correlation, differenceDbfs, measure, SAMPLE_RATE } from "./engine-metrics.mjs";
import { CHUNK_CYCLES, FIXTURES, RENDER_SECONDS, renderWith } from "../test/helpers/engine-fixtures.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");
const GOLDENS_PATH = path.join(PACKAGE_ROOT, "test/fixtures/engine-goldens.json");

/**
 * Thresholds.
 *
 * The two builds are NOT bit-identical and are not expected to be: emscripten's
 * musl-derived libm differs from glibc's in the last ulp, and those differences
 * reach reSIDfp's filter and resampler table generation. Measured on the
 * known-good build, the gap is correlation > 0.99999 with an error floor of
 * −75 to −87 dBFS — inaudible, and far below the SID's own noise floor.
 *
 * For scale: the heap-use-after-free that made the engine 10 dB too bright
 * measured correlation 0.75 and roughly −20 dBFS. So −60 dBFS leaves ~15 dB of
 * headroom over observed noise while still catching a real defect by ~40 dB.
 */
const THRESHOLDS = {
  correlation: 0.9999,
  errorRmsDbfs: -60,
  levelDb: 0.1,
  dc: 0.001,
};

const updateGoldens = process.argv.includes("--update-goldens");

function readPinnedRef(name) {
  const entrypoint = readFileSync(path.join(PACKAGE_ROOT, "docker/entrypoint.sh"), "utf8");
  const match = entrypoint.match(new RegExp(`^${name}="\\$\\{${name}:-([^}]*)\\}"`, "m"));
  if (!match) throw new Error(`could not read ${name} from docker/entrypoint.sh`);
  return match[1];
}

const libsidplayfpRef = readPinnedRef("LIBSIDPLAYFP_REF");
const libresidfpRef = readPinnedRef("LIBRESIDFP_REF");

console.log(`pinned refs: libsidplayfp ${libsidplayfpRef}, libresidfp ${libresidfpRef}`);

const nativeBinary = execFileSync("bash", [path.join(HERE, "build-native-reference.sh")], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
})
  .trim()
  .split("\n")
  .pop();

console.log(`native reference: ${nativeBinary}\n`);

const wasmModule = await loadLibsidplayfp();
const scratch = mkdtempSync(path.join(tmpdir(), "sidflow-parity-"));

const rows = [];
const goldenFixtures = {};
let failures = 0;

try {
  for (const fixture of FIXTURES) {
    const wasm = renderWith(wasmModule, fixture.file, CHUNK_CYCLES, RENDER_SECONDS);

    const nativeRaw = path.join(scratch, `${fixture.name}.raw`);
    execFileSync(nativeBinary, [fixture.file, String(RENDER_SECONDS), nativeRaw, "0"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const nativeBuffer = readFileSync(nativeRaw);
    const native = new Int16Array(nativeBuffer.buffer, nativeBuffer.byteOffset, nativeBuffer.byteLength / 2);

    const length = Math.min(wasm.length, native.length);
    const a = wasm.subarray(0, length);
    const b = native.subarray(0, length);

    const corr = correlation(a, b);
    const diff = differenceDbfs(a, b);
    const wasmStats = measure(a);
    const nativeStats = measure(b);
    const levelDb = 20 * Math.log10((wasmStats.rms + 1e-30) / (nativeStats.rms + 1e-30));
    const dcDelta = Math.abs(wasmStats.dc - nativeStats.dc);

    const problems = [];
    if (!(corr >= THRESHOLDS.correlation)) problems.push(`correlation ${corr.toFixed(6)} < ${THRESHOLDS.correlation}`);
    if (!(diff.rmsDbfs <= THRESHOLDS.errorRmsDbfs))
      problems.push(`error ${diff.rmsDbfs.toFixed(1)} dBFS > ${THRESHOLDS.errorRmsDbfs}`);
    if (!(Math.abs(levelDb) <= THRESHOLDS.levelDb)) problems.push(`level ${levelDb.toFixed(3)} dB`);
    if (!(dcDelta <= THRESHOLDS.dc)) problems.push(`DC delta ${dcDelta.toFixed(5)}`);

    if (problems.length > 0) failures++;

    rows.push({
      name: fixture.name,
      corr,
      errDb: diff.rmsDbfs,
      maxLsb: diff.maxAbsLsb,
      levelDb,
      status: problems.length === 0 ? "ok" : problems.join("; "),
    });

    goldenFixtures[fixture.name] = {
      dc: wasmStats.dc,
      rms: wasmStats.rms,
      peak: wasmStats.peak,
      bandsDb: wasmStats.bandsDb,
      envelope: wasmStats.envelope,
    };
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad("fixture", 22)}${pad("corr", 12)}${pad("errRMS", 11)}${pad("maxΔ", 8)}${pad("level", 10)}status`);
console.log("-".repeat(90));
for (const row of rows) {
  console.log(
    pad(row.name, 22) +
      pad(row.corr.toFixed(7), 12) +
      pad(`${row.errDb.toFixed(1)} dB`, 11) +
      pad(`${row.maxLsb}`, 8) +
      pad(`${row.levelDb >= 0 ? "+" : ""}${row.levelDb.toFixed(3)} dB`, 10) +
      row.status,
  );
}
console.log();

if (failures > 0) {
  console.error(
    `${failures} fixture(s) failed the native parity thresholds.\n` +
      `The wasm engine no longer matches a native build of the same library. This is how the\n` +
      `heap-use-after-free in SidPlayerContext::selectSong() was caught. Reproduce it under\n` +
      `AddressSanitizer, which names the offending access directly:\n` +
      `    SIDFLOW_EXTRA_FLAGS=-fsanitize=address bun run build:wasm`,
  );
  process.exit(1);
}

console.log("native parity: all fixtures within thresholds");

if (updateGoldens) {
  const goldens = {
    // Recorded so a ref bump cannot silently invalidate the tolerances.
    libsidplayfpRef,
    libresidfpRef,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    renderSeconds: RENDER_SECONDS,
    chunkCycles: CHUNK_CYCLES,
    generatedBy: "scripts/native-parity.mjs --update-goldens",
    note: "Regenerate only after native parity passes. Never hand-edit to silence a failing test.",
    fixtures: goldenFixtures,
  };
  writeFileSync(GOLDENS_PATH, `${JSON.stringify(goldens, null, 2)}\n`);
  console.log(`goldens rewritten: ${path.relative(PACKAGE_ROOT, GOLDENS_PATH)}`);
}
