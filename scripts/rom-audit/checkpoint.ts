/** Crash-safe JSONL census checkpoint. Completed records are immutable. A torn final record
 * is preserved byte for byte and requeued; interior damage fails. Only the process holding
 * the corpus scope lock may repair (truncate) a file; everyone else reads without modifying it.
 */
import { appendFileSync, existsSync, readFileSync, truncateSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateRecord, type CensusRecord } from "./methodology.js";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";

export const censusKey = (r: { sha256: string; song: number }): string => `${r.sha256}#${r.song}`;
export function readCensus(file: string, engines: readonly RomAuditEngine[], options: { repair: boolean }): Map<string, CensusRecord> {
  const rows = new Map<string, CensusRecord>();
  if (!existsSync(file)) return rows;
  const bytes = readFileSync(file);
  let end = bytes.length;
  if (end && bytes[end - 1] !== 10) {
    end = bytes.lastIndexOf(10) + 1;
    if (options.repair) {
      const tail = bytes.subarray(end);
      appendFileSync(`${file}.interrupted-tail.${createHash("sha256").update(tail).digest("hex").slice(0, 16)}`, tail);
      truncateSync(file, end);
      console.warn("Preserved incomplete checkpoint tail; resuming complete records");
    }
  }
  for (const line of bytes.subarray(0, end).toString("utf8").split("\n").filter(Boolean)) {
    const record = JSON.parse(line) as CensusRecord;
    validateRecord(record, engines);
    const key = censusKey(record);
    // A retried failure supersedes its earlier failure record; any other duplicate is corruption.
    if (rows.has(key) && !rows.get(key)!.failure) throw new Error(`Duplicate checkpoint result ${key}`);
    rows.set(key, record);
  }
  return rows;
}
