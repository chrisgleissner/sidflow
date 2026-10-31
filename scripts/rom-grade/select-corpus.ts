/** Deterministic calibration-corpus selection.
 *
 *   bun scripts/rom-grade/select-corpus.ts            (reads the candidate scan, writes doc/research/hvsc-rom-grading-corpus.json)
 *
 * The scan (candidates.ts) classifies a few thousand candidate subtunes by trace features only.
 * Every candidate lane belongs to cells of the design's taxonomy:
 *   trace class x file kind, trace class x ROM configuration, trace class x engine,
 *   engine disagreement, horizon band, SID model, clock, digi, chip count, CHARGEN readers.
 * Selection is a greedy set cover: cells are filled in order of scarcity to QUOTA exemplars (fewer
 * if fewer exist), each pick maximising the weighted number of still-open cells it covers, ties
 * broken by the SHA-256 key. The output lists, for every cell, its availability and exemplars, and
 * the cells that stayed empty with how emptiness was established. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { candidateKey, loadScan, type ScanRow } from "./candidates.js";
import { horizonBand, loadInventory } from "./inventory.js";
import { repositoryRoot } from "./native.js";

export const QUOTA = 3;
export const CORPUS_PATH = path.join(repositoryRoot, "doc/research/hvsc-rom-grading-corpus.json");

export function classKey(f: { cls: string; bSubclass: string | null; rule: string }): string {
  if (f.cls === "B") return `B${f.bSubclass}`;
  if (f.cls === "X") return `X(${f.rule})`;
  return f.cls;
}
const group = (cls: string): string => cls === "A" ? "exact" : cls.startsWith("B") ? "retimed" : "divergent";

export function cellsOf(row: ScanRow): string[] {
  const cells = new Set<string>();
  const perLane = new Map<string, Map<string, string>>();
  let worst = "exact";
  for (const [engine, scan] of Object.entries(row.engines)) {
    for (const [lane, { features }] of Object.entries(scan.lanes)) {
      const key = classKey(features);
      cells.add(`class ${key} | kind ${row.kind}`);
      cells.add(`class ${key} | rom ${lane}`);
      cells.add(`class ${key} | engine ${engine}`);
      if (features.referenceErrorKind === "cpu-halt") cells.add(`reference jams (CPU halt) | class ${key}`);
      const byEngine = perLane.get(lane) ?? new Map<string, string>(); byEngine.set(engine, key); perLane.set(lane, byEngine);
      if (group(key) === "divergent") worst = "divergent"; else if (group(key) === "retimed" && worst === "exact") worst = "retimed";
    }
    if (scan.referenceChargenReads > 0) cells.add("rom kernal+basic | CHARGEN reader");
  }
  for (const [lane, byEngine] of perLane) if (new Set(byEngine.values()).size > 1) cells.add(`engines disagree | rom ${lane}`);
  const nontrivial = worst === "exact" ? "all-exact" : "has-nonexact-lane";
  cells.add(`horizon ${row.band} | ${nontrivial}`);
  cells.add(`model ${row.model} | ${nontrivial}`);
  cells.add(`clock ${row.clock} | ${nontrivial}`);
  const digi = Object.values(row.engines).some(e => e.referenceDigi);
  cells.add(`${digi ? "digi" : "no digi"} | ${nontrivial}`);
  cells.add(`chips ${row.chips} | kind ${row.kind}`);
  return [...cells].sort();
}

export interface Selection {
  chosen: ScanRow[];
  cells: Map<string, { available: ScanRow[]; filled: string[] }>;
  reason: Map<string, string[]>;
}

export function select(rows: ScanRow[], quota = QUOTA): Selection {
  const id = (r: ScanRow): string => `${r.path}#${r.song}`;
  const cells = new Map<string, { available: ScanRow[]; filled: string[] }>();
  const cellsByRow = new Map<string, string[]>();
  for (const row of rows) {
    const cs = cellsOf(row);
    cellsByRow.set(id(row), cs);
    for (const cell of cs) { const e = cells.get(cell) ?? { available: [], filled: [] }; e.available.push(row); cells.set(cell, e); }
  }
  const chosen: ScanRow[] = [], chosenIds = new Set<string>(), chosenFiles = new Set<string>(), reason = new Map<string, string[]>();
  const order = [...cells.keys()].sort((a, b) => cells.get(a)!.available.length - cells.get(b)!.available.length || (a < b ? -1 : 1));
  const open = (cell: string): boolean => cells.get(cell)!.filled.length < Math.min(quota, cells.get(cell)!.available.length);
  for (const cell of order) {
    const entry = cells.get(cell)!;
    while (open(cell)) {
      let best: ScanRow | null = null, bestScore = -1, bestKey = "";
      for (const candidate of entry.available) {
        if (chosenIds.has(id(candidate))) continue;
        let score = 0;
        for (const other of cellsByRow.get(id(candidate))!) if (open(other)) score += 1 / cells.get(other)!.available.length;
        if (chosenFiles.has(candidate.path)) score *= 0.5; // prefer distinct files
        const key = candidateKey(candidate);
        if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && key < bestKey)) { best = candidate; bestScore = score; bestKey = key; }
      }
      if (!best) break;
      chosen.push(best); chosenIds.add(id(best)); chosenFiles.add(best.path);
      for (const other of cellsByRow.get(id(best))!) cells.get(other)!.filled.push(id(best));
      reason.set(id(best), [cell]);
    }
  }
  for (const row of chosen) {
    const covered = cellsByRow.get(id(row))!.filter(cell => cells.get(cell)!.filled.includes(id(row)));
    reason.set(id(row), [...new Set([...reason.get(id(row))!, ...covered])]);
  }
  return { chosen, cells, reason };
}

async function emptyCells(rows: ScanRow[], selection: Selection): Promise<Array<{ cell: string; how: string }>> {
  const out: Array<{ cell: string; how: string }> = [];
  const inventory = await loadInventory();
  const subtunes = inventory.tunes.reduce((n, t) => n + t.songsList.length, 0);
  // Header-derived dimensions are exhaustive over the whole inventory.
  const headerCount = new Map<string, number>();
  for (const t of inventory.tunes) for (const s of t.songsList) {
    for (const key of [`horizon ${horizonBand(s.seconds, s.documented)}`, `model ${t.model}`, `clock ${t.clockDeclared}`, `chips ${t.chips} | kind ${t.kind}`])
      headerCount.set(key, (headerCount.get(key) ?? 0) + 1);
  }
  const headerCells = [
    ...(["<30s", "30-120s", "120-300s", ">300s", "fallback-300s"] as const).map(b => `horizon ${b}`),
    ...(["unknown", "6581", "8580", "either"] as const).map(m => `model ${m}`),
    ...(["unknown", "PAL", "NTSC", "either"] as const).map(c => `clock ${c}`),
    ...[1, 2, 3].flatMap(n => (["PSID", "RSID", "BASIC", "multiSID"] as const).map(k => `chips ${n} | kind ${k}`)),
  ];
  for (const cell of headerCells) if (!(headerCount.get(cell) ?? 0)) {
    // The audit classifies a PSID with a second SID as multiSID, so those (kind, chips) pairs are empty by definition.
    const byDefinition = /^chips 1 \| kind multiSID$|^chips [23] \| kind PSID$/.test(cell);
    out.push({ cell, how: byDefinition ? "empty by definition of the file kind (a PSID declaring a second or third SID is classed multiSID)"
      : `no subtune among the ${subtunes} in the HVSC #85 inventory has this header value (exhaustive header scan)` });
  }
  // Trace classes: absence is relative to the scanned candidates.
  const classes = ["A", "B<=63cyc", "B<=1ms", "B<=2ms", "B>2ms", "C", "D", "E", "F", "G", "H", "I", "X(trace-truncated)"];
  const seen = new Set([...selection.cells.keys()].filter(c => c.startsWith("class ")));
  for (const k of classes) for (const kind of ["PSID", "RSID", "BASIC", "multiSID"]) {
    const cell = `class ${k} | kind ${kind}`;
    if (!seen.has(cell)) out.push({ cell, how: `not observed in the ${rows.length} scanned candidate subtunes (trace-only scan of both engines; an HVSC-wide proof would need the full run)` });
  }
  return out;
}

if (import.meta.main) {
  const rows = loadScan();
  if (!rows.length) throw new Error("No candidate scan: run candidates.ts scan first");
  const selection = select(rows);
  const empty = await emptyCells(rows, selection);
  const id = (r: ScanRow): string => `${r.path}#${r.song}`;
  const chosen = [...selection.chosen].sort((a, b) => candidateKey(a) < candidateKey(b) ? -1 : 1);
  const document = {
    schema: "sidflow-rom-grading-corpus-1",
    scan: { candidates: rows.length, pools: rows.reduce((m: Record<string, number>, r) => { m[r.pool] = (m[r.pool] ?? 0) + 1; return m; }, {}) },
    quota: QUOTA,
    subtunes: chosen.map(r => ({
      path: r.path, song: r.song, seconds: r.seconds, sha256: r.sha256, kind: r.kind, clock: r.clock, model: r.model, chips: r.chips, band: r.band, pool: r.pool,
      digi: Object.values(r.engines).some(e => e.referenceDigi),
      traceClasses: Object.fromEntries(Object.entries(r.engines).map(([e, s]) => [e, Object.fromEntries(Object.entries(s.lanes).map(([l, x]) => [l, classKey(x.features)]))])),
      chargenReads: Object.fromEntries(Object.entries(r.engines).map(([e, s]) => [e, s.referenceChargenReads])),
      covers: selection.reason.get(id(r))!,
    })),
    cells: [...selection.cells.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([cell, v]) => ({
      cell, available: v.available.length, exemplars: v.filled.slice().sort(), satisfied: v.filled.length >= Math.min(QUOTA, v.available.length),
    })),
    emptyCells: empty,
  };
  writeFileSync(CORPUS_PATH, stringifyDeterministic(document as unknown as JsonValue));
  console.error(`selected ${chosen.length} subtunes covering ${document.cells.length} occupied cells; ${empty.length} empty cells; wrote ${CORPUS_PATH}`);
}
