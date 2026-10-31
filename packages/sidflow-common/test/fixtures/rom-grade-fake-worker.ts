/** Stand-in for scripts/rom-grade/grade-worker.ts: answers each job line with a synthetic grade, no rendering.
 * FAKE_FAIL_KEY makes that job fail (error response); FAKE_CRASH_KEY makes the worker exit abruptly. */
import { createInterface } from "node:readline";

const lane = (grade: number) => ({ grade, basis: "audio", traceClass: "B", bSubclass: "<=63cyc", rule: "values-identical", features: {}, severity: null, audioGrade: null, audioError: null });
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line) as { key: string; job: { path: string; song: number; seconds: number; sha256: string } };
  if (process.env.FAKE_CRASH_KEY === request.key) process.exit(3);
  if (process.env.FAKE_FAIL_KEY === request.key) { process.stdout.write(JSON.stringify({ key: request.key, ok: false, error: "synthetic failure" }) + "\n"); continue; }
  const base = 100 + (request.job.song % 150);
  const grade = {
    path: request.job.path, song: request.job.song, seconds: request.job.seconds, sha256: request.job.sha256, info: { kind: "PSID" }, toleranceMs: 2, toleranceCycles: 1970, gamma: 1,
    engines: { sidlite: { referenceWrites: 1, referenceError: "", referenceChargenReads: 0, lanes: { none: lane(base), "kernal+basic": lane(255) } },
      residfp: { referenceWrites: 1, referenceError: "", referenceChargenReads: 0, lanes: { none: lane(base), "kernal+basic": lane(255) } } },
    cpu: { sidlite: 1, residfp: 1 },
  };
  process.stdout.write(JSON.stringify({ key: request.key, ok: true, grade, jsCpuSeconds: 0.5, wallSeconds: 0.01 }) + "\n");
}
