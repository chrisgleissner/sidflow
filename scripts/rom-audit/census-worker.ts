#!/usr/bin/env bun
/** Census worker process: reads one JSON job per line on stdin, writes one CensusRecord per line.
 *   bun scripts/rom-audit/census-worker.ts <ROM directory>
 * A job that throws is reported as a failure record instead of killing the worker.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { REFERENCE_ROM_SHA256, type RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { CENSUS_SCHEMA, type CensusRecord, type EngineRun } from "./methodology.js";
import { runListenerEngine, SAMPLE_RATE, type RomImages } from "./wasm-lanes.js";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export interface CensusJob { sha256: string; song: number; seconds: number; engines: RomAuditEngine[]; extended: boolean; hex: string }
export async function runJob(job: CensusJob, roms: RomImages): Promise<CensusRecord> {
  const header = { schema: CENSUS_SCHEMA, sha256: job.sha256, song: job.song, seconds: job.seconds, sampleRate: SAMPLE_RATE } as const;
  try {
    const bytes = Buffer.from(job.hex, "hex");
    if (sha(bytes) !== job.sha256) throw new Error("Job input checksum mismatch");
    const runs: EngineRun[] = [];
    for (const engine of job.engines) runs.push(await runListenerEngine(engine, bytes, job.song, job.seconds, roms, job.extended));
    return { ...header, runs };
  } catch (error) {
    console.error(`census job ${job.sha256.slice(0, 12)}#${job.song} failed: ${error instanceof Error ? error.stack : String(error)}`);
    return { ...header, runs: [], failure: { reason: "exception", message: error instanceof Error ? error.message : String(error) } };
  }
}
export function loadRoms(directory: string): RomImages {
  const read = (name: string, expected: string): Uint8Array => {
    const bytes = new Uint8Array(readFileSync(path.join(directory, name)));
    if (sha(bytes) !== expected) throw new Error(`${name} is not the reference image`);
    return bytes;
  };
  return { kernal: read("kernal.901227-03.bin", REFERENCE_ROM_SHA256.kernal), basic: read("basic.901226-01.bin", REFERENCE_ROM_SHA256.basic),
    chargen: read("characters.901225-01.bin", REFERENCE_ROM_SHA256.chargen) };
}
if (import.meta.main) {
  const directory = process.argv[2];
  if (!directory) throw new Error("Usage: census-worker.ts <ROM directory>");
  const roms = loadRoms(directory);
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    const record = await runJob(JSON.parse(line) as CensusJob, roms);
    process.stdout.write(stringifyDeterministic(record as unknown as JsonValue, 0).trimEnd() + "\n");
  }
}
