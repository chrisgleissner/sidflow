/** Machine-readable publication for the methodology 4 census. Every header subtune is emitted,
 * including pending ones. Per engine: a research record with the measurements and a deny list
 * derived only from them; the production lookup is then checked against every decision.
 */
import { verifyReleaseMetadata } from "./inputs.js";
import { createHash } from "node:crypto";
import { existsSync, createWriteStream, readFileSync } from "node:fs";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createGzip, gzipSync } from "node:zlib";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { createRomEligibilityLookup, romEngineId, romSetId, romConsumerProfile, ROM_DENY_SCHEMA, ROM_AUDIT_ENGINES, REFERENCE_ROM_SHA256,
  type RomDenyList, type RomDecision, type RomSelection, type RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { assessMask, crossCheckDisagreements, headerFixesSidModels, METHODOLOGY, ROM_MASKS, CONSUMER_MASKS, type Horizon, type Assessment } from "./methodology.js";
import { readCensus } from "./checkpoint.js";
import type { Header } from "./publish.js";
export const sha = (v: string | Uint8Array): string => createHash("sha256").update(v).digest("hex");
const json = (v: unknown): string => stringifyDeterministic(v as JsonValue, 0);
export async function publishProduction(run: string, out = path.join(run, "published")): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(run, "manifest.json"), "utf8"));
  if (manifest.schema !== 4 || manifest.methodology !== METHODOLOGY) throw new Error("Production publication requires a methodology 4 census run");
  const headerText = await readFile(path.join(run, "headers.json"), "utf8"), horizonText = await readFile(path.join(run, "horizons.json"), "utf8");
  if (sha(headerText) !== manifest.headersSha256 || sha(horizonText) !== manifest.horizonsSha256) throw new Error("Header/horizon provenance mismatch");
  const headers = JSON.parse(headerText) as (Header & { header: unknown })[];
  const horizons = JSON.parse(horizonText) as Record<string, Horizon[]>;
  if (sha(headers.map(h => `${h.path}\t${h.sha256}\n`).join("")) !== manifest.corpusSha256) throw new Error("Corpus provenance mismatch");
  if (!Number.isFinite(manifest.seconds) || manifest.seconds <= 0) throw new Error("Invalid minimum horizon");
  await verifyReleaseMetadata(manifest, headers, horizons);
  // The manifest is deterministic JSON (sorted keys); the census engine order is the supported order.
  const engines = ROM_AUDIT_ENGINES.filter(e => Object.hasOwn(manifest.engines, e)) as RomAuditEngine[];
  if (!engines.length || engines.length !== Object.keys(manifest.engines).length) throw new Error("Census engines differ from the supported set");
  const censusPath = path.join(run, "census.jsonl");
  const censusText = existsSync(censusPath) ? readFileSync(censusPath, "utf8") : "";
  if (censusText && !censusText.endsWith("\n")) throw new Error("Truncated checkpoint; resume the audit to repair it before publication");
  const rows = readCensus(censusPath, engines, { repair: false });
  const expected = new Set(headers.flatMap(h => Array.from({ length: h.songs }, (_, i) => `${h.sha256}#${i + 1}`)));
  for (const key of rows.keys()) if (!expected.has(key)) throw new Error(`Unknown census record ${key}`);
  const denyLists = new Map<RomAuditEngine, RomDenyList>(engines.map(engine => [engine, {
    schema: ROM_DENY_SCHEMA, engineId: manifest.engines[engine].engineId, romSetId: romSetId(), methodology: METHODOLOGY, entries: {} }]));
  for (const engine of engines) {
    const declared = manifest.engines[engine];
    if (declared.engineId !== romEngineId(declared, romConsumerProfile(engine))) throw new Error(`Engine identity does not match its profile: ${engine}`);
  }
  const counts = Object.fromEntries(engines.map(e => [e, ROM_MASKS.map(mask => ({ mask, compatible: 0, incompatible: 0, unknown: 0, reasons: {} as Record<string, number> }))]));
  await mkdir(out, { recursive: true });
  const gzip = createGzip({ level: 9 }), destination = createWriteStream(path.join(out, "research.jsonl.gz.tmp"));
  const completion = pipeline(gzip, destination);
  let sampled = 0, disagreements = 0;
  const disagreementList: string[] = [];
  let represented = 0, observedSeconds = 0, plannedSeconds = 0, unknownLengths = 0, failed = 0;
  const windows: Record<string, number> = {};
  for (const h of headers) {
    if (Object.hasOwn(denyLists.get(engines[0]!)!.entries, h.sha256)) throw new Error(`Duplicate content identity ${h.path}`);
    const pairs = new Map<RomAuditEngine, RomDecision[]>(engines.map(e => [e, []]));
    for (let song = 1; song <= h.songs; song++) {
      const record = rows.get(`${h.sha256}#${song}`), horizon = horizons[h.path]?.[song - 1];
      if (!horizon) throw new Error(`Missing horizon ${h.path}#${song}`);
      if (record && record.seconds < horizon.seconds) throw new Error(`Census record shorter than the required horizon: ${h.path}#${song}`);
      if (record?.failure) failed++;
      const perEngine: Record<string, unknown> = {};
      for (const [index, engine] of engines.entries()) {
        const run = record?.failure ? undefined : record?.runs[index];
        const decisions: Assessment[] = ROM_MASKS.map(mask => record?.failure ? { state: "unknown", reason: "census-job-failed" } : assessMask(run, horizon, record?.seconds ?? 0, record?.sampleRate ?? manifest.sampleRate, mask));
        if (run?.extended && record) {
          sampled++;
          const bad = crossCheckDisagreements(run, horizon, record.seconds, record.sampleRate);
          if (bad.length) { disagreements += bad.length; disagreementList.push(`${h.path}#${song} masks ${bad.join(",")}`); }
        }
        let allowed = 0, incompatible = 0;
        decisions.forEach((d, mask) => {
          counts[engine]![mask]![d.state]++; counts[engine]![mask]!.reasons[d.reason] = (counts[engine]![mask]!.reasons[d.reason] ?? 0) + 1;
          if (d.state === "compatible") allowed |= 1 << mask;
          if (d.state === "incompatible") incompatible |= 1 << mask;
        });
        pairs.get(engine)!.push([allowed, incompatible, allowed ? Math.round(record!.seconds * 1000) : 0, allowed && horizon.documentedSeconds !== null ? Math.round(horizon.documentedSeconds * 1000) : 0, (allowed || incompatible) && headerFixesSidModels(h.header as never) ? 1 : 0]);
        perEngine[engine] = { reference: run?.reference ?? null, lanes: run?.lanes ?? null, assessments: decisions };
      }
      const out_ = { schema: "sidflow-rom-research-6", hvsc: 85, path: h.path, sha256: h.sha256, md5: h.md5, song, header: h.header,
        declared: { basic: h.basicFlag, kernal: "not separately declared", chargen: "not separately declared" }, horizon, seconds: record?.seconds ?? 0,
        failure: record?.failure ?? null, engines: perEngine, confidence: "bounded operational comparison only",
        unresolved: [horizon.limitation], provenance: { methodology: METHODOLOGY, engineIds: Object.fromEntries(engines.map(e => [e, manifest.engines[e].engineId])) }, legacyEvidence: "../index.md" };
      if (!gzip.write(json(out_))) await once(gzip, "drain");
      plannedSeconds += horizon.seconds; if (horizon.documentedSeconds === null) unknownLengths++;
      represented++; observedSeconds += record?.seconds ?? 0; windows[record?.seconds ?? 0] = (windows[record?.seconds ?? 0] ?? 0) + 1;
    }
    for (const engine of engines) denyLists.get(engine)!.entries[h.sha256] = pairs.get(engine)!;
  }
  gzip.end(); await completion;
  if (represented !== manifest.songs || headers.length !== manifest.files) throw new Error("Publication population mismatch");
  // Exhaustively check the production lookup against every decision, and that unsupported ROM sets deny.
  const selection = (mask: number): RomSelection => ({ kernal: mask & 1 ? REFERENCE_ROM_SHA256.kernal : null, basic: mask & 2 ? REFERENCE_ROM_SHA256.basic : null, chargen: mask & 4 ? REFERENCE_ROM_SHA256.chargen : null });
  for (const engine of engines) {
    const lookup = createRomEligibilityLookup(denyLists.get(engine)!, { sourceSha256: manifest.engines[engine].sourceSha256, wasmSha256: manifest.engines[engine].wasmSha256, profile: romConsumerProfile(engine), methodology: METHODOLOGY, fallbackSidModel: "MOS8580" });
    for (const h of headers) for (let song = 1; song <= h.songs; song++) for (const mask of ROM_MASKS) {
      const pair = denyLists.get(engine)!.entries[h.sha256]![song - 1]!, d = lookup(h.sha256, song, selection(mask));
      const supported = (CONSUMER_MASKS as readonly number[]).includes(mask);
      const state = !supported ? "unknown" : pair[0] & (1 << mask) ? "compatible" : pair[1] & (1 << mask) ? "incompatible" : "unknown";
      if (d.state !== state || d.eligible !== (state === "compatible")) throw new Error(`Deny lookup consistency failure (${engine}, mask ${mask})`);
    }
  }
  await rename(path.join(out, "research.jsonl.gz.tmp"), path.join(out, "research.jsonl.gz"));
  const artifacts: Record<string, string> = { "research.jsonl.gz": sha(await readFile(path.join(out, "research.jsonl.gz"))) };
  for (const engine of engines) {
    const text = json(denyLists.get(engine)!), name = `deny-list.${engine}.json`;
    await writeFile(path.join(out, name), text); artifacts[name] = sha(text);
  }
  const raw = gzipSync(censusText, { level: 9 });
  await writeFile(path.join(out, "census.jsonl.gz"), raw); artifacts["census.jsonl.gz"] = sha(raw);
  const publication = { schema: "sidflow-rom-manifest-6", methodology: METHODOLOGY, hvsc: 85, files: headers.length, subtunes: represented,
    engines: manifest.engines, roms: manifest.roms, documents: manifest.documents, corpusSha256: manifest.corpusSha256, counts, windows, observedSeconds, plannedSeconds, unknownLengths,
    measuredSubtunes: rows.size, failedSubtunes: failed, extendedEvery: manifest.extendedEvery, crossCheck: { sampledSubtunes: sampled, disagreements, examples: disagreementList.slice(0, 20) }, pendingSubtunes: represented - rows.size,
    strictPolicy: "unknown/absent/expired/unsupported evidence denies; allowed playback must end at the recorded horizon", artifacts };
  await writeFile(path.join(out, "manifest.json"), stringifyDeterministic(publication as unknown as JsonValue));
  console.log(`Published ${represented} research rows; ${rows.size} measured (${failed} failed); ${represented - rows.size} pending.`);
}

