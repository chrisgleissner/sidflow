/** Worker process of the grading pool: reads one JSON job per stdin line, writes one JSON result per stdout line.
 * One job at a time; native renders inside a job may use up to ROM_GRADE_WORKERS (default 3) processes. */
import { createInterface } from "node:readline";
import { gradeSubtune, type GradeJob, type GradeOptions } from "./grade.js";

process.env.ROM_GRADE_WORKERS ??= "3";
interface Request { key: string; job: GradeJob; options: GradeOptions }

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line) as Request;
  const started = performance.now(), cpu = process.cpuUsage();
  try {
    const grade = await gradeSubtune(request.job, request.options);
    const used = process.cpuUsage(cpu);
    process.stdout.write(JSON.stringify({ key: request.key, ok: true, grade, jsCpuSeconds: (used.user + used.system) / 1e6, wallSeconds: (performance.now() - started) / 1000 }) + "\n");
  } catch (error) {
    console.error(`grade-worker: ${request.key} failed:`, error);
    process.stdout.write(JSON.stringify({ key: request.key, ok: false, error: error instanceof Error ? error.message.slice(0, 500) : String(error) }) + "\n");
  }
}
