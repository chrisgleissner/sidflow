/** Trace features of one (path, song, horizon, engine, mask) against the same engine's all-ROM reference.
 *
 *   bun scripts/rom-grade/trace-features.ts <sid> <song> <seconds> <residfp|sidlite> <mask 0|3>
 *
 * Library use: traceFeaturesFor(). Pure comparison logic is in trace-core.ts. */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { traceLane, type RomMask } from "./native.js";
import { sidInfo } from "./sid-info.js";
import { clockHzOf, computeTraceFeatures, type TraceFeatures } from "./trace-core.js";

export interface TraceFeatureResult { features: TraceFeatures; referenceChargenReads: number; variantChargenReads: number; cpuSeconds: number }

export async function traceFeaturesFor(file: string, song: number, seconds: number, engine: RomAuditEngine, mask: 0 | 3,
  referenceCache?: { reference?: Awaited<ReturnType<typeof traceLane>> }): Promise<TraceFeatureResult> {
  const bytes = readFileSync(file), info = sidInfo(bytes);
  const reference = referenceCache?.reference ?? await traceLane(engine, bytes, song, seconds, 7);
  if (referenceCache) referenceCache.reference = reference;
  const variant = await traceLane(engine, bytes, song, seconds, mask as RomMask);
  const features = computeTraceFeatures(reference.trace, variant.trace, { clockHz: clockHzOf(info.clock), horizonSeconds: seconds });
  return { features, referenceChargenReads: reference.chargenReads, variantChargenReads: variant.chargenReads, cpuSeconds: reference.cpuSeconds + variant.cpuSeconds };
}

if (import.meta.main) {
  const [file, song, seconds, engine, mask] = process.argv.slice(2);
  if (!file || !song || !seconds || !engine || !mask) throw new Error("usage: trace-features.ts <sid> <song> <seconds> <residfp|sidlite> <0|3>");
  const result = await traceFeaturesFor(path.resolve(file), Number(song), Number(seconds), engine as RomAuditEngine, Number(mask) as 0 | 3);
  process.stdout.write(stringifyDeterministic(JSON.parse(JSON.stringify(result)) as JsonValue));
}
