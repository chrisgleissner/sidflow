#!/usr/bin/env bun
/**
 * Audit every .sid header in an HVSC tree against SID_file_format.txt, and
 * cross-check each file against libsidplayfp's own loader.
 *
 * Usage:
 *   bun run audit:sid-headers -- --hvsc <C64Music dir> --out <dir> [--workers N] [--no-oracle]
 *
 * Writes into --out:
 *   sid-header-findings.csv  one row per finding, with the xxd command that shows its bytes
 *   sid-header-audit.json    counts per rule, libsidplayfp outcomes, disagreements, header census
 *   sid-header-summary.md    the same counts as a short report
 *
 * Files are read in parallel by worker threads; each worker loads its own
 * libsidplayfp-wasm instance. Nothing is written into the HVSC tree.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import {
  checkSidHeader,
  createLibsidplayfpLoader,
  crossCheckLibsidplayfp,
  SID_HEADER_RULES,
  SID_SPEC_MD5,
  stringifyDeterministic,
  type JsonValue,
  type LibsidplayfpCrossCheck,
  type SidHeaderFields,
  type SidHeaderFinding,
  type SidHeaderRuleId,
} from "../packages/sidflow-common/src/index.js";

interface FileResult {
  path: string;
  md5: string;
  size: number;
  fields?: SidHeaderFields;
  findings: SidHeaderFinding[];
  oracle?: LibsidplayfpCrossCheck;
}

interface WorkerInput {
  root: string;
  files: string[];
  oracle: boolean;
}

async function auditFiles(input: WorkerInput): Promise<{ oracleVersion: string | null; results: FileResult[] }> {
  const oracle = input.oracle ? await createLibsidplayfpLoader() : null;
  const load = oracle?.load;
  const results: FileResult[] = [];
  for (const relative of input.files) {
    const buffer = await readFile(path.join(input.root, relative));
    const report = checkSidHeader(buffer);
    const result: FileResult = {
      path: relative,
      md5: createHash("md5").update(buffer).digest("hex"),
      size: buffer.length,
      fields: report.fields,
      findings: report.findings,
    };
    if (load) {
      result.oracle = crossCheckLibsidplayfp(report, load(buffer));
    }
    results.push(result);
  }
  return { oracleVersion: oracle?.version ?? null, results };
}

async function listSidFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sid"))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort();
}

function parseArgs(argv: string[]): { hvsc: string; out: string; workers: number; oracle: boolean } {
  let hvsc = "";
  let out = "";
  let workers = availableParallelism();
  let oracle = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--hvsc") hvsc = argv[++i] ?? "";
    else if (arg === "--out") out = argv[++i] ?? "";
    else if (arg === "--workers") workers = Number.parseInt(argv[++i] ?? "", 10);
    else if (arg === "--no-oracle") oracle = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!hvsc || !out || !Number.isInteger(workers) || workers < 1) {
    throw new Error("Usage: audit-sid-headers.ts --hvsc <C64Music dir> --out <dir> [--workers N] [--no-oracle]");
  }
  return { hvsc: path.resolve(hvsc), out: path.resolve(out), workers, oracle };
}

type WorkerOutput = Awaited<ReturnType<typeof auditFiles>>;

function runWorker(input: WorkerInput): Promise<WorkerOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: input });
    worker.once("message", (output: WorkerOutput) => resolve(output));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

const MODEL = ["unknown", "6581", "8580", "6581+8580"];
const CLOCK = ["unknown", "PAL", "NTSC", "PAL+NTSC"];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = await listSidFiles(args.hvsc);
  const shards: string[][] = Array.from({ length: args.workers }, () => []);
  files.forEach((file, index) => shards[index % args.workers]!.push(file));
  const started = Date.now();
  const outputs = await Promise.all(
    shards.filter((shard) => shard.length > 0).map((shard) => runWorker({ root: args.hvsc, files: shard, oracle: args.oracle }))
  );
  const oracleVersion = outputs[0]?.oracleVersion ?? null;
  const results = outputs.flatMap((output) => output.results).sort((a, b) => a.path.localeCompare(b.path));
  const elapsedMs = Date.now() - started;

  await mkdir(args.out, { recursive: true });

  const csv = ["path,md5,magic,version,rule,severity,offset,bytes,message,show_bytes,spec_lines,spec_clause,libsidplayfp,libsidplayfp_details"];
  type RuleCount = { severity: string; files: number; findings: number; rejected: number; normalised: number; accepted: number; examples: string[] };
  const rules: Record<string, RuleCount> = {};
  const census: Record<string, Record<string, number>> = {
    "magic/version": {}, clock: {}, sidModel1: {}, sidModel2: {}, sidModel3: {}, secondSIDAddress: {}, thirdSIDAddress: {}, flagBits: {}, oracle: {},
  };
  const disagreements: JsonValue[] = [];
  let violatingFiles = 0;

  for (const result of results) {
    const fields = result.fields;
    const version = fields?.version ?? "";
    if (fields) {
      increment(census["magic/version"]!, `${fields.magic} v${fields.version}`);
      if (fields.flags !== undefined) {
        increment(census.clock!, CLOCK[(fields.flags >> 2) & 3]!);
        increment(census.sidModel1!, MODEL[(fields.flags >> 4) & 3]!);
        if (fields.version >= 3) increment(census.sidModel2!, MODEL[(fields.flags >> 6) & 3]!);
        if (fields.version >= 4) increment(census.sidModel3!, MODEL[(fields.flags >> 8) & 3]!);
        for (let bit = 0; bit < 16; bit++) if (fields.flags & (1 << bit)) increment(census.flagBits!, `${fields.magic} bit ${bit}`);
        increment(census.secondSIDAddress!, `v${fields.version} $${(fields.secondSidAddress ?? 0).toString(16).toUpperCase().padStart(2, "0")}`);
        increment(census.thirdSIDAddress!, `v${fields.version} $${(fields.thirdSidAddress ?? 0).toString(16).toUpperCase().padStart(2, "0")}`);
      }
    }
    if (result.oracle) {
      increment(census.oracle!, result.oracle.outcome);
      for (const disagreement of result.oracle.disagreements) {
        disagreements.push({ path: result.path, md5: result.md5, disagreement, libsidplayfp: result.oracle.details.join("; ") });
      }
    }
    if (result.findings.some((finding) => finding.severity === "violation")) violatingFiles++;

    const seen = new Set<SidHeaderRuleId>();
    for (const finding of result.findings) {
      const count = (rules[finding.rule] ??= { severity: finding.severity, files: 0, findings: 0, rejected: 0, normalised: 0, accepted: 0, examples: [] });
      count.findings++;
      if (!seen.has(finding.rule)) {
        seen.add(finding.rule);
        count.files++;
        if (result.oracle) count[result.oracle.outcome]++;
        if (count.examples.length < 3) count.examples.push(`${result.path} (${result.md5})`);
      }
      const length = finding.bytes ? finding.bytes.split(" ").length : 0;
      const show = `xxd -s 0x${finding.offset.toString(16)} -l ${length} ${shellQuote(path.join(args.hvsc, result.path))}`;
      csv.push(
        [result.path, result.md5, fields?.magic ?? "", version, finding.rule, finding.severity, `0x${finding.offset.toString(16)}`, finding.bytes, finding.message, show, SID_HEADER_RULES[finding.rule].specLines, SID_HEADER_RULES[finding.rule].clause, result.oracle?.outcome ?? "", result.oracle?.details.join("; ") ?? ""]
          .map(csvField)
          .join(",")
      );
    }
  }

  const ruleIds = (Object.keys(SID_HEADER_RULES) as SidHeaderRuleId[]).filter((id) => rules[id]);
  const audit = {
    specMd5: SID_SPEC_MD5,
    libsidplayfp: oracleVersion,
    hvscRoot: args.hvsc,
    files: results.length,
    filesWithViolations: violatingFiles,
    filesWithFindings: results.filter((result) => result.findings.length > 0).length,
    workers: args.workers,
    elapsedMs,
    rules: Object.fromEntries(ruleIds.map((id) => [id, { ...rules[id]!, specLines: SID_HEADER_RULES[id].specLines, clause: SID_HEADER_RULES[id].clause }])),
    census,
    disagreements,
  };
  await writeFile(path.join(args.out, "sid-header-findings.csv"), `${csv.join("\n")}\n`);
  await writeFile(path.join(args.out, "sid-header-audit.json"), stringifyDeterministic(audit as unknown as JsonValue));
  await writeFile(path.join(args.out, "sid-header-summary.md"), renderSummary(audit, ruleIds, rules));
  console.log(`${results.length} files, ${violatingFiles} with violations, ${disagreements.length} disagreements with libsidplayfp, ${elapsedMs} ms with ${args.workers} workers`);
}

function renderSummary(
  audit: { libsidplayfp: string | null; files: number; filesWithViolations: number; filesWithFindings: number; disagreements: JsonValue[]; census: Record<string, Record<string, number>> },
  ruleIds: SidHeaderRuleId[],
  rules: Record<string, { severity: string; files: number; findings: number; rejected: number; normalised: number; accepted: number }>
): string {
  const lines = [
    "# SID header audit",
    "",
    `Spec: HVSC SID_file_format.txt, MD5 ${SID_SPEC_MD5}. libsidplayfp: ${audit.libsidplayfp ?? "not run"}. Files scanned: ${audit.files}. Files with at least one violation: ${audit.filesWithViolations}. Files with any finding: ${audit.filesWithFindings}.`,
    "",
    "\"libsidplayfp\" columns count files by what libsidplayfp's loader did with them: rejected, loaded with a changed value, or loaded unchanged.",
    "",
    "| Rule | Severity | Spec lines | Files | Findings | libsidplayfp rejected | normalised | accepted |",
    "|---|---|---|---:|---:|---:|---:|---:|",
  ];
  for (const id of ruleIds) {
    const count = rules[id]!;
    lines.push(`| \`${id}\` | ${count.severity} | ${SID_HEADER_RULES[id].specLines} | ${count.files} | ${count.findings} | ${count.rejected} | ${count.normalised} | ${count.accepted} |`);
  }
  lines.push(
    "",
    `Disagreements with libsidplayfp: ${audit.disagreements.length} (listed in sid-header-audit.json).`,
    "",
    "## Defensibility",
    "",
    "- A `violation` quotes a \"must\", \"MUST\" or \"Valid values\" sentence and is decided from the bytes at the reported offset (for the RSID load and init rules, also the first two data bytes). Each CSV row carries the `xxd` command that shows those bytes, so it can be checked without this tool.",
    "- A `recommendation` shows that the bytes differ from what a \"should\" sentence asks for. It is not non-conformance.",
    "- An `undefined` finding is a value the spec does not define or defines inconsistently. It is reported for visibility and never counted as non-conformance.",
    "- Not checked, because the file alone cannot decide them: whether a non-zero loadAddress duplicates a load address already in the data (spec lines 136-141), whether a 32-byte string was meant to be zero terminated (lines 249-251), whether a version 2 file is PSID v2 or v2NG (no marker exists), and whether a tune really needs a real C64 (the PSID/RSID choice).",
    "- libsidplayfp's loader is an independent implementation of the same rules. A rejection or a changed value corroborates a finding; a different conclusion is listed as a disagreement, not resolved.",
    "",
    "## Header census",
    ""
  );
  for (const [name, counts] of Object.entries(audit.census)) {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    lines.push(`- ${name}: ${entries.map(([key, value]) => `${key} = ${value}`).join(", ")}`);
  }
  lines.push("");
  return lines.join("\n");
}

if (isMainThread) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
} else {
  auditFiles(workerData as WorkerInput).then((output) => parentPort!.postMessage(output));
}
