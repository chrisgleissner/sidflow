#!/usr/bin/env bun
/**
 * Decision-path regression: synthetic PSID/RSID programs with known ROM behavior go
 * through the same stages as a corpus subtune: native screening, shipping-engine
 * confirmation, assess(), the deny-list tuple and the production lookup. Each case
 * states the decision expected for all eight ROM masks. The final line is a
 * deterministic JSON digest of every decision, so the release and AddressSanitizer
 * binaries can be compared byte for byte.
 *
 *   bun scripts/rom-audit/decision-regression.ts <renderer> <ROM dir>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRomEligibilityLookup, REFERENCE_ROM_SHA256, ROM_CONSUMER_PROFILE, romEngineId, romSetId, type RomDenyList, type RomSelection } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { assess, observationHorizon, screen, validateMatrix, METHODOLOGY, type Compatibility } from "./methodology.js";
import { bindConfirmation, candidateMasks, confirmMasks, verdictFromConfirmation, type MaskResult, type RomImages } from "./confirm.js";
import { delayedRomFixture, syntheticFixture, type SyntheticKind } from "./fixtures.js";
import type { Execution } from "./analysis.js";

const [renderer, romDirectory] = process.argv.slice(2);
if (!renderer || !romDirectory) throw new Error("Usage: decision-regression.ts <renderer> <ROM dir>");
const sha = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const rom = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(romDirectory, name)));
const roms: RomImages = { kernal: rom("kernal.901227-03.bin"), basic: rom("basic.901226-01.bin"), chargen: rom("characters.901225-01.bin") };
type Expectation = Compatibility | ((mask: number) => Compatibility);
interface Case {
  name: string; bytes: Buffer; song?: number; token: string; expect: Expectation;
  /** Extra assertions on the native reference row. */
  check?: (row: Execution) => void;
  /** Expected maxPlaybackSeconds for compatible masks. */
  deadline: number;
}
// Without the KERNAL the engine runs its own interrupt shim, which shifts every SID write by a few
// cycles. Cycle-exact equality therefore never holds for masks without bit 1, whatever the program
// does; that is the "one-cycle shift" class and is asserted here as an expectation, not worked around.
const withKernal = (inner: (mask: number) => Compatibility) => (mask: number): Compatibility => (mask & 1 ? inner(mask) : "unknown");
const lacks = (dependency: number) => withKernal(mask => ((mask & dependency) === dependency ? "compatible" : "unknown"));
const horizonSeconds = (token: string): number => observationHorizon(token, 10).seconds;
const cases: Case[] = [];
for (const dependency of [1, 2, 4, 7]) {
  // Dependency first read at ~70 s. A 75 s composition observes it; a 60 s composition (65 s horizon) cannot.
  cases.push({ name: `late-${dependency}-visible`, bytes: delayedRomFixture(dependency, { frames: 3500 }), token: "1:15", expect: lacks(dependency), deadline: horizonSeconds("1:15") });
  cases.push({ name: `late-${dependency}-beyond-horizon`, bytes: delayedRomFixture(dependency, { frames: 3500 }), token: "1:00", expect: withKernal(() => "compatible"), deadline: 65 });
}
// Trigger inside the 5 s ending margin (63 s) must be seen; just after it (66 s) must not.
cases.push({ name: "margin-inside", bytes: delayedRomFixture(2, { frames: 3150 }), token: "1:00", expect: lacks(2), deadline: 65 });
cases.push({ name: "margin-after", bytes: delayedRomFixture(2, { frames: 3300 }), token: "1:00", expect: withKernal(() => "compatible"), deadline: 65 });
const synthetic = (kind: SyntheticKind, token: string, expect: Expectation, options: { frames?: number; mask?: number } = {},
  check?: (row: Execution) => void): void => {
  cases.push({ name: kind, bytes: syntheticFixture(kind, options), token, expect, check, deadline: horizonSeconds(token) });
};
// Output changes only when KERNAL and BASIC are both absent: masks 1,3,5,7 (KERNAL present) all equal the reference.
synthetic("combined-only", "0:05", withKernal(() => "compatible"));
// Output changes when exactly one of KERNAL/BASIC is present: with KERNAL present, BASIC absent (masks 1,5) differs.
synthetic("exactly-one", "0:05", withKernal(mask => ((mask & 2) === 0 ? "unknown" : "compatible")));
synthetic("silent-divergence", "0:05", withKernal(mask => (mask & 2 ? "compatible" : "unknown")), { frames: 100 }, row => {
  const m = row.matrix![1]!;   // KERNAL only: BASIC byte differs, volume is 0
  if (!m.equal) throw new Error("silent-divergence: PCM must be equal while the write trace differs");
});
synthetic("sparse-sfx", "1:00", withKernal(() => "compatible"), { frames: 2500 }, row => { if (row.both.sidWrites < 3 || row.both.sidWrites > 12) throw new Error(`sparse-sfx wrote ${row.both.sidWrites} registers`); });
synthetic("silence", "0:05", "compatible", {}, row => { if (row.both.sidWrites > 1) throw new Error("silence wrote SID registers beyond the engine driver's own volume write"); });
synthetic("halt-without-basic", "0:05", mask => (mask & 2 ? (mask & 1 ? "compatible" : "unknown") : "incompatible"));
synthetic("busy-writes", "0:10", "unknown", {}, row => { if (row.both.traceComplete) throw new Error("busy-writes must overflow the trace cap"); });
synthetic("osc3-reader", "0:05", withKernal(() => "compatible"), { frames: 100 }, row => { if (!(row.both.sidReadbackReads! > 0)) throw new Error("osc3-reader not flagged by the readback counter"); });
synthetic("second-sid-late", "0:05", lacks(1), { frames: 100, mask: 1 });
synthetic("third-sid-late", "0:05", lacks(2), { frames: 100, mask: 2 });

