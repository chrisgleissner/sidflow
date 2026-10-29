/** Methodology identity of the ROM fidelity grade: SHA-256 over everything that can change a grade.
 *
 *  - every scripts/rom-grade/*.ts source, plus the transitive closure of the relative imports of those modules
 *    (the scripts/rom-audit modules and packages/sidflow-common/src files they use), by repository path and content hash;
 *  - the SHA-256 of both native renderer binaries and of the three C64 ROM images (which must be the reference set);
 *  - the frozen options: tolerance T, gamma, window and band layout, dead zone, trace-class thresholds, alignment bounds,
 *    consumer policy constants, the native render profile and the horizon rule.
 * Any edit to a grader source therefore changes the identity; a checkpoint written under another identity is refused. */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { REFERENCE_ROM_SHA256 } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { CONSUMER_LIST_CEILING, DEFAULT_GAMMA, NO_PLAYBACK_Q, RECOMMENDED_MIN_GRADE } from "./grade-core.js";
import { nativePaths, repositoryRoot } from "./native.js";
import { BAND_RATIO, DEAD_ZONE_DB, FFT_SIZE, QUIET, SATURATION_DB, WINDOW_FRAMES } from "./severity-core.js";
import {
  ALIGN_BLOCK_MAX_D, ALIGN_BLOCK_WRITES, ALIGN_GLOBAL_MAX_D, ALIGN_WORK_BUDGET, DEFAULT_TOLERANCE_MS, DIGI_MIN_WRITES, DIGI_WINDOW_CYCLES, LATE_DIVERGENCE_FRACTION,
  MAX_ALIGNABLE_OFFSET_CYCLES, MAX_INIT_WRITES, MIN_SIMILAR_MUSIC, NEAR_EQUAL_COUNT_RATIO, NTSC_CLOCK_HZ, PAL_CLOCK_HZ, TEMPO_DRIFT_MS,
} from "./trace-core.js";

export interface MethodologyIdentity {
  id: string;
  sources: Array<{ path: string; sha256: string }>;
  binaries: Record<string, string>;
  roms: Record<string, string>;
  frozen: Record<string, unknown>;
}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** The frozen numbers and rules; also written into every output so a reader can see what the identity covers. */
export function frozenOptions(): Record<string, unknown> {
  return {
    toleranceMs: DEFAULT_TOLERANCE_MS, gamma: DEFAULT_GAMMA, tempoDriftMs: TEMPO_DRIFT_MS, maxAlignableOffsetCycles: MAX_ALIGNABLE_OFFSET_CYCLES, maxInitWrites: MAX_INIT_WRITES,
    lateDivergenceFraction: LATE_DIVERGENCE_FRACTION, nearEqualCountRatio: NEAR_EQUAL_COUNT_RATIO, minSimilarMusic: MIN_SIMILAR_MUSIC,
    digi: { windowCycles: DIGI_WINDOW_CYCLES, minWrites: DIGI_MIN_WRITES }, clocks: { PAL: PAL_CLOCK_HZ, NTSC: NTSC_CLOCK_HZ },
    alignment: { globalMaxD: ALIGN_GLOBAL_MAX_D, blockMaxD: ALIGN_BLOCK_MAX_D, blockWrites: ALIGN_BLOCK_WRITES, workBudget: ALIGN_WORK_BUDGET },
    severity: { windowFrames: WINDOW_FRAMES, fftSize: FFT_SIZE, quiet: QUIET, bandRatio: BAND_RATIO, deadZoneDb: DEAD_ZONE_DB, saturationDb: SATURATION_DB, noPlaybackQ: NO_PLAYBACK_Q },
    consumer: { recommendedMinGrade: RECOMMENDED_MIN_GRADE, listCeiling: CONSUMER_LIST_CEILING },
    nativeProfile: { sampleRate: 48000, powerOnDelay: 8191, pullEvents: 256, lanes: ["none=mask0", "kernal+basic=mask3"], reference: "mask7", chargenUnreadShortcut: true },
    horizonRule: "Songlengths.md5 duration + 5 s, minimum 10 s; 300 s when the length is absent (scripts/rom-audit/methodology.ts observationHorizon)",
  };
}

/** Repository-relative paths of the modules reachable from `entries` through relative imports. */
export async function importClosure(entries: string[]): Promise<string[]> {
  const seen = new Set<string>(), queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(path.join(repositoryRoot, file), "utf8");
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)\.js["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), `${match[1]}.ts`));
      if (!seen.has(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

let cached: MethodologyIdentity | undefined;
export async function methodologyIdentity(): Promise<MethodologyIdentity> {
  if (cached) return cached;
  const gradeDir = path.join(repositoryRoot, "scripts/rom-grade");
  const own = (await readdir(gradeDir)).filter(f => f.endsWith(".ts")).sort().map(f => `scripts/rom-grade/${f}`);
  const files = await importClosure(own);
  const sources = await Promise.all(files.map(async file => ({ path: file, sha256: sha256(await readFile(path.join(repositoryRoot, file))) })));
  const paths = nativePaths();
  const binaries = { residfp: sha256(await readFile(paths.renderer.residfp)), sidlite: sha256(await readFile(paths.renderer.sidlite)) };
  const roms = {
    kernal: sha256(await readFile(path.join(paths.roms, "kernal.901227-03.bin"))),
    basic: sha256(await readFile(path.join(paths.roms, "basic.901226-01.bin"))),
    chargen: sha256(await readFile(path.join(paths.roms, "characters.901225-01.bin"))),
  };
  for (const name of Object.keys(roms) as Array<keyof typeof roms>) if (roms[name] !== REFERENCE_ROM_SHA256[name]) throw new Error(`${name} ROM is not the reference image`);
  const frozen = frozenOptions();
  const id = sha256(JSON.stringify({ sources, binaries, roms, frozen }));
  cached = { id, sources, binaries, roms, frozen };
  return cached;
}
