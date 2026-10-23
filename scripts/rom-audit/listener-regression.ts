/** Real-engine listener controls; included in the hardening decision digest. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { runListenerEngine, SAMPLE_RATE, engineHashes } from "./wasm-lanes.js";
import type { RomImages } from "./wasm-lanes.js";
import { delayedRomFixture, syntheticFixture } from "./fixtures.js";
import { assessMask, observationHorizon, validateRecord, CENSUS_SCHEMA, METHODOLOGY } from "./methodology.js";
import { createHash } from "node:crypto";
import { createRomEligibilityLookup, romConsumerProfile, romEngineId, romSetId, ROM_DENY_SCHEMA, REFERENCE_ROM_SHA256, type RomDenyList } from "../../packages/sidflow-common/src/rom-eligibility.js";

export async function listenerControls(roms: RomImages): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const corpus = path.resolve(import.meta.dir, "../../workspace/hvsc/C64Music");
  const cases = [
    { name: "silent-halt", bytes: syntheticFixture("silent-halt"), token: "0:05", none: "compatible", full: "compatible" },
    { name: "halt-missing-held-note", bytes: syntheticFixture("halt-without-basic"), token: "0:05", none: "incompatible", full: "compatible" },
    { name: "silence", bytes: syntheticFixture("silence"), token: "0:05", none: "compatible", full: "compatible" },
    { name: "silent-divergence", bytes: syntheticFixture("silent-divergence", { frames: 100 }), token: "0:05", none: "compatible", full: "compatible" },
    { name: "silent-tail", bytes: syntheticFixture("silent-tail", { frames: 100 }), token: "0:05", none: "compatible", full: "compatible" },
    { name: "chargen-late", bytes: delayedRomFixture(4, { frames: 150 }), token: "0:05", none: "incompatible", full: "incompatible" },
    { name: "basic-late", bytes: delayedRomFixture(2, { frames: 150 }), token: "0:05", none: "incompatible", full: "compatible" },
    { name: "margin-inside", bytes: delayedRomFixture(4, { frames: 3150 }), token: "1:00", none: "incompatible", full: "incompatible" },
    { name: "margin-after", bytes: delayedRomFixture(4, { frames: 3300 }), token: "1:00", none: "compatible", full: "compatible" },
    { name: "second-sid", bytes: syntheticFixture("second-sid-late", { frames: 100, mask: 4 }), token: "0:05", none: "incompatible", full: "incompatible" },
    { name: "Commando", bytes: readFileSync(path.join(corpus, "MUSICIANS/H/Hubbard_Rob/Commando.sid")), token: "0:05", none: "compatible", full: "compatible" },
    { name: "Baroque_BASIC", bytes: readFileSync(path.join(corpus, "DEMOS/A-F/Baroque_Music_64_BASIC.sid")), token: "0:56", none: "incompatible", full: "compatible" },
  ];
  for (const test of cases) {
    const seconds = observationHorizon(test.token).seconds;
    const run = await runListenerEngine("sidlite", test.bytes, 1, seconds, roms, true);
    const sha256 = createHash("sha256").update(test.bytes).digest("hex");
    validateRecord({ schema: CENSUS_SCHEMA, sha256, song: 1, seconds, sampleRate: SAMPLE_RATE, runs: [run] }, ["sidlite"]);
    const decisions = [0, 3].map(mask => assessMask(run, observationHorizon(test.token), seconds, SAMPLE_RATE, mask));
    if (decisions[0]!.state !== test.none || decisions[1]!.state !== test.full)
      throw new Error(`${test.name}: expected ${test.none}/${test.full}, got ${JSON.stringify(decisions)}; ${JSON.stringify(run.lanes)}`);
    const bits = (state: string): number => (decisions[0]!.state === state ? 1 : 0) | (decisions[1]!.state === state ? 8 : 0);
    const allowed = bits("compatible"), hashes = engineHashes("sidlite"), profile = romConsumerProfile("sidlite");
    const data: RomDenyList = { schema: ROM_DENY_SCHEMA, methodology: METHODOLOGY, engineId: romEngineId(hashes, profile), romSetId: romSetId(),
      entries: { [sha256]: [[allowed, bits("incompatible"), allowed ? Math.round(seconds * 1000) : 0, allowed ? Math.round(observationHorizon(test.token).documentedSeconds! * 1000) : 0, 0]] } };
    const lookup = createRomEligibilityLookup(data, { ...hashes, profile, methodology: METHODOLOGY, fallbackSidModel: "MOS8580" });
    for (const [index, mask] of [0, 3].entries()) {
      const romSet = { kernal: mask ? REFERENCE_ROM_SHA256.kernal : null, basic: mask ? REFERENCE_ROM_SHA256.basic : null, chargen: null };
      if (lookup(sha256, 1, romSet).state !== decisions[index]!.state) throw new Error(`${test.name}: lookup disagreement`);
      if (lookup(sha256, 1, romSet, seconds).eligible) throw new Error(`${test.name}: allowed past horizon`);
    }
    results[test.name] = { decisions, lanes: run.lanes, reference: run.reference };
    console.log(`PASS listener ${test.name}: ${decisions.map(d => d.state).join("/")}`);
  }
  return results;
}