const selection = (mask: number): RomSelection => ({
  kernal: mask & 1 ? REFERENCE_ROM_SHA256.kernal : null, basic: mask & 2 ? REFERENCE_ROM_SHA256.basic : null, chargen: mask & 4 ? REFERENCE_ROM_SHA256.chargen : null });
const temp = mkdtempSync(path.join(tmpdir(), "rom-decision-"));
const digest: Record<string, unknown> = {};
try {
  const only = process.env.ROM_DECISION_ONLY ? new RegExp(process.env.ROM_DECISION_ONLY) : undefined;   // iteration aid; harden.ts never sets it
  for (const c of cases) {
    if (only && !only.test(c.name)) continue;
    const horizon = observationHorizon(c.token, 10), song = c.song ?? 1;
    const input = `${path.join(temp, "x.sid")}\t${song}\t${horizon.seconds}\thex:${c.bytes.toString("hex")}\n`;
    const result = spawnSync(path.resolve(renderer), [romDirectory], { input, encoding: "utf8", timeout: 3600000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:halt_on_error=1", UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1" } });
    if (result.status !== 0) throw new Error(`${c.name}: native renderer failed (${result.status}/${result.signal}): ${result.stderr}`);
    const row = JSON.parse(result.stdout.trim()) as Execution;
    validateMatrix(row);
    c.check?.(row);
    const candidates = candidateMasks(row, horizon);
    const shipping = candidates.length ? await confirmMasks(c.bytes, song, row.seconds, candidates, roms) : [];
    bindConfirmation(shipping, row);
    const decisions = Array.from({ length: 8 }, (_, mask) => {
      const candidate = screen(row.matrix![mask], row.both, row.repeat, row.seconds, horizon).state;
      const confirmation = verdictFromConfirmation(candidate, shipping.find(r => r.mask === mask), row, mask);
      return assess(row.matrix![mask], row.both, row.repeat, row.seconds, horizon, confirmation);
    });
    const compatibleBits = decisions.reduce((n, d, mask) => (d.state === "compatible" ? n | 1 << mask : n), 0);
    const incompatibleBits = decisions.reduce((n, d, mask) => (d.state === "incompatible" ? n | 1 << mask : n), 0);
    for (let mask = 0; mask < 8; mask++) {
      const wanted = typeof c.expect === "function" ? c.expect(mask) : c.expect;
      if (decisions[mask]!.state !== wanted)
        throw new Error(`${c.name} mask ${mask}: expected ${wanted}, decided ${decisions[mask]!.state} (${decisions[mask]!.reason}); native ${JSON.stringify(shipping.find(r => r.mask === mask) ?? null)}`);
    }
    // Production projection: the lookup must agree with every decision and enforce the deadline.
    const engine = { sourceSha256: "1".repeat(64), wasmSha256: "2".repeat(64) };
    const identity = sha(c.bytes);
    const deny: RomDenyList = { schema: "sidflow-rom-deny-3", engineId: romEngineId(engine), romSetId: romSetId(), methodology: METHODOLOGY,
      entries: { [identity]: [[compatibleBits, incompatibleBits, compatibleBits ? Math.round(row.seconds * 1000) : 0, compatibleBits && horizon.documentedSeconds ? Math.round(horizon.documentedSeconds * 1000) : 0]] } };
    const lookup = createRomEligibilityLookup(deny, { ...engine, profile: ROM_CONSUMER_PROFILE, methodology: METHODOLOGY });
    for (let mask = 0; mask < 8; mask++) {
      const answer = lookup(identity, song, selection(mask));
      if (answer.state !== decisions[mask]!.state) throw new Error(`${c.name} mask ${mask}: lookup disagrees with assess`);
      if (answer.eligible) {
        if (answer.maxPlaybackSeconds !== c.deadline) throw new Error(`${c.name}: deadline ${answer.maxPlaybackSeconds}, expected ${c.deadline}`);
        if (lookup(identity, song, selection(mask), c.deadline).eligible) throw new Error(`${c.name}: playback allowed at the deadline`);
        if (!lookup(identity, song, selection(mask), c.deadline - 0.001).eligible) throw new Error(`${c.name}: playback denied before the deadline`);
      }
    }
    console.log(`PASS ${c.name}: ${decisions.map(d => d.state[0]).join("")} (masks 0..7; c=compatible i=incompatible u=unknown)`);
    digest[c.name] = { states: decisions.map(d => `${d.state}:${d.reason}`), sidWrites: row.both.sidWrites, readback: row.both.sidReadbackReads,
      shipping: shipping.map((r: MaskResult) => `${r.mask}:${r.outcome}:${r.samples}:${r.writes}:${r.pcmSha256.slice(0, 12)}:${r.traceSha256.slice(0, 12)}`) };
  }
  console.log("DIGEST " + sha(JSON.stringify(digest)));
  writeFileSync(path.join(temp, "digest.json"), JSON.stringify(digest));
} finally { rmSync(temp, { recursive: true, force: true }); }

