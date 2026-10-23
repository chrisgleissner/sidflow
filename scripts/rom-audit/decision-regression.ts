#!/usr/bin/env bun
/**
 * Decision-path regression: synthetic programs and real subtunes with known behavior go
 * through the same stages as a corpus subtune on both WASM engines: lockstep lanes,
 * assessMask(), the deny-list tuple and the production lookup, including its deadline and
 * unsupported ROM sets. Every case states the decision expected for the Commander ROM sets
 * (mask 3: KERNAL+BASIC supplied, CHARGEN null; mask 0: nothing supplied; mask 7: everything).
 * The last line is a deterministic digest of all results, so two runs can be compared.
 *
 *   bun scripts/rom-audit/decision-regression.ts <ROM directory>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRomEligibilityLookup, REFERENCE_ROM_SHA256, romConsumerProfile, romEngineId, romSetId, ROM_AUDIT_ENGINES, ROM_DENY_SCHEMA, type RomAuditEngine, type RomDenyList, type RomSelection } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { assessMask, observationHorizon, validateRecord, CENSUS_SCHEMA, METHODOLOGY, type Compatibility, type EngineRun } from "./methodology.js";
import { engineHashes, renderDigest, runEngine, SAMPLE_RATE, UNTOUCHED } from "./wasm-lanes.js";
import { loadRoms } from "./census-worker.js";
import { delayedRomFixture, syntheticFixture, type SyntheticKind } from "./fixtures.js";

const romDirectory = process.argv[2];
if (!romDirectory) throw new Error("Usage: decision-regression.ts <ROM directory> [sidlite[,residfp]]");
const ENGINES = (process.argv[3] ?? "sidlite").split(",") as RomAuditEngine[];
if (ENGINES.some(e => !(ROM_AUDIT_ENGINES as readonly string[]).includes(e))) throw new Error("Invalid engine list");
const roms = loadRoms(romDirectory);
const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const corpus = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../workspace/hvsc/C64Music");
type Expectation = { m0: Compatibility; m3: Compatibility; m7: Compatibility; residfp?: Partial<{ m0: Compatibility; m3: Compatibility; m7: Compatibility }> };
interface Case { name: string; bytes: Buffer; song?: number; token: string; expect: Expectation; check?: (run: EngineRun, engine: string) => void; deadline: number }
const seconds = (token: string): number => observationHorizon(token, 10).seconds;
const cases: Case[] = [];
// Dependencies read at ~70 s. Without KERNAL the engine's interrupt shim shifts every SID write by a few cycles,
// so the "nothing supplied" set is unknown for every program; that is measured behavior, asserted here.
for (const dependency of [1, 2, 4, 7]) {
  const bank = (dependency & 4) !== 0;   // CHARGEN content is never supplied by the consumer
  cases.push({ name: `late-${dependency}-visible`, bytes: delayedRomFixture(dependency, { frames: 3500 }), token: "1:15", deadline: seconds("1:15"),
    expect: { m0: "unknown", m3: bank ? "unknown" : "compatible", m7: "compatible" } });
  cases.push({ name: `late-${dependency}-beyond-horizon`, bytes: delayedRomFixture(dependency, { frames: 3500 }), token: "1:00", deadline: 65,
    expect: { m0: "unknown", m3: "compatible", m7: "compatible" } });
}
// A CHARGEN read inside the 5 s ending margin (63 s) must be seen; one just after it (66 s) must not.
cases.push({ name: "margin-inside", bytes: delayedRomFixture(4, { frames: 3150 }), token: "1:00", deadline: 65, expect: { m0: "unknown", m3: "unknown", m7: "compatible" } });
cases.push({ name: "margin-after", bytes: delayedRomFixture(4, { frames: 3300 }), token: "1:00", deadline: 65, expect: { m0: "unknown", m3: "compatible", m7: "compatible" } });
const synthetic = (kind: SyntheticKind, token: string, expect: Expectation, options: { frames?: number; mask?: number } = {}, check?: Case["check"]): void => {
  cases.push({ name: kind + (options.mask ? `-rom${options.mask}` : ""), bytes: syntheticFixture(kind, options), token, expect, check, deadline: seconds(token) });
};
synthetic("silent-divergence", "0:05", { m0: "unknown", m3: "compatible", m7: "compatible" }, { frames: 100 });
// Volume 0, so PCM is equal; only the final per-frame write is missing when BASIC is absent. Must never be identical.
synthetic("silent-tail", "0:05", { m0: "unknown", m3: "compatible", m7: "compatible" }, { frames: 100 }, run => {
  const none = run.lanes.filter(l => l.set === "none");
  if (none.some(l => l.outcome === "identical")) throw new Error("silent-tail: a variant with missing writes was reported identical");
});
synthetic("sparse-sfx", "1:00", { m0: "unknown", m3: "compatible", m7: "compatible" }, { frames: 2500 });
synthetic("silence", "0:05", { m0: "unknown", m3: "compatible", m7: "compatible" });
// The reSIDfp build throws an exception without a message when the CPU halts, so it cannot prove the halt: unknown, never incompatible.
synthetic("halt-without-basic", "0:05", { m0: "incompatible", m3: "compatible", m7: "compatible", residfp: { m0: "unknown" } });
// An RSID that masks interrupts and never calls the KERNAL does not depend on it, so even nothing-supplied is identical; 2M+ writes are compared without truncation.
synthetic("busy-writes", "0:10", { m0: "compatible", m3: "compatible", m7: "compatible" }, {}, run => { if (run.reference.writes < 2_000_000) throw new Error(`busy-writes produced only ${run.reference.writes} writes`); });
synthetic("osc3-reader", "0:05", { m0: "unknown", m3: "compatible", m7: "compatible" }, { frames: 100 });
synthetic("second-sid-late", "0:05", { m0: "unknown", m3: "unknown", m7: "compatible" }, { frames: 100, mask: 4 });
synthetic("third-sid-late", "0:05", { m0: "unknown", m3: "compatible", m7: "compatible" }, { frames: 100, mask: 2 });

const selection = (mask: number): RomSelection => ({ kernal: mask & 1 ? REFERENCE_ROM_SHA256.kernal : null, basic: mask & 2 ? REFERENCE_ROM_SHA256.basic : null, chargen: mask & 4 ? REFERENCE_ROM_SHA256.chargen : null });
const digest: Record<string, unknown> = {};
const only = process.env.ROM_DECISION_ONLY ? new RegExp(process.env.ROM_DECISION_ONLY) : undefined;   // iteration aid; harden.ts never sets it
function verify(name: string, bytes: Buffer, song: number, token: string, expect: Expectation, deadline: number, runs: EngineRun[], check?: Case["check"]): void {
  const horizon = observationHorizon(token, 10), observed = horizon.seconds;
  const record = { schema: CENSUS_SCHEMA, sha256: sha(bytes), song, seconds: observed, sampleRate: SAMPLE_RATE, runs } as const;
  validateRecord({ ...record, runs: [...runs] }, ENGINES);
  const results: string[] = [];
  runs.forEach((run, index) => {
    const engine = ENGINES[index]!, hashes = engineHashes(engine), profile = romConsumerProfile(engine);
    check?.(run, engine);
    if (run.reference.repeat !== "identical") throw new Error(`${name}/${engine}: the reference is not reproducible (${run.reference.repeat})`);
    const decisions = ([0, 1, 2, 3, 4, 5, 6, 7] as const).map(mask => assessMask(run, horizon, observed, SAMPLE_RATE, mask));
    const wantedFor = { ...expect, ...(engine === "residfp" ? expect.residfp : {}) };
    for (const [mask, wanted] of [[0, wantedFor.m0], [3, wantedFor.m3], [7, wantedFor.m7]] as const)
      if (decisions[mask]!.state !== wanted) throw new Error(`${name}/${engine} mask ${mask}: expected ${wanted}, decided ${decisions[mask]!.state} (${decisions[mask]!.reason}); lanes ${JSON.stringify(run.lanes.map(l => `${l.set}/${l.fill}:${l.outcome}`))}`);
    for (const mask of [1, 2, 4, 5, 6]) if (decisions[mask]!.state !== "unknown") throw new Error(`${name}/${engine}: unsupported ROM set ${mask} was decided`);
    // Production projection: the lookup must agree with every decision, enforce the deadline and deny unsupported sets.
    const bits = (state: Compatibility): number => decisions.reduce((n, d, mask) => (d.state === state ? n | 1 << mask : n), 0);
    const compatible = bits("compatible");
    const deny: RomDenyList = { schema: ROM_DENY_SCHEMA, engineId: romEngineId(hashes, profile), romSetId: romSetId(), methodology: METHODOLOGY,
      entries: { [record.sha256]: [[compatible, bits("incompatible"), compatible ? Math.round(observed * 1000) : 0, compatible && horizon.documentedSeconds ? Math.round(horizon.documentedSeconds * 1000) : 0]] } };
    const lookup = createRomEligibilityLookup(deny, { ...hashes, profile, methodology: METHODOLOGY });
    for (let mask = 0; mask < 8; mask++) {
      const answer = lookup(record.sha256, song, selection(mask));
      if (answer.state !== decisions[mask]!.state) throw new Error(`${name}/${engine} mask ${mask}: lookup disagrees with assessMask`);
      if (answer.eligible) {
        if (answer.maxPlaybackSeconds !== deadline) throw new Error(`${name}: deadline ${answer.maxPlaybackSeconds}, expected ${deadline}`);
        if (lookup(record.sha256, song, selection(mask), deadline).eligible) throw new Error(`${name}: playback allowed at the deadline`);
        if (!lookup(record.sha256, song, selection(mask), deadline - 0.001).eligible) throw new Error(`${name}: playback denied before the deadline`);
      }
    }
    results.push(`${engine}:${decisions[0]!.state[0]}${decisions[3]!.state[0]}${decisions[7]!.state[0]}`);
    digest[`${name}/${engine}`] = { states: decisions.map(d => `${d.state}:${d.reason}`), reference: [run.reference.samples, run.reference.writes, run.reference.pcmSha256.slice(0, 12), run.reference.traceSha256.slice(0, 12)],
      lanes: run.lanes.map(l => `${l.set}/${l.fill}:${l.outcome}:${l.samples}:${l.writes}:${l.firstDifferenceSample}`) };
  });
  console.log(`PASS ${name}: ${results.join(" ")} (masks 0,3,7; c=compatible i=incompatible u=unknown)`);
}

for (const c of cases) {
  if (only && !only.test(c.name)) continue;
  const song = c.song ?? 1, observed = observationHorizon(c.token, 10).seconds;
  const runs: EngineRun[] = [];
  for (const engine of ENGINES) runs.push(await runEngine(engine, c.bytes, song, observed, roms));
  verify(c.name, c.bytes, song, c.token, c.expect, c.deadline, runs, c.check);
}

// Real subtunes that exposed comparator defects in the pilot: the reference compared with a fresh instance of itself
// must be identical however many lanes are alive (engine output is a view into memory the next call overwrites).
if (!only || only.test("real")) {
  for (const [file, song, token] of [["GAMES/M-R/Out_on_a_Limb.sid", 8, "0:05"], ["DEMOS/A-F/Baroque_Music_64_BASIC.sid", 1, "0:56"]] as const) {
    const bytes = readFileSync(path.join(corpus, file)), observed = observationHorizon(token, 10).seconds;
    for (const engine of ENGINES) {
      const run = await runEngine(engine, bytes, song, observed, roms);
      if (run.reference.outcome !== "clean" || run.reference.repeat !== "identical") throw new Error(`${file} #${song}/${engine}: reference ${JSON.stringify(run.reference)}`);
      const full = run.lanes.filter(l => l.set === "full");
      if (!full.every(l => l.outcome === "identical")) throw new Error(`${file} #${song}/${engine}: full-set lanes ${JSON.stringify(full.map(l => l.outcome))}`);
      digest[`real:${file}#${song}/${engine}`] = run.lanes.map(l => `${l.set}/${l.fill}:${l.outcome}:${l.samples}`);
    }
    console.log(`PASS real ${file} #${song}: reference reproducible and full ROM set identical on every census engine`);
  }
}
// Commander's "nothing supplied" never calls the engine's ROM setter; our none-lanes call it with (null, fill, fill).
// In a fresh instance the untouched banks must behave exactly like the zero-filled ones for the lane to stand in for it.
if (!only || only.test("untouched")) {
  for (const [name, bytes, song, token] of [["silence", syntheticFixture("silence"), 1, "0:05"], ["halt-without-basic", syntheticFixture("halt-without-basic"), 1, "0:05"],
    ["busy-writes", syntheticFixture("busy-writes"), 1, "0:05"], ["Out_on_a_Limb", readFileSync(path.join(corpus, "GAMES/M-R/Out_on_a_Limb.sid")), 8, "0:05"],
    ["Commando", readFileSync(path.join(corpus, "MUSICIANS/H/Hubbard_Rob/Commando.sid")), 1, "0:05"]] as const) {
    const observed = observationHorizon(token, 10).seconds;
    for (const engine of ENGINES) {
      const untouched = await renderDigest(engine, bytes, song, observed, UNTOUCHED, roms);
      const zero = await renderDigest(engine, bytes, song, observed, { kernal: "null", basic: "zero", chargen: "zero" }, roms);
      if (JSON.stringify(untouched) !== JSON.stringify(zero)) throw new Error(`${name}/${engine}: untouched banks differ from the zero-filled none lane: ${JSON.stringify([untouched, zero])}`);
      const suppliedNull = await renderDigest(engine, bytes, song, observed, { kernal: "authentic", basic: "authentic", chargen: "null" }, roms);   // Commander: setSystemROMs(K, B, null)
      const suppliedZero = await renderDigest(engine, bytes, song, observed, { kernal: "authentic", basic: "authentic", chargen: "zero" }, roms);
      if (JSON.stringify(suppliedNull) !== JSON.stringify(suppliedZero)) throw new Error(`${name}/${engine}: a null CHARGEN differs from the zero-filled full lane: ${JSON.stringify([suppliedNull, suppliedZero])}`);
      digest[`untouched:${name}/${engine}`] = [untouched.samples, untouched.writes, untouched.pcmSha256.slice(0, 12), untouched.ended];
    }
    console.log(`PASS untouched null banks behave like the zero-filled none lane: ${name}`);
  }
}
console.log("DIGEST " + sha(JSON.stringify(digest)));
