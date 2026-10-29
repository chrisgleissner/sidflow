/** Candidate pool and cheap (trace-only) classification scan for the calibration corpus.
 *
 *   bun scripts/rom-grade/candidates.ts scan [--limit N]
 *
 * Pools (all deterministic, ordered by SHA-256 of "<file sha>#<song>"):
 *   benchmark   the stratified 320-job benchmark
 *   census-bad  census rows where some engine judged the no-ROM lane incompatible (listener-v1)
 *   census-ok   census rows judged compatible everywhere
 *   inventory   header/horizon-stratified draws from the whole 87,868-subtune inventory
 * Output: workspace/rom-grade-calibration/candidates.jsonl (append-only, resumable). */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { horizonBand, loadInventory, type HorizonBand, type Inventory } from "./inventory.js";
import { nativePaths, readSid, traceLane, workspaceRoot, type RomMask } from "./native.js";
import { sidInfo } from "./sid-info.js";
import { classify, clockHzOf, computeTraceFeatures, type TraceFeatures } from "./trace-core.js";

export interface Candidate {
  path: string; song: number; seconds: number; sha256: string; pool: string;
  kind: string; clock: string; model: string; chips: number; band: HorizonBand;
}
export interface ScanLane { features: TraceFeatures; cpuSeconds: number }
export interface ScanEngine { referenceWrites: number; referenceChargenReads: number; referenceDigi: boolean; lanes: Record<string, ScanLane> }
export interface ScanRow extends Candidate { engines: Record<string, ScanEngine>; censusStates: Record<string, string> | null }

export const candidateKey = (c: { sha256: string; song: number }): string => createHash("sha256").update(`${c.sha256}#${c.song}`).digest("hex");
export const scanPath = (): string => path.join(nativePaths().output, "candidates.jsonl");

interface CensusRow { sha256: string; song: number; seconds: number; result: { engines: Array<{ engine: string; states: Record<string, string> }> } }

export function loadCensus(): CensusRow[] {
  const file = path.join(workspaceRoot(), "rom-audit-sample/census.jsonl");
  return readFileSync(file, "utf8").trim().split("\n").map(line => (JSON.parse(line) as { row: CensusRow }).row);
}
export function censusStates(row: CensusRow): Record<string, string> {
  const states: Record<string, string> = {};
  for (const e of row.result.engines) for (const [lane, state] of Object.entries(e.states)) states[`${e.engine}/${lane}`] = state;
  return states;
}

export function buildCandidates(inventory: Inventory): Candidate[] {
  const bySha = new Map(inventory.tunes.map(t => [t.sha256, t]));
  const make = (sha: string, song: number, pool: string): Candidate => {
    const tune = bySha.get(sha);
    if (!tune) throw new Error(`Unknown file ${sha}`);
    const entry = tune.songsList.find(s => s.song === song);
    if (!entry) throw new Error(`Unknown subtune ${tune.path}#${song}`);
    return { path: tune.path, song, seconds: entry.seconds, sha256: sha, pool, kind: tune.kind, clock: tune.clockDeclared, model: tune.model, chips: tune.chips, band: horizonBand(entry.seconds, entry.documented) };
  };
  const seen = new Set<string>(), out: Candidate[] = [];
  const add = (c: Candidate): void => { const k = `${c.sha256}#${c.song}`; if (!seen.has(k)) { seen.add(k); out.push(c); } };
  const ordered = <T extends { sha256: string; song: number }>(items: T[]): T[] => items.map(i => [candidateKey(i), i] as const).sort((a, b) => a[0] < b[0] ? -1 : 1).map(x => x[1]);
  const workspace = workspaceRoot();
  const benchmark = JSON.parse(readFileSync(path.join(workspace, "rom-audit-sample/benchmark.json"), "utf8")) as { measured: Array<{ job: { sha256: string; song: number } }> };
  for (const m of benchmark.measured) add(make(m.job.sha256, m.job.song, "benchmark"));
  const census = loadCensus();
  const bad = census.filter(r => r.result.engines.some(e => e.states.none === "incompatible") && r.seconds <= 600);
  for (const r of ordered(bad).slice(0, 700)) add(make(r.sha256, r.song, "census-bad"));
  const ok = census.filter(r => r.result.engines.every(e => e.states.none === "compatible") && r.seconds <= 600);
  for (const r of ordered(ok).slice(0, 150)) add(make(r.sha256, r.song, "census-ok"));
  // Header/horizon stratified draws from the whole inventory.
  const groups = new Map<string, Candidate[]>();
  for (const tune of inventory.tunes) for (const s of tune.songsList) {
    if (s.seconds > 900) continue;
    const c = make(tune.sha256, s.song, "inventory");
    const key = [c.kind, c.band, c.clock, c.model, c.chips].join("|");
    const g = groups.get(key) ?? []; g.push(c); groups.set(key, g);
  }
  for (const key of [...groups.keys()].sort()) for (const c of ordered(groups.get(key)!).slice(0, 4)) add(c);
  return out;
}

