/** Evidence labels, deliberately distinct from a claim of perpetual ROM independence. */
export interface Measurement {
  error: string;
  /** cpu-halt | engine | resource; empty when error is empty. */
  errorKind?: string;
  /** CPU reads of SID registers $19-$1C, which feed sampled state back to the program. */
  sidReadbackReads?: number;
  samples: number;
  hash: string;
  acRms: number;
  equal: boolean;
  differingSamples: number;
  peakDifference: number;
  differenceRms: number;
  firstDifferenceSec: number | null;
  sidWrites: number;
  matchingWritePrefix: number;
  startupOffsetCycles: number;
  maxRelativeWriteDriftCycles: number;
  basicReads?: number;
  kernalReads?: number;
  chargenReads?: number;
  traceComplete?: boolean;
  traceHash?: string;
  firstWriteDivergence?: { index: number; actual: number[] | null; reference: number[] | null } | null;
  derivedFrom?: string;
}
export interface Execution {
  path: string;
  song: number;
  seconds: number;
  matrix?: Measurement[];
  both: Measurement;
  repeat: Measurement;
  neither: Measurement;
  kernal: Measurement;
  basic: Measurement;
}
export const QUIET_RMS = 0.001; // -60 dBFS, after removing each channel's DC
export function material(value: Measurement, reference: Measurement): boolean {
  return !!value.error || value.samples !== reference.samples ||
    value.differenceRms >= Math.max(QUIET_RMS, reference.acRms * 0.1);
}
/** A change in register values inside the common sequence, or a stopped sequence.
 * A short boundary suffix is reported separately, not called a changed tune.
 */
export function executionChanged(value: Measurement, reference: Measurement): boolean {
  if (value.error || value.samples !== reference.samples) return true;
  const common = Math.min(value.sidWrites,reference.sidWrites);
  return value.matchingWritePrefix < common ||
    Math.abs(value.sidWrites-reference.sidWrites) > Math.max(32,reference.sidWrites * 0.02) ||
    value.maxRelativeWriteDriftCycles > 5000;
}
export function evidence(row: Execution): string {
  if (row.both.error || row.both.samples !== Math.round(row.seconds * 8000) * 2) return "reference-error";
  if (!row.repeat.equal || row.repeat.sidWrites !== row.both.sidWrites ||
      row.repeat.matchingWritePrefix !== row.both.sidWrites ||
      row.repeat.maxRelativeWriteDriftCycles !== 0 || row.repeat.startupOffsetCycles !== 0) return "unstable-reference";
  if (row.both.acRms < QUIET_RMS) return "quiet-reference";
  if (row.both.sidWrites < 64) return "insufficient-reference-activity";
  const missingK = executionChanged(row.basic, row.both);
  const missingB = executionChanged(row.kernal, row.both);
  if (missingK && missingB) return "both-sensitive";
  if (missingK) return "kernal-sensitive";
  if (missingB) return "basic-sensitive";
  if (executionChanged(row.neither, row.both)) return "combined-removal-sensitive";
  if (![row.neither, row.kernal, row.basic].every((m) => m.equal)) return "pcm-difference-with-similar-write-sequence";
  return "identical-in-window";
}
export function parseStil(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  let name = "", lines: string[] = [];
  const flush = (): void => {
    if (name) {
      if (entries.has(name)) throw new Error(`Duplicate STIL entry: ${name}`);
      entries.set(name, lines.join("\n").trim());
    }
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (line.startsWith("/")) { flush(); name = line.slice(1); lines = []; }
    else if (line.startsWith("#")) { flush(); name = ""; lines = []; }
    else if (name) lines.push(line);
  }
  flush();
  return entries;
}
export function stilFor(path: string, entries: Map<string, string>): string {
  const parts = path.split("/");
  const applicable: string[] = [];
  for (let n = 1; n < parts.length; n++) {
    const dir = parts.slice(0, n).join("/") + "/";
    const value = entries.get(dir);
    if (value) applicable.push(`Directory note /${dir}\n${value}`);
  }
  const entry = entries.get(path);
  if (entry) applicable.push(entry);
  return applicable.join("\n\n") || "No STIL entry or applicable directory note in this release.";
}
export function csv(value: string | number | boolean | null): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function percent(n: number, denominator: number): string {
  return denominator ? (100 * n / denominator).toFixed(4) + "%" : "n/a";
}
