/** Fail-closed rollout gate. Pilot runs are capped by both denominators (see
 * ledger.ts for the durable accounting); a full run needs a hardening certificate
 * whose source identity, native renderer and evidence logs all still match.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { METHODOLOGY } from "./methodology.js";
import { ProcessLock, WORKSPACE } from "./ledger.js";
const root = path.resolve(import.meta.dir, "../..");
export const HARDENING_CERTIFICATE_SCHEMA = "sidflow-rom-hardening-2";
/** Files outside scripts/rom-audit/ whose content can change a decision. scripts/rom-audit/ itself is enumerated. */
export const HARDENING_EXTRA_SOURCES = [
  "packages/sidflow-common/src/rom-eligibility.ts", "packages/sidflow-common/src/index.ts", "packages/sidflow-common/src/json.ts",
  "packages/sidflow-common/src/sid-header-conformance.ts", "packages/sidflow-classify/src/render/system-roms-fetch.ts",
  "packages/sidflow-classify/package.json", "bun.lock",
  "packages/sidflow-common/test/rom-eligibility.test.ts", "packages/sidflow-common/test/rom-audit.test.ts",
  "packages/sidflow-common/test/rom-audit-adversarial.test.ts", "packages/sidflow-common/test/rom-audit-ledger.test.ts",
  "packages/sidflow-common/test/rom-audit-fixtures.ts",
] as const;
const ENGINE_DIST = "node_modules/libsidplayfp-wasm-audit/dist";
const sha = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
function listFiles(directory: string): string[] {
  return readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => path.relative(root, path.join(e.parentPath, e.name))).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}
/** Enumerated, not hand-listed: a new file under scripts/rom-audit/ or in the engine package cannot be left out. */
export function hardeningSources(): string[] {
  return [...listFiles("scripts/rom-audit"), ...HARDENING_EXTRA_SOURCES, ...listFiles(ENGINE_DIST)];
}
export async function hardeningIdentity(): Promise<string> {
  const hashes = await Promise.all(hardeningSources().map(async file => [file, sha(await readFile(path.join(root, file)))]));
  // git HEAD is deliberately not part of the identity: the architect approval is committed after
  // the sources are frozen, and committing it must not change the identity it approves.
  return sha(JSON.stringify({ hashes }));
}
export interface SuiteTotals { pass: number; fail: number; skip: number }
export interface HardeningCertificate {
  schema: typeof HARDENING_CERTIFICATE_SCHEMA; methodology: string; sourceIdentity: string;
  /** Source and WASM hashes of every engine the census used. */
  engines: Record<string, { sourceSha256: string; wasmSha256: string }>; passed: boolean;
  checks: {
    typecheck: boolean;
    focusedRuns: number; focusedTotals: SuiteTotals[]; fullSuiteRuns: number; fullSuiteTotals: SuiteTotals[];
    pilot: { manifestSha256: string; subtunes: number; files: number; failed: number };
    /** Digest of the decision-path regression (comparator regressions and synthetic programs on both engines). */
    decisionRegression: { digest: string };
    /** Fresh-process re-run equality on pilot subtunes. */
    reproducibility: { rows: number };
    adversarialReview: { file: string; sha256: string; sourceIdentity: string };
  };
  /** Log file name -> SHA-256, relative to the evidence directory next to the certificate. */
  logs: Record<string, string>;
}
const clean = (t: SuiteTotals | undefined): boolean =>
  !!t && [t.pass, t.fail, t.skip].every(Number.isSafeInteger) && t.pass > 0 && t.fail === 0 && t.skip === 0;
