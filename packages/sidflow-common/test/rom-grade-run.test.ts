import { afterEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { importClosure, frozenOptions } from "../../../scripts/rom-grade/methodology-id.js";
import { jobKey, repairTail, runPool, type PoolRecord } from "../../../scripts/rom-grade/pool.js";
import { Accumulator, anomalies, bucketOf, totalsOf } from "../../../scripts/rom-grade/summary.js";
import type { SubtuneGrade } from "../../../scripts/rom-grade/grade.js";

const worker = path.join(import.meta.dir, "fixtures/rom-grade-fake-worker.ts");
const dirs: string[] = [];
const scratch = (): string => { const d = mkdtempSync(path.join(tmpdir(), "rom-grade-run-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); delete process.env.FAKE_FAIL_KEY; delete process.env.FAKE_CRASH_KEY; });
const jobs = Array.from({ length: 12 }, (_, i) => ({ path: `/x/${i}.sid`, song: i + 1, seconds: 10 + i, sha256: i.toString(16).padStart(64, "0") }));

describe("buckets", () => {
  it("cuts at the documented boundaries", () => {
    const cases: Array<[number | null, string]> = [[0, "0"], [1, "1-127"], [127, "1-127"], [128, "128-191"], [191, "128-191"], [192, "192-249"], [249, "192-249"], [250, "250-253"], [253, "250-253"], [254, "254"], [255, "255"], [null, "unmeasured"]];
    for (const [grade, bucket] of cases) expect(bucketOf(grade)).toBe(bucket);
  });
});

describe("pool", () => {
  it("runs every job, keeps input order and is independent of worker count", async () => {
    const a = await runPool(jobs, {}, { checkpoint: path.join(scratch(), "c.jsonl"), workers: 3, workerScript: worker, progressEvery: 4 });
    const b = await runPool(jobs, {}, { checkpoint: path.join(scratch(), "c.jsonl"), workers: 1, workerScript: worker });
    expect(a.records.map(r => r.key)).toEqual(jobs.map(jobKey));
    expect(JSON.stringify(a.records.map(r => r.grade))).toBe(JSON.stringify(b.records.map(r => r.grade)));
    expect(a.stats.ran).toBe(12);
  });
  it("fails fast on a job error, keeps finished work and resumes without redoing it", async () => {
    const checkpoint = path.join(scratch(), "c.jsonl");
    process.env.FAKE_FAIL_KEY = jobKey(jobs[5]!);
    await expect(runPool(jobs, {}, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64) })).rejects.toThrow("synthetic failure");
    const finished = readFileSync(checkpoint, "utf8").trim().split("\n").length - 1;
    expect(finished).toBeGreaterThan(0);
    expect(finished).toBeLessThan(12);
    delete process.env.FAKE_FAIL_KEY;
    const seen: boolean[] = [];
    const resumed = await runPool(jobs, {}, { checkpoint, workers: 2, workerScript: worker, identity: "a".repeat(64), onRecord: (_r, wasResumed) => seen.push(wasResumed) });
    expect(resumed.stats.resumed).toBe(finished);
    expect(resumed.stats.ran).toBe(12 - finished);
    expect(seen.filter(Boolean).length).toBe(finished);
    expect(resumed.records.length).toBe(12);
    expect(readFileSync(checkpoint, "utf8").trim().split("\n").length - 1).toBe(12);
  });
  it("treats a worker crash as a failure", async () => {
    process.env.FAKE_CRASH_KEY = jobKey(jobs[0]!);
    await expect(runPool(jobs, {}, { checkpoint: path.join(scratch(), "c.jsonl"), workers: 2, workerScript: worker })).rejects.toThrow(/worker exited/);
  });
  it("rejects a record that fails validation", async () => {
    await expect(runPool(jobs, {}, { checkpoint: path.join(scratch(), "c.jsonl"), workers: 2, workerScript: worker, validate: r => r.key === jobKey(jobs[2]!) ? "bad lane" : null })).rejects.toThrow("bad lane");
  });
  it("refuses to resume under a different methodology identity or options", async () => {
    const checkpoint = path.join(scratch(), "c.jsonl");
    await runPool(jobs.slice(0, 3), {}, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64) });
    await expect(runPool(jobs, {}, { checkpoint, workers: 1, workerScript: worker, identity: "b".repeat(64) })).rejects.toThrow("different options or methodology identity");
    await expect(runPool(jobs, { validateAudio: true }, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64) })).rejects.toThrow("different options");
  });
  it("cuts a torn final line before resuming", async () => {
    const checkpoint = path.join(scratch(), "c.jsonl");
    await runPool(jobs.slice(0, 4), {}, { checkpoint, workers: 1, workerScript: worker });
    appendFileSync(checkpoint, '{"key":"torn');
    const resumed = await runPool(jobs, {}, { checkpoint, workers: 2, workerScript: worker });
    expect(resumed.stats.resumed).toBe(4);
    expect(resumed.records.length).toBe(12);
  });
  it("repairTail only touches an unterminated last line", () => {
    const file = path.join(scratch(), "t.jsonl");
    writeFileSync(file, "a\nb\n");
    expect(repairTail(file)).toBe(0);
    writeFileSync(file, "a\nb\ncc");
    expect(repairTail(file)).toBe(2);
    expect(readFileSync(file, "utf8")).toBe("a\nb\n");
    writeFileSync(file, "no newline at all");
    expect(repairTail(file)).toBe(17);
    expect(readFileSync(file, "utf8")).toBe("");
  });
  it("does not retain records when asked to stream", async () => {
    const counted: number[] = [];
    const result = await runPool(jobs, {}, { checkpoint: path.join(scratch(), "c.jsonl"), workers: 4, workerScript: worker, keepRecords: false, onRecord: () => counted.push(1) });
    expect(result.records.length).toBe(0);
    expect(counted.length).toBe(12);
  });
});