async function scanOne(c: Candidate): Promise<ScanRow> {
  const file = path.join(nativePaths().hvsc, c.path);
  const bytes = readSid(file), info = sidInfo(bytes), clockHz = clockHzOf(info.clock);
  const engines: Record<string, ScanEngine> = {};
  await Promise.all((["residfp", "sidlite"] as RomAuditEngine[]).map(async engine => {
    const reference = await traceLane(engine, bytes, c.song, c.seconds, 7);
    const lanes: Record<string, ScanLane> = {};
    const masks: Array<[string, RomMask]> = [["none", 0], ["kernal+basic", 3]];
    for (const [name, mask] of masks) {
      if (mask === 3 && reference.chargenReads === 0) continue;
      const variant = await traceLane(engine, bytes, c.song, c.seconds, mask);
      lanes[name] = { features: computeTraceFeatures(reference.trace, variant.trace, { clockHz, horizonSeconds: c.seconds }), cpuSeconds: variant.cpuSeconds };
    }
    const anyLane = Object.values(lanes)[0]!;
    engines[engine] = { referenceWrites: anyLane.features.referenceWrites, referenceChargenReads: reference.chargenReads, referenceDigi: anyLane.features.referenceDigi, lanes };
  }));
  return { ...c, engines, censusStates: null };
}

/** Rows as scanned, with the trace class re-derived from the stored features by the current rules. */
export function loadScan(): ScanRow[] {
  if (!existsSync(scanPath())) return [];
  const rows = readFileSync(scanPath(), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as ScanRow);
  for (const row of rows) for (const engine of Object.values(row.engines)) for (const lane of Object.values(engine.lanes)) {
    const verdict = classify(lane.features);
    lane.features = { ...lane.features, cls: verdict.cls, bSubclass: verdict.bSubclass, rule: verdict.rule };
  }
  return rows;
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command !== "scan") throw new Error("usage: candidates.ts scan [--limit N]");
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Infinity;
  const inventory = await loadInventory();
  const candidates = buildCandidates(inventory);
  const done = new Set(loadScan().map(r => `${r.sha256}#${r.song}`));
  mkdirSync(path.dirname(scanPath()), { recursive: true });
  const todo = candidates.filter(c => !done.has(`${c.sha256}#${c.song}`)).slice(0, limit);
  console.error(`candidates ${candidates.length}, already scanned ${done.size}, scanning ${todo.length}`);
  const states = new Map(loadCensus().map(r => [`${r.sha256}#${r.song}`, censusStates(r)]));
  let finished = 0;
  const concurrency = 10;
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let i = next++; i < todo.length; i = next++) {
      const c = todo[i]!;
      try {
        const row = await scanOne(c);
        row.censusStates = states.get(`${c.sha256}#${c.song}`) ?? null;
        appendFileSync(scanPath(), JSON.stringify(row) + "\n");
      } catch (error) {
        console.error(`scan failed ${c.path}#${c.song}:`, error);
      }
      if (++finished % 25 === 0) console.error(`scanned ${finished}/${todo.length}`);
    }
  }));
}