/** Structural validation only; use verifyHardeningEvidence to re-hash the logs. */
export function validateHardening(c: HardeningCertificate | undefined, identity: string): boolean {
  const k = c?.checks;
  return c?.schema === HARDENING_CERTIFICATE_SCHEMA && c.methodology === METHODOLOGY && c.sourceIdentity === identity && c.passed === true && !!k &&
    k.typecheck === true && Object.keys(c.engines ?? {}).length >= 1 &&
    Object.values(c.engines).every(e => /^[a-f0-9]{64}$/.test(e?.sourceSha256 ?? "") && /^[a-f0-9]{64}$/.test(e?.wasmSha256 ?? "")) &&
    k.focusedRuns >= 3 && k.focusedTotals?.length === k.focusedRuns && k.focusedTotals.every(clean) &&
    k.fullSuiteRuns >= 3 && k.fullSuiteTotals?.length === k.fullSuiteRuns && k.fullSuiteTotals.every(clean) &&
    k.pilot?.subtunes >= 50 && Number.isSafeInteger(k.pilot.failed) && k.pilot.failed === 0 &&
    /^[a-f0-9]{64}$/.test(k.decisionRegression?.digest ?? "") && k.reproducibility?.rows >= 5 &&
    k.adversarialReview?.sourceIdentity === identity && /^[a-f0-9]{64}$/.test(k.adversarialReview.sha256) && !!c.logs && Object.keys(c.logs).length >= 9;
}
/** Sum the per-batch summaries printed by bun test / run-unit-coverage-batches. */
export function suiteTotals(output: string): SuiteTotals {
  const total = { pass: 0, fail: 0, skip: 0 };
  for (const match of output.matchAll(/^\s*(\d+) (pass|fail|skip)\s*$/gm)) total[match[2] as keyof SuiteTotals] += Number(match[1]);
  return total;
}
/** Re-hash every recorded log (and the review) next to the certificate. */
export function verifyHardeningEvidence(c: HardeningCertificate, evidenceDir: string): boolean {
  let focused = 0, suites = 0, digestSeen = false;
  for (const [name, digest] of Object.entries(c.logs)) {
    const file = path.join(evidenceDir, name);
    if (path.basename(name) !== name || !existsSync(file)) return false;
    const bytes = readFileSync(file);
    if (sha(bytes) !== digest) return false;
    // Re-parse the evidence: a log that hashes correctly must also say what the certificate claims.
    const text = bytes.toString("utf8");
    if (/^focused-\d+\.log$/.test(name)) { const t = suiteTotals(text); if (t.fail !== 0 || t.pass === 0) return false; focused++; }
    if (/^full-suite-\d+\.log$/.test(name)) { const t = suiteTotals(text); if (t.fail !== 0 || t.skip !== 0 || t.pass === 0) return false; suites++; }
    if (name === "decision-regression.log") { if (new RegExp(`^DIGEST ${c.checks.decisionRegression.digest}$`, "m").exec(text) === null) return false; digestSeen = true; }
  }
  if (focused < 3 || suites < 3 || !digestSeen) return false;
  const review = path.join(root, c.checks.adversarialReview.file);
  return existsSync(review) && sha(readFileSync(review)) === c.checks.adversarialReview.sha256;
}
/** Serialize audit parents sharing a corpus; parallelism stays inside workers. */
export function scopeLock(corpus: string): void {
  new ProcessLock(path.join(WORKSPACE, `rom-audit-scope-${corpus}.lock`), "audit scope").acquire();
}
/** Pure preview of the pilot allowance. Dispatch-time enforcement lives in the ledger. */
export function pilotQueue<T extends { path: string; song: number }>(jobs: T[], completed: { path: string; song: number }[], files: number, songs: number): T[] {
  const maxSongs = Math.floor(songs * 0.05), maxFiles = Math.floor(files * 0.05), seen = new Set(completed.map(r => r.path));
  const known = new Set(completed.map(r => `${r.path}#${r.song}`));
  if (known.size > maxSongs || seen.size > maxFiles) throw new Error("Existing scope exceeds the 5% pilot ceiling; hardened full-rollout certificate required");
  const allowed: T[] = [];
  for (const job of jobs) {
    const key = `${job.path}#${job.song}`;
    if (known.has(key)) { allowed.push(job); continue; }
    if (known.size >= maxSongs || (!seen.has(job.path) && seen.size >= maxFiles)) continue;
    seen.add(job.path); known.add(key); allowed.push(job);
  }
  return allowed;
}