describe("summary", () => {
  const record = (grades: [number, number, number, number], song: number, seconds = 100, kind = "PSID"): PoolRecord => {
    const lane = (grade: number) => ({ grade, basis: "audio", traceClass: grade === 255 ? "A" : "B", bSubclass: grade === 255 ? null : "<=63cyc", rule: "r", features: {}, severity: null, audioGrade: null, audioError: null });
    return { key: `k${song}`, jsCpuSeconds: 1, wallSeconds: 1, grade: {
      path: "p", song, seconds, sha256: String(song), info: { kind }, cpu: { sidlite: 2, residfp: 2 },
      engines: { sidlite: { lanes: { none: lane(grades[0]), "kernal+basic": lane(grades[1]) } }, residfp: { lanes: { none: lane(grades[2]), "kernal+basic": lane(grades[3]) } } },
    } as unknown as SubtuneGrade };
  };
  it("counts buckets, classes, strata and projects the remaining time", () => {
    const all = [record([255, 255, 255, 255], 1), record([0, 255, 0, 255], 2), record([200, 255, 254, 255], 3)];
    const acc = new Accumulator(totalsOf(all.map(r => ({ seconds: r.grade.seconds, kind: "PSID", sha256: r.grade.sha256, song: r.grade.song, path: "p" })).concat([{ seconds: 600, kind: "PSID", sha256: "z", song: 1, path: "p" }])));
    all.forEach(r => acc.add(r));
    const s = acc.snapshot();
    expect(s.done).toBe(3);
    expect(s.lanes.sidliteNone["0"]).toBe(1);
    expect(s.lanes.sidliteNone["192-249"]).toBe(1);
    expect(s.lanes.residfpNone["254"]).toBe(1);
    expect(s.classes.sidliteNone["B<=63cyc"]).toBe(2);
    expect(s.strata["PSID/30-120"]).toEqual({ done: 3, below128: 1 });
    // 3 jobs, 300 horizon seconds, 15 CPU seconds => 0.05 CPU-s per second; 600 s remain => 30 CPU-s; 3 workers at 100% => 10 s
    expect(acc.projectedRemainingHours(3, 1)! * 3600).toBeCloseTo(10, 6);
  });
  it("flags errors, low efficiency and strata outside 3x of the benchmark", () => {
    const acc = new Accumulator({ subtunes: 100, secondsByKind: { PSID: 1 }, subtunesByStratum: {} });
    for (let i = 0; i < 60; i++) acc.add(record(i < 30 ? [0, 255, 0, 255] : [255, 255, 255, 255], i + 1));
    const found = anomalies(acc.snapshot(), { strata: { "PSID/30-120": { n: 20, below128: 1 } } }, 0.5);
    expect(found.some(f => f.includes("efficiency"))).toBe(true);
    expect(found.some(f => f.includes("PSID/30-120"))).toBe(true);
    expect(anomalies(acc.snapshot(), { strata: { "PSID/30-120": { n: 20, below128: 10 } } }, 0.9)).toEqual([]);
    expect(anomalies(acc.snapshot(), null, null)).toEqual([]);
  });
});

describe("methodology identity inputs", () => {
  it("covers the grader's whole import closure, including audit and common modules", async () => {
    const files = await importClosure(["scripts/rom-grade/grade.ts"]);
    for (const expected of ["scripts/rom-grade/trace-core.ts", "scripts/rom-grade/severity-core.ts", "scripts/rom-audit/native-lanes.ts", "scripts/rom-audit/listener.ts", "scripts/rom-audit/digital-screen.ts", "packages/sidflow-common/src/json.ts"])
      expect(files).toContain(expected);
    expect(files).toEqual([...files].sort());
  });
  it("records the frozen options and consumer policy", () => {
    const frozen = frozenOptions() as { toleranceMs: number; gamma: number; consumer: { recommendedMinGrade: number; listCeiling: number } };
    expect(frozen.toleranceMs).toBe(2);
    expect(frozen.gamma).toBe(1);
    expect(frozen.consumer).toEqual({ recommendedMinGrade: 128, listCeiling: 191 });
  });
});
