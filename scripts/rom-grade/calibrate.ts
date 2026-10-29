/** Calibration run for the ROM fidelity grade (gates 1, 2, 3, 5, 6 of doc/research/hvsc-rom-fidelity-grading.md;
 * gate 4 is a listening session on the material this script prepares).
 *
 *   bun scripts/rom-grade/calibrate.ts corpus      grade the corpus twice (audio validated on every lane) -> corpus-run1/2.json
 *   bun scripts/rom-grade/calibrate.ts benchmark   grade the stratified 320 benchmark jobs (production mode) -> benchmark-run.json
 *   bun scripts/rom-grade/calibrate.ts listening   15 s reference/variant excerpts across grade bands
 *   bun scripts/rom-grade/calibrate.ts report      assemble report.json and doc/research/hvsc-rom-grading-calibration.md
 *
 * All outputs go to workspace/rom-grade-calibration/. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { benchmarkStratum, type BenchmarkCandidate } from "../rom-audit/benchmark-model.js";
import { NativeLane } from "../rom-audit/native-lanes.js";
import { CORPUS_PATH } from "./select-corpus.js";
import { ENGINES, gradeSubtune, LANES, stringifyGrade, withoutCpu, type GradeJob, type LaneName, type SeverityRecord, type SubtuneGrade } from "./grade.js";
import { loadInventory, horizonBand } from "./inventory.js";
import { runPool, type PoolStats } from "./pool.js";
import { nativePaths, readSid, repositoryRoot, withSlots, workspaceRoot } from "./native.js";

const out = nativePaths().output;
const file = (name: string): string => path.join(out, name);
const CALIBRATION_DOC = path.join(repositoryRoot, "doc/research/hvsc-rom-grading-calibration.md");
const WORKERS = 19; // production workers of the audit's projection

interface CorpusEntry { path: string; song: number; seconds: number; sha256: string; kind: string; band: string; digi: boolean }

function corpusJobs(): Array<GradeJob & CorpusEntry> {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as { subtunes: CorpusEntry[] };
  return corpus.subtunes.map(s => ({ ...s, path: path.join(nativePaths().hvsc, s.path) }));
}

const POOL_WORKERS = Number(process.env.ROM_GRADE_POOL ?? 18);
async function gradeAll(jobs: Array<GradeJob & { sha256: string }>, validateAudio: boolean, checkpoint: string): Promise<{ grades: SubtuneGrade[]; stats: PoolStats; jsCpuSeconds: number; wallSeconds: number }> {
  const { records, stats } = await runPool(jobs, { validateAudio }, file(checkpoint), POOL_WORKERS, validateAudio ? "corpus" : "benchmark");
  return { grades: records.map(r => r.grade), stats, jsCpuSeconds: stats.workerCpuSeconds, wallSeconds: stats.wallSeconds };
}

function save(name: string, value: unknown): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(file(name), stringifyDeterministic(JSON.parse(JSON.stringify(value)) as JsonValue));
}
const load = <T>(name: string): T => JSON.parse(readFileSync(file(name), "utf8")) as T;

// ------------------------------------------------------------------------------------------------
// Listening material
// ------------------------------------------------------------------------------------------------
const EXCERPT_SECONDS = 15;

async function renderPcm(engine: RomAuditEngine, bytes: Uint8Array, song: number, mask: number, from: number, to: number): Promise<Int16Array> {
  const paths = nativePaths();
  return withSlots(1, async () => {
    const lane = NativeLane.open(paths.renderer[engine], paths.roms, bytes, song, to, mask);
    const first = Math.round(from * 48000) * 2, wanted = Math.round(to * 48000) * 2;
    const pcm = new Int16Array(Math.max(0, wanted - first));
    let produced = 0;
    try {
      for (;;) {
        const chunk = await lane.pull();
        if (!chunk) break;
        for (let i = 0; i < chunk.pcm.length && produced + i < wanted; i++) {
          const at = produced + i - first;
          if (at >= 0) pcm[at] = chunk.pcm[i]!;
        }
        produced += chunk.pcm.length;
      }
    } finally { lane.close(); }
    return pcm;
  });
}

async function encodeOpus(pcm: Int16Array, target: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "-", "-c:a", "libopus", "-b:a", "96k", target], { stdio: ["pipe", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    child.stdin.on("error", reject);
    child.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}

interface ListeningItem { id: string; path: string; song: number; engine: string; lane: string; grade: number; basis: string; traceClass: string; bSubclass: string | null;
  excerptStartSeconds: number; excerptSeconds: number; reference: string; variant: string; severity: { median: number; p95: number; max: number } | null; firstDivergenceSeconds: number | null }

async function listening(): Promise<void> {
  const grades = load<SubtuneGrade[]>("corpus-run1.json");
  const bands: Array<[string, number, number]> = [["0", 0, 0], ["1-20", 1, 20], ["21-50", 21, 50], ["51-90", 51, 90], ["91-130", 91, 130], ["131-170", 131, 170], ["171-210", 171, 210], ["211-240", 211, 240], ["241-253", 241, 253], ["254", 254, 254]];
  const pool: Array<{ g: SubtuneGrade; engine: RomAuditEngine; lane: LaneName; grade: number; key: string }> = [];
  for (const g of grades) for (const engine of ENGINES) for (const lane of LANES) {
    const l = g.engines[engine]!.lanes[lane.name];
    // Listening shows the grade the audio earns; for trace-decided lanes (254) the trace grade is what gate 2 checks.
    const grade = l.grade;
    if (grade === null || grade === 255) continue;
    pool.push({ g, engine, lane: lane.name, grade, key: createHash("sha256").update(`${g.sha256}#${g.song}#${engine}#${lane.name}`).digest("hex") });
  }
  pool.sort((a, b) => a.key < b.key ? -1 : 1);
  const chosen: typeof pool = [];
  const perBand = [3, 3, 2, 2, 2, 2, 2, 2, 3, 3]; // 24 pairs
  bands.forEach(([, lo, hi], index) => {
    const members = pool.filter(p => p.grade >= lo && p.grade <= hi);
    // diversity: prefer distinct trace classes and files within a band
    const used = new Set<string>(), usedFiles = new Set<string>();
    for (let round = 0; round < 2 && chosen.filter(c => c.grade >= lo && c.grade <= hi).length < perBand[index]!; round++) {
      for (const m of members) {
        const cls = m.g.engines[m.engine]!.lanes[m.lane].traceClass;
        if (chosen.includes(m) || usedFiles.has(m.g.path) || (round === 0 && used.has(cls))) continue;
        chosen.push(m); used.add(cls); usedFiles.add(m.g.path);
        if (chosen.filter(c => c.grade >= lo && c.grade <= hi).length >= perBand[index]!) break;
      }
    }
  });
  const dir = path.join(out, "listening");
  mkdirSync(dir, { recursive: true });
  const items: ListeningItem[] = [];
  for (const [n, pick] of chosen.entries()) {
    const l = pick.g.engines[pick.engine]!.lanes[pick.lane];
    const bytes = readSid(path.join(nativePaths().hvsc, pick.g.path));
    const divergence = l.severity?.firstBadWindowSeconds ?? l.features.firstValueDivergenceSeconds ?? 0;
    const start = Math.max(0, Math.min(Math.floor((divergence - 3) * 10) / 10, pick.g.seconds - EXCERPT_SECONDS));
    const end = Math.min(pick.g.seconds, start + EXCERPT_SECONDS);
    const mask = pick.lane === "none" ? 0 : 3;
    const slug = pick.g.path.split("/").pop()!.replace(/\.sid$/i, "").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 30);
    const id = `${String(n + 1).padStart(2, "0")}-g${String(pick.grade).padStart(3, "0")}-${slug}-s${pick.g.song}-${pick.engine}-${pick.lane === "none" ? "none" : "kb"}`;
    const [reference, variant] = await Promise.all([renderPcm(pick.engine, bytes, pick.g.song, 7, start, end), renderPcm(pick.engine, bytes, pick.g.song, mask, start, end)]);
    await encodeOpus(reference, path.join(dir, `${id}-ref.ogg`));
    await encodeOpus(variant, path.join(dir, `${id}-var.ogg`));
    items.push({
      id, path: pick.g.path, song: pick.g.song, engine: pick.engine, lane: pick.lane, grade: pick.grade, basis: l.basis, traceClass: l.traceClass, bSubclass: l.bSubclass,
      excerptStartSeconds: start, excerptSeconds: end - start, reference: `${id}-ref.ogg`, variant: `${id}-var.ogg`,
      severity: l.severity ? { median: l.severity.median, p95: l.severity.p95, max: l.severity.max } : null, firstDivergenceSeconds: l.features.firstValueDivergenceSeconds,
    });
    console.error(`listening ${n + 1}/${chosen.length} ${id}`);
  }
  items.sort((a, b) => a.grade - b.grade || (a.id < b.id ? -1 : 1));
  save("listening/index.json", { format: "Opus in Ogg, 48 kHz stereo, 96 kbit/s", excerptSeconds: EXCERPT_SECONDS, items });
}

// ------------------------------------------------------------------------------------------------
// Report
// ------------------------------------------------------------------------------------------------
const median = (values: number[]): number => { if (!values.length) return NaN; const s = [...values].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const r4 = (value: number): number => Math.round(value * 1e4) / 1e4;
const HIST_BINS: Array<[string, number, number]> = [["0", 0, 0], ["1-63", 1, 63], ["64-127", 64, 127], ["128-191", 128, 191], ["192-249", 192, 249], ["250-253", 250, 253], ["254", 254, 254], ["255", 255, 255]];
const THRESHOLDS = [64, 128, 192, 250];

interface LaneRow { path: string; song: number; engine: string; lane: LaneName; band: string; grade: number | null; audioGrade: number | null; basis: string; cls: string; bSub: string | null;
  severity: SeverityRecord | null;
  drift: number; similarity: number; rule: string; seconds: number }

function laneRows(grades: SubtuneGrade[], bandOf: (g: SubtuneGrade) => string): LaneRow[] {
  const rows: LaneRow[] = [];
  for (const g of grades) for (const engine of ENGINES) for (const lane of LANES) {
    const l = g.engines[engine]?.lanes[lane.name];
    if (!l) continue;
    rows.push({ path: g.path, song: g.song, engine, lane: lane.name, band: bandOf(g), grade: l.grade, audioGrade: l.audioGrade, basis: l.basis, cls: l.traceClass, bSub: l.bSubclass, severity: l.severity,
      drift: l.features.maxDriftCycles, similarity: l.features.alignmentSimilarity, rule: l.rule, seconds: g.seconds });
  }
  return rows;
}

function report(): void {
  const run1 = load<SubtuneGrade[]>("corpus-run1.json"), run2 = load<SubtuneGrade[]>("corpus-run2.json");
  const bandOf = (g: SubtuneGrade): string => horizonBandCache.get(`${g.sha256}#${g.song}`) ?? "?";
  const rows = laneRows(run1, bandOf);
  // Gate 1
  const s1 = run1.map(g => stringifyGrade(withoutCpu(g))).join(""), s2 = run2.map(g => stringifyGrade(withoutCpu(g))).join("");
  const gate1 = { subtunes: run1.length, lanes: rows.length, identical: s1 === s2, sha256: createHash("sha256").update(s1).digest("hex"), sha256Second: createHash("sha256").update(s2).digest("hex") };
  // Gate 2
  const retimed = rows.filter(r => r.grade === 254);
  const gate2Rows = retimed.map(r => ({ path: r.path, song: r.song, engine: r.engine, lane: r.lane, driftCycles: r.drift, median: r.severity?.median ?? null, p95: r.severity?.p95 ?? null, max: r.severity?.max ?? null, audioGrade: r.audioGrade }));
  const gate2Fail = gate2Rows.filter(r => r.median === null || r.median > 0.02 || r.max! > 0.25);
  const bSweep = (["<=63cyc", "<=1ms", "<=2ms", ">2ms"] as const).map(sub => {
    const set = rows.filter(r => r.cls === "B" && r.bSub === sub && r.severity);
    return { subclass: sub, lanes: set.length, medianOfMedians: r4(median(set.map(r => r.severity!.median))), maxMedian: r4(Math.max(0, ...set.map(r => r.severity!.median))), maxWindow: r4(Math.max(0, ...set.map(r => r.severity!.max))), minAudioGrade: set.length ? Math.min(...set.map(r => r.audioGrade!)) : null };
  });
  // Gate 3
  const gRows = rows.filter(r => r.cls === "G");
  const gate3G = gRows.map(r => ({ path: r.path, song: r.song, engine: r.engine, lane: r.lane, grade: r.grade, audioGrade: r.audioGrade, ok: (r.grade ?? 99) <= 5 && (r.audioGrade ?? 99) <= 5 }));
  const f = rows.filter(r => r.cls === "F" && r.audioGrade !== null);
  const eh = rows.filter(r => (r.cls === "E" || r.cls === "H") && r.audioGrade !== null);
  const gate3EH = eh.map(r => {
    const peers = f.filter(x => x.band === r.band);
    const minF = peers.length ? Math.min(...peers.map(x => x.audioGrade!)) : null;
    return { path: r.path, song: r.song, engine: r.engine, lane: r.lane, cls: r.cls, band: r.band, audioGrade: r.audioGrade!, minFInBand: minF, ok: minF === null ? null : r.audioGrade! < minF };
  });
  // Class table
  const classTable = [...new Set(rows.map(r => r.cls === "B" ? `B${r.bSub}` : r.cls))].sort().map(k => {
    const set = rows.filter(r => (r.cls === "B" ? `B${r.bSub}` : r.cls) === k);
    const audio = set.filter(r => r.audioGrade !== null);
    return { class: k, lanes: set.length, withAudio: audio.length, grades: histogram(set.map(r => r.grade).filter((g): g is number => g !== null)),
      audioGradeMin: audio.length ? Math.min(...audio.map(r => r.audioGrade!)) : null, audioGradeMedian: audio.length ? median(audio.map(r => r.audioGrade!)) : null, audioGradeMax: audio.length ? Math.max(...audio.map(r => r.audioGrade!)) : null,
      medianSw: audio.length ? r4(median(audio.map(r => r.severity!.median))) : null, maxSw: audio.length ? r4(Math.max(...audio.map(r => r.severity!.max))) : null };
  });
  // Engine disagreement
  const disagree: Array<{ path: string; song: number; lane: string; residfp: number | null; sidlite: number | null }> = [];
  for (const g of run1) for (const lane of LANES) {
    const a = g.engines.residfp!.lanes[lane.name].grade, b = g.engines.sidlite!.lanes[lane.name].grade;
    if (a !== b && (a === null || b === null || Math.abs(a - b) >= 10)) disagree.push({ path: g.path, song: g.song, lane: lane.name, residfp: a, sidlite: b });
  }
  // Gate 5 / 6
  const bench = existsSync(file("benchmark-run.json")) ? load<{ grades: SubtuneGrade[]; wallSeconds: number; jsCpuSeconds: number }>("benchmark-run.json") : null;
  const out: Record<string, unknown> = { gate1, gate2: { lanes254: retimed.length, failures: gate2Fail, sweepByBSubclass: bSweep, all: gate2Rows }, gate3: { noPlayback: gate3G, earlyVsLate: gate3EH }, classTable, engineDisagreement: disagree };
  if (bench) out.benchmark = benchmarkReport(bench);
  save("report.json", out);
  writeFileSync(CALIBRATION_DOC, markdown(out));
  console.error(`wrote ${file("report.json")} and ${CALIBRATION_DOC}`);
}

const horizonBandCache = new Map<string, string>();

function histogram(grades: number[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (const [name, lo, hi] of HIST_BINS) h[name] = grades.filter(g => g >= lo && g <= hi).length;
  return h;
}

function benchmarkReport(bench: { grades: SubtuneGrade[]; wallSeconds: number; jsCpuSeconds: number }): Record<string, unknown> {
  const grades = bench.grades;
  const kindOf = benchKinds;
  const job = (g: SubtuneGrade): BenchmarkCandidate => ({ path: g.path, song: g.song, sha256: g.sha256, seconds: g.seconds, kind: kindOf.get(g.sha256) ?? g.info.kind });
  const stratumOf = (g: SubtuneGrade): string => benchmarkStratum(job(g));
  const population = new Map<string, number>();
  for (const j of populationJobs) population.set(benchmarkStratum(j), (population.get(benchmarkStratum(j)) ?? 0) + 1);
  const measuredPer = new Map<string, number>();
  for (const g of grades) measuredPer.set(stratumOf(g), (measuredPer.get(stratumOf(g)) ?? 0) + 1);
  const weight = (g: SubtuneGrade): number => (population.get(stratumOf(g)) ?? 0) / (measuredPer.get(stratumOf(g)) ?? 1);
  const totalWeight = grades.reduce((n, g) => n + weight(g), 0);
  const views: Array<[string, (g: SubtuneGrade) => number | null]> = [];
  for (const engine of ENGINES) for (const lane of LANES) views.push([`${engine}/${lane.name}`, g => g.engines[engine]!.lanes[lane.name].grade]);
  for (const lane of LANES) views.push([`any engine/${lane.name}`, g => minOf(ENGINES.map(e => g.engines[e]!.lanes[lane.name].grade))]);
  views.push(["subtune (min over 2 engines x 2 configurations)", g => minOf(ENGINES.flatMap(e => LANES.map(l => g.engines[e]!.lanes[l.name].grade)))]);
  const table = views.map(([name, pick]) => {
    const values = grades.map(g => ({ g, v: pick(g) })).filter((x): x is { g: SubtuneGrade; v: number } => x.v !== null);
    const wsum = values.reduce((n, x) => n + weight(x.g), 0);
    return {
      view: name, n: values.length, unmeasurable: grades.length - values.length, histogram: histogram(values.map(x => x.v)),
      below: Object.fromEntries(THRESHOLDS.map(t => [String(t), { count: values.filter(x => x.v < t).length, share: r4(values.filter(x => x.v < t).length / values.length), weightedShare: r4(values.filter(x => x.v < t).reduce((n, x) => n + weight(x.g), 0) / wsum) }])),
      belowRetimed: { count: values.filter(x => x.v <= 253).length, share: r4(values.filter(x => x.v <= 253).length / values.length), weightedShare: r4(values.filter(x => x.v <= 253).reduce((n, x) => n + weight(x.g), 0) / wsum) },
    };
  });
  // Cost
  const strata: Record<string, { population: number; measured: number; meanCpuSeconds: number; meanHorizonSeconds: number }> = {};
  let nativeCpu = 0, projectedNative = 0;
  for (const [stratum, pop] of [...population.entries()].sort()) {
    const set = grades.filter(g => stratumOf(g) === stratum);
    const cpu = set.map(g => Object.values(g.cpu).reduce((a, b) => a + b, 0));
    const mean = cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : 0;
    strata[stratum] = { population: pop, measured: set.length, meanCpuSeconds: r4(mean), meanHorizonSeconds: r4(set.length ? set.reduce((n, g) => n + g.seconds, 0) / set.length : 0) };
    projectedNative += pop * mean;
  }
  for (const g of grades) nativeCpu += Object.values(g.cpu).reduce((a, b) => a + b, 0);
  const jsFactor = (nativeCpu + bench.jsCpuSeconds) / nativeCpu;
  const projectedCpu = projectedNative * jsFactor;
  const unmeasured = Object.entries(strata).filter(([, s]) => s.measured === 0).map(([k]) => k);
  return {
    jobs: grades.length, strata, unmeasuredStrata: unmeasured, table,
    cost: { nativeCpuSeconds: r4(nativeCpu), nodeCpuSeconds: r4(bench.jsCpuSeconds), wallSeconds: r4(bench.wallSeconds), jsOverheadFactor: r4(jsFactor), projectedCpuHoursAllHvsc: r4(projectedCpu / 3600),
      projectedHoursOn19Workers: r4(projectedCpu / WORKERS / 3600), withMargin25: r4(projectedCpu / WORKERS / 3600 * 1.25), limitHours: 24 },
    populationWeightTotal: r4(totalWeight),
  };
}
const minOf = (values: Array<number | null>): number | null => values.some(v => v === null) ? null : Math.min(...(values as number[]));

let populationJobs: BenchmarkCandidate[] = [];
const benchKinds = new Map<string, string>();

function markdown(r: Record<string, unknown>): string {
  const lines: string[] = [];
  const g1 = r.gate1 as { subtunes: number; lanes: number; identical: boolean; sha256: string };
  const g2 = r.gate2 as { lanes254: number; failures: Array<Record<string, unknown>>; sweepByBSubclass: Array<Record<string, unknown>> };
  const g3 = r.gate3 as { noPlayback: Array<{ ok: boolean }>; earlyVsLate: Array<{ ok: boolean | null; path: string; song: number; engine: string; lane: string; cls: string; audioGrade: number; minFInBand: number | null }> };
  lines.push("# ROM fidelity grading: calibration results", "", "Generated by `scripts/rom-grade/calibrate.ts report` from `workspace/rom-grade-calibration/`. Design: [hvsc-rom-fidelity-grading.md](hvsc-rom-fidelity-grading.md); corpus: [hvsc-rom-grading-corpus.json](hvsc-rom-grading-corpus.json).", "");
  lines.push("## Gate 1: determinism", "", `${g1.subtunes} corpus subtunes (${g1.lanes} lane grades, both engines, none and KERNAL+BASIC) were graded twice with audio rendered for every non-bit-exact lane. Grades, features and severity statistics (everything except process CPU seconds) are byte-identical: **${g1.identical ? "PASS" : "FAIL"}** (sha256 ${g1.sha256.slice(0, 16)}).`, "");
  lines.push("## Gate 2: timing class soundness", "", `Lanes graded 254 (identical value sequence, drift <= T = 2 ms): ${g2.lanes254}. Requirement: median s_w <= 0.02 and no window above 0.25 (audio rendered anyway for validation). Failures: **${g2.failures.length}**${g2.failures.length ? "" : " (PASS)"}.`, "");
  if (g2.failures.length) { lines.push("| file | song | engine | lane | drift cyc | median | p95 | max | audio grade |", "|---|---|---|---|---|---|---|---|---|"); for (const f of g2.failures) lines.push(`| ${f.path} | ${f.song} | ${f.engine} | ${f.lane} | ${f.driftCycles} | ${f.median} | ${f.p95} | ${f.max} | ${f.audioGrade} |`); lines.push(""); }
  lines.push("Audio severity of every identical-value (class B) lane by drift subclass:", "", "| subclass | lanes | median of medians | max median | max window | lowest audio grade |", "|---|---|---|---|---|---|");
  for (const s of g2.sweepByBSubclass) lines.push(`| ${s.subclass} | ${s.lanes} | ${s.medianOfMedians} | ${s.maxMedian} | ${s.maxWindow} | ${s.minAudioGrade} |`);
  lines.push("", "## Gate 3: no-playback soundness", "", `Class G lanes: ${g3.noPlayback.length}; grading 0-5 (trace shortcut and audio): ${g3.noPlayback.filter(x => x.ok).length} of ${g3.noPlayback.length}.`, "");
  const bad = g3.earlyVsLate.filter(x => x.ok === false);
  lines.push(`Class E/H lanes with audio: ${g3.earlyVsLate.length}; below every class F lane of the same horizon band: ${g3.earlyVsLate.filter(x => x.ok === true).length}; no F peer: ${g3.earlyVsLate.filter(x => x.ok === null).length}; violations: **${bad.length}**.`, "");
  if (bad.length) { lines.push("| file | song | engine | lane | class | audio grade | lowest F grade in band |", "|---|---|---|---|---|---|---|"); for (const x of bad) lines.push(`| ${x.path} | ${x.song} | ${x.engine} | ${x.lane} | ${x.cls} | ${x.audioGrade} | ${x.minFInBand} |`); lines.push(""); }
  lines.push("## Corpus lanes by trace class", "", "| class | lanes | audio rendered | audio grade min / median / max | median s_w (median) | max s_w |", "|---|---|---|---|---|---|");
  for (const c of r.classTable as Array<Record<string, unknown>>) lines.push(`| ${c.class} | ${c.lanes} | ${c.withAudio} | ${c.audioGradeMin} / ${c.audioGradeMedian} / ${c.audioGradeMax} | ${c.medianSw} | ${c.maxSw} |`);
  const bench = r.benchmark as undefined | { jobs: number; table: Array<{ view: string; n: number; unmeasurable: number; histogram: Record<string, number>; below: Record<string, { count: number; share: number; weightedShare: number }>; belowRetimed: { count: number; share: number; weightedShare: number } }>; strata: Record<string, { population: number; measured: number; meanCpuSeconds: number; meanHorizonSeconds: number }>; cost: Record<string, number>; unmeasuredStrata: string[] };
  if (bench) {
    lines.push("", `## Gate 5: grade distribution over the ${bench.jobs} stratified benchmark jobs`, "", "Histogram (subtune counts) and share below each candidate threshold, raw and population-weighted by stratum (kind x horizon, weights as in `projectCensus`).", "");
    lines.push(`| view | n | ${HIST_BINS.map(b => b[0]).join(" | ")} |`, `|---|---|${HIST_BINS.map(() => "---").join("|")}|`);
    for (const t of bench.table) lines.push(`| ${t.view} | ${t.n} | ${HIST_BINS.map(b => t.histogram[b[0]]).join(" | ")} |`);
    lines.push("", `| view | ${THRESHOLDS.map(t => `<${t} raw / weighted`).join(" | ")} | <=253 raw / weighted |`, `|---|${THRESHOLDS.map(() => "---").join("|")}|---|`);
    for (const t of bench.table) lines.push(`| ${t.view} | ${THRESHOLDS.map(x => `${(t.below[String(x)]!.share * 100).toFixed(1)}% / ${(t.below[String(x)]!.weightedShare * 100).toFixed(1)}%`).join(" | ")} | ${(t.belowRetimed.share * 100).toFixed(1)}% / ${(t.belowRetimed.weightedShare * 100).toFixed(1)}% |`);
    lines.push("", "## Gate 6: cost", "", "| stratum | population | measured | mean CPU s / subtune | mean horizon s |", "|---|---|---|---|---|");
    for (const [k, s] of Object.entries(bench.strata)) lines.push(`| ${k} | ${s.population} | ${s.measured} | ${s.meanCpuSeconds} | ${s.meanHorizonSeconds} |`);
    const c = bench.cost;
    lines.push("", `Native renderer CPU ${c.nativeCpuSeconds} s plus grader process CPU ${c.nodeCpuSeconds} s (factor ${c.jsOverheadFactor}); wall ${c.wallSeconds} s. Projected full HVSC: ${c.projectedCpuHoursAllHvsc} CPU-hours = ${c.projectedHoursOn19Workers} h on 19 workers, ${c.withMargin25} h with the 25% margin (limit ${c.limitHours} h).${bench.unmeasuredStrata.length ? ` Unmeasured strata (no benchmark job): ${bench.unmeasuredStrata.join(", ")}.` : ""}`);
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const inventory = await loadInventory();
  for (const t of inventory.tunes) for (const s of t.songsList) horizonBandCache.set(`${t.sha256}#${s.song}`, horizonBand(s.seconds, s.documented));
  populationJobs = inventory.tunes.flatMap(t => t.songsList.map(s => ({ path: t.path, song: s.song, sha256: t.sha256, seconds: s.seconds, kind: t.kind })));
  for (const t of inventory.tunes) benchKinds.set(t.sha256, t.kind);
  mkdirSync(out, { recursive: true });
  if (command === "corpus") {
    const jobs = corpusJobs();
    for (const run of [1, 2]) {
      const result = await gradeAll(jobs, true, `corpus-run${run}.jsonl`);
      save(`corpus-run${run}.json`, result.grades);
      save(`corpus-run${run}-pool.json`, result.stats);
      console.error(`corpus run ${run}: ${result.wallSeconds.toFixed(0)} s wall, efficiency ${(result.stats.efficiency * 100).toFixed(0)}%`);
    }
  } else if (command === "benchmark") {
    const benchmark = JSON.parse(readFileSync(path.join(workspaceRoot(), "rom-audit-sample/benchmark.json"), "utf8")) as { measured: Array<{ job: BenchmarkCandidate }> };
    const jobs = benchmark.measured.map(m => ({ path: m.job.path, song: m.job.song, seconds: m.job.seconds, sha256: m.job.sha256 }));
    const result = await gradeAll(jobs, false, "benchmark-run.jsonl");
    save("benchmark-run.json", result);
  } else if (command === "listening") await listening();
  else if (command === "report") report();
  else throw new Error("usage: calibrate.ts corpus|benchmark|listening|report");
}

if (import.meta.main) await main();
