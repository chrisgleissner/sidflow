import { afterEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildInventory } from "../../../scripts/rom-grade/inventory.js";
import { tmpdir } from "node:os";
import path from "node:path";
import { importClosure, frozenOptions } from "../../../scripts/rom-grade/methodology-id.js";
import { jobKey, repairTail, runPool, terminateChildren, type PoolRecord } from "../../../scripts/rom-grade/pool.js";
import { finalize } from "../../../scripts/rom-grade/finalize.js";
import type { Scope } from "../../../scripts/rom-grade/full-scope.js";
import { spawn } from "node:child_process";
import { Accumulator, anomalies, bucketOf, totalsOf } from "../../../scripts/rom-grade/summary.js";
import { gradeSubtune, type GradeDeps, type SubtuneGrade } from "../../../scripts/rom-grade/grade.js";

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
  it("refuses to resume a record measured over a different horizon than the job requests", async () => {
    const checkpoint = path.join(scratch(), "c.jsonl");
    await runPool(jobs.slice(0, 3), {}, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64) });
    const longer = jobs.map((j, i) => (i === 1 ? { ...j, seconds: j.seconds + 20 } : j));
    await expect(runPool(longer, {}, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64) })).rejects.toThrow(/measured over 11 s, but the job requests 31 s/);
  });
  it("refuses to grade SID bytes that differ from the scheduled SHA-256, before rendering", async () => {
    const file = path.join(scratch(), "changed.sid");
    writeFileSync(file, "PSID changed after scheduling");
    const deps = new Proxy({}, { get: () => { throw new Error("rendered although the input changed"); } }) as GradeDeps;
    await expect(gradeSubtune({ path: file, song: 1, seconds: 10, sha256: "0".repeat(64) }, {}, deps)).rejects.toThrow(/changed after scheduling/);
  });
  it("refuses a Songlengths entry whose duration count differs from the SID header's subtune count", async () => {
    const root = scratch();
    const header = Buffer.alloc(0x7c + 2);
    header.write("PSID", 0, "latin1");
    header.writeUInt16BE(2, 0x04); header.writeUInt16BE(0x7c, 0x06); header.writeUInt16BE(0x1000, 0x08);
    header.writeUInt16BE(0x1000, 0x0a); header.writeUInt16BE(0x1003, 0x0c); header.writeUInt16BE(2, 0x0e); header.writeUInt16BE(1, 0x10);
    mkdirSync(path.join(root, "DOCUMENTS"), { recursive: true });
    writeFileSync(path.join(root, "Two.sid"), header);
    const md5 = createHash("md5").update(header).digest("hex");
    writeFileSync(path.join(root, "DOCUMENTS/Songlengths.md5"), `[Database]\n; /Two.sid\n${md5}=0:30\n`);
    await expect(buildInventory(root, 1)).rejects.toThrow(/has 1 durations, the SID header declares 2 subtunes/);
  });
  it("refuses to resume under a different methodology identity or options", async () => {
    const checkpoint = path.join(scratch(), "c.jsonl");
    await runPool(jobs.slice(0, 3), {}, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64) });
    await expect(runPool(jobs, {}, { checkpoint, workers: 1, workerScript: worker, identity: "b".repeat(64) })).rejects.toThrow("different options or methodology identity");
    await expect(runPool(jobs, { validateAudio: true }, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64) })).rejects.toThrow("different options");
  });
  it("refuses to resume with a different input binding (corpus or Songlengths.md5 digest)", async () => {
    const checkpoint = path.join(scratch(), "c.jsonl");
    const binding = { corpusId: "c".repeat(64), songlengthsSha256: "1".repeat(64) };
    await runPool(jobs.slice(0, 2), {}, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64), binding });
    await expect(runPool(jobs, {}, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64), binding: { ...binding, songlengthsSha256: "2".repeat(64) } }))
      .rejects.toThrow("different options or methodology identity");
    const resumed = await runPool(jobs, {}, { checkpoint, workers: 1, workerScript: worker, identity: "a".repeat(64), binding });
    expect(resumed.stats.resumed).toBe(2);
  });
  it("stops workers with SIGTERM first and SIGKILL only after the grace period", async () => {
    const polite = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const stubborn = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise<void>(resolve => stubborn.stdout!.once("data", () => resolve()));
    const exited = (c: typeof polite) => new Promise<string | null>(resolve => c.once("exit", (_code, signal) => resolve(signal)));
    const [a, b] = [exited(polite), exited(stubborn)];
    const started = performance.now();
    terminateChildren([polite, stubborn], 300);
    expect(await a).toBe("SIGTERM");
    expect(await b).toBe("SIGKILL");
    expect(performance.now() - started).toBeGreaterThanOrEqual(250);
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

describe("finalize", () => {
  const identity = { id: "d".repeat(64), binaries: { residfp: "r", sidlite: "s" } };
  const sha = (i: number): string => (i + 1).toString(16).padStart(64, "0");
  const scope: Scope = {
    jobs: [{ path: "/h/a.sid", song: 1, seconds: 40, sha256: sha(0), md5: "a".repeat(32), kind: "PSID" }, { path: "/h/a.sid", song: 2, seconds: 25, sha256: sha(0), md5: "a".repeat(32), kind: "PSID" },
      { path: "/h/b.sid", song: 1, seconds: 300, sha256: sha(1), md5: "b".repeat(32), kind: "RSID" }],
    files: 2, subtunes: 3, corpusId: "c".repeat(64), songlengthsSha256: "5".repeat(64),
  };
  const lane = (grade: number | null) => ({ grade, basis: "audio", traceClass: "D", bSubclass: null, rule: "r", features: {}, severity: null, audioGrade: grade, audioError: null });
  const record = (job: { sha256: string; song: number; seconds: number }, grades: Array<number | null> = [254, 255, 254, 255]): PoolRecord => ({
    key: jobKey(job), jsCpuSeconds: 1, wallSeconds: 1, grade: {
      path: "p", song: job.song, seconds: job.seconds, sha256: job.sha256, info: { kind: "PSID" }, cpu: {},
      engines: { sidlite: { lanes: { none: lane(grades[0]!), "kernal+basic": lane(grades[1]!) } }, residfp: { lanes: { none: lane(grades[2]!), "kernal+basic": lane(grades[3]!) } } },
    } as unknown as SubtuneGrade,
  });
  const header = { options: { validateAudio: false }, identity: identity.id, binding: { corpusId: scope.corpusId, songlengthsSha256: scope.songlengthsSha256 } };
  function setup(records: PoolRecord[], overrides: { header?: Record<string, unknown>; sidecar?: Record<string, unknown> } = {}): string {
    const out = scratch();
    writeFileSync(path.join(out, "scope.json"), JSON.stringify({ corpusId: scope.corpusId, songlengthsSha256: scope.songlengthsSha256, maxJobs: null, ...overrides.sidecar }));
    writeFileSync(path.join(out, "checkpoint.jsonl"), [JSON.stringify({ ...header, ...overrides.header }), ...records.map(r => JSON.stringify(r))].join("\n") + "\n");
    return out;
  }
  const all = (): PoolRecord[] => scope.jobs.map(j => record(j));
  const run = (out: string, options = { allowPartial: false, declareScope: false }) => finalize(out, options, { identity, scope });
  it("writes the results for a complete, consistent checkpoint", async () => {
    const out = setup(all());
    const result = await run(out);
    expect(result).toMatchObject({ rows: 3, complete: true });
    const lines = readFileSync(result.resultsFile, "utf8").trim().split("\n").map(l => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ record: "header", methodologyId: identity.id, songlengthsSha256: scope.songlengthsSha256, subtunes: 3 });
    expect(lines.slice(1).map(l => [l.md5, l.song])).toEqual([["a".repeat(32), 1], ["a".repeat(32), 2], ["b".repeat(32), 1]]);
  });
  it("refuses another methodology identity", async () => {
    await expect(run(setup(all(), { header: { identity: "e".repeat(64) } }))).rejects.toThrow("methodology");
  });
  it("refuses another Songlengths.md5, in scope.json or in the checkpoint header", async () => {
    await expect(run(setup(all(), { sidecar: { songlengthsSha256: "6".repeat(64) } }))).rejects.toThrow("Songlengths");
    await expect(run(setup(all(), { sidecar: { songlengthsSha256: undefined } }))).rejects.toThrow("Songlengths");
    await expect(run(setup(all(), { header: { binding: { corpusId: scope.corpusId, songlengthsSha256: "6".repeat(64) } } }))).rejects.toThrow("Songlengths");
    await expect(run(setup(all(), { header: { binding: undefined } }))).rejects.toThrow("Songlengths");
  });
  it("refuses a record graded over another horizon than its scope job", async () => {
    const records = all();
    records[1] = record({ ...scope.jobs[1]!, seconds: 30 });
    await expect(run(setup(records))).rejects.toThrow("graded over 30 s");
  });
  it("refuses a record outside the scope, a duplicate and an unmeasured lane", async () => {
    await expect(run(setup([...all(), record({ sha256: sha(0), song: 3, seconds: 40 })]))).rejects.toThrow("not in the HVSC scope");
    await expect(run(setup([...all(), record({ sha256: sha(7), song: 1, seconds: 40 })]))).rejects.toThrow("not in the HVSC scope");
    await expect(run(setup([...all(), record(scope.jobs[0]!)]))).rejects.toThrow("Duplicate");
    const unmeasured = all();
    unmeasured[2] = record(scope.jobs[2]!, [254, 255, null, 255]);
    await expect(run(setup(unmeasured))).rejects.toThrow("Unmeasured lane residfpNone");
  });
  it("refuses an incomplete checkpoint unless a partial or declared scope is asked for", async () => {
    await expect(run(setup(all().slice(0, 2)))).rejects.toThrow("Grading incomplete: 2 of 3");
    const partial = await run(setup(all().slice(0, 2)), { allowPartial: true, declareScope: false });
    expect(partial).toMatchObject({ rows: 2, complete: false });
    const header = JSON.parse(readFileSync(partial.resultsFile, "utf8").split("\n")[0]!) as { subtunes: number; profile: { scope: string } };
    expect(header.subtunes).toBe(3);
    expect(header.profile.scope).toBe("partial");
  });
});
