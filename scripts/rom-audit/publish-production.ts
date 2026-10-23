/** Machine-readable publication helper for publish.ts and the existing runner.
 * Every header subtune is emitted, including pending experiments. No inferred
 * compatibility from the historical four-configuration catalogue.
 */
import { verifyReleaseMetadata } from "./inputs.js";
import { createHash } from "node:crypto";
import { existsSync, createWriteStream } from "node:fs";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createGzip, gzipSync } from "node:zlib";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { stringifyDeterministic, type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { createRomEligibilityLookup, romEngineId, romSetId, ROM_DENY_SCHEMA, REFERENCE_ROM_SHA256, type RomDenyList,type RomDecision,type RomSelection } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { validateMatrix, exactWrites, assess, screen, CONSUMER_PROFILE, AUDIT_PROTOCOL, METHODOLOGY, ROM_MASKS, type Horizon, type Confirmation } from "./methodology.js";
import { CONFIRMATION_SCHEMA, verdictFromConfirmation, type JobResult } from "./confirm.js";
import type { Execution } from "./analysis.js";
import type { Header } from "./publish.js";
export const sha = (v: string | Uint8Array):string => createHash("sha256").update(v).digest("hex");
const json = (v:unknown):string => stringifyDeterministic(v as JsonValue,0);
export async function publishProduction(run:string,out=path.join(run,"published")):Promise<void> {
  const manifest=JSON.parse(await readFile(path.join(run,"manifest.json"),"utf8"));
  if (manifest.schema!==3 || manifest.methodology!==METHODOLOGY || json(manifest.protocol)!==json(AUDIT_PROTOCOL))
    throw new Error("Production publication requires methodology v3 / safe native pulls");
  const headerText=await readFile(path.join(run,"headers.json"),"utf8"),horizonText=await readFile(path.join(run,"horizons.json"),"utf8");
  if(sha(headerText)!==manifest.headersSha256||sha(horizonText)!==manifest.horizonsSha256)throw new Error("Header/horizon provenance mismatch");
  const headers=JSON.parse(headerText) as (Header & {header:unknown})[];
  const horizons=JSON.parse(horizonText) as Record<string,Horizon[]>;
  if (sha(headers.map(h=>`${h.path}\t${h.sha256}\n`).join(""))!==manifest.corpusSha256) throw new Error("Corpus provenance mismatch");
  const raw=existsSync(path.join(run,"execution.jsonl"))?await readFile(path.join(run,"execution.jsonl"),"utf8"):"";
  if (raw && !raw.endsWith("\n")) throw new Error("Truncated checkpoint; resume audit to repair before publication");
  if(!Number.isFinite(manifest.seconds)||manifest.seconds<=0)throw new Error("Invalid minimum horizon");
  await verifyReleaseMetadata(manifest,headers,horizons);
  const rows=new Map<string,Execution>();
  const expected=new Map<string,Header>(headers.flatMap(h=>Array.from({length:h.songs},(_,i)=>[`${h.path}#${i+1}`,h] as const)));
  for (const line of raw.split("\n").filter(Boolean)) {
    const r=JSON.parse(line) as Execution,key=`${path.relative(manifest.hvscRoot,r.path)}#${r.song}`;
    if (!expected.has(key)||rows.has(key)||!r.matrix||r.matrix.length!==8) throw new Error(`Unknown/duplicate/invalid matrix: ${key}`);
    validateMatrix(r);
    for (const m of [...r.matrix,r.both,r.repeat]) {
      if (!m || Object.values(m).some(v=>typeof v==="number"&&!Number.isFinite(v))) throw new Error(`Invalid measurement: ${key}`);
      if (!m.error && m.samples!==Math.round(r.seconds*8000)*2) throw new Error(`Incomplete render: ${key}`);
    }
    rows.set(key,r);
  }
  // Allow evidence comes only from the shipping engine (confirm.ts) under the
  // consumer profile. Native results screen: they can deny and nominate.
  const confirmations=new Map<string,JobResult>();
  const confirmationPath=path.join(run,"confirmation.jsonl");
  const confirmationText=existsSync(confirmationPath)?await readFile(confirmationPath,"utf8"):"";
  if(confirmationText&&!confirmationText.endsWith("\n"))throw new Error("Truncated confirmation log; resume confirm.ts before publication");
  for(const line of confirmationText.split("\n").filter(Boolean)){
    const c=JSON.parse(line) as JobResult,key=`${c.sha256}#${c.song}#${c.seconds}`;
    if(c.schema!==CONFIRMATION_SCHEMA||c.sampleRate!==CONSUMER_PROFILE.sampleRate||c.powerOnDelay!==CONSUMER_PROFILE.powerOnDelay||confirmations.has(key)||!Array.isArray(c.results))
      throw new Error(`Invalid or duplicate confirmation ${key}`);
    confirmations.set(key,c);
  }
  const engine={sourceSha256:manifest.sourceSha256 as string,wasmSha256:manifest.wasmSha256 as string};
  const engineId=romEngineId(engine),romSet=romSetId();
  if(json(manifest.roms)!==json({"kernal.901227-03.bin":REFERENCE_ROM_SHA256.kernal,"basic.901226-01.bin":REFERENCE_ROM_SHA256.basic,"characters.901225-01.bin":REFERENCE_ROM_SHA256.chargen})&&Object.keys(manifest.roms??{}).length)
    throw new Error("Manifest ROMs are not the reference images");
  const confirmationFor=(sha256:string,song:number,mask:number,r:Execution|undefined,horizon:Horizon):Confirmation=>{
    if(!r)return undefined;
    const job=confirmations.get(`${sha256}#${song}#${r.seconds}`);
    if(!job)return undefined;
    return verdictFromConfirmation(screen(r.matrix?.[mask],r.both,r.repeat,r.seconds,horizon).state,job.results.find(x=>x.mask===mask),r,mask);
  };
  const deny:RomDenyList={schema:ROM_DENY_SCHEMA,engineId,romSetId:romSet,methodology:METHODOLOGY,entries:{}};
  const counts=ROM_MASKS.map(mask=>({mask,compatible:0,incompatible:0,unknown:0,executionErrors:0,exactWriteDifferences:0,pcmDifferences:0,shippingEngineMismatches:0,reasons:{} as Record<string,number>}));
  await mkdir(out,{recursive:true});
  const gzip=createGzip({level:9}),destination=createWriteStream(path.join(out,"research.jsonl.gz.tmp"));
  const completion=pipeline(gzip,destination);
  let represented=0, observedSeconds=0, plannedSeconds=0, unknownLengths=0, feedbackReaders=0;
  const windows:Record<string,number>={};
  for (const h of headers) {
    if (Object.hasOwn(deny.entries,h.sha256)) throw new Error(`Duplicate content identity ${h.path}`);
    const pairs:RomDecision[]=[];
    for (let song=1;song<=h.songs;song++) {
      const r=rows.get(`${h.path}#${song}`), horizon=horizons[h.path]?.[song-1];
      if (!horizon) throw new Error(`Missing horizon ${h.path}#${song}`);
      const decisions=ROM_MASKS.map(mask=>assess(r?.matrix?.[mask],r?.both,r?.repeat,r?.seconds??0,horizon,confirmationFor(h.sha256,song,mask,r,horizon)));
      r?.matrix?.forEach((m,mask)=>{
        if(m.error)counts[mask]!.executionErrors++;
        if(!exactWrites(m,r.both))counts[mask]!.exactWriteDifferences++;
        if(!m.equal)counts[mask]!.pcmDifferences++;
      });
      let allowed=0,incompatible=0;
      decisions.forEach((d,mask)=>{
        counts[mask]![d.state]++;counts[mask]!.reasons[d.reason]=(counts[mask]!.reasons[d.reason]??0)+1;
        if(d.reason==="shipping-engine-disagrees-with-native-screen")counts[mask]!.shippingEngineMismatches++;
        if(d.state==="compatible")allowed|=1<<mask;if(d.state==="incompatible")incompatible|=1<<mask;});
      const feedback=r?.both.sidReadbackReads??null;
      if(feedback)feedbackReaders++;
      pairs.push([allowed,incompatible,allowed?Math.round((r?.seconds??0)*1000):0,allowed&&horizon.documentedSeconds!==null?Math.round(horizon.documentedSeconds*1000):0]);
      const job=r?confirmations.get(`${h.sha256}#${song}#${r.seconds}`):undefined;
      const record={schema:"sidflow-rom-research-4",hvsc:85,path:h.path,sha256:h.sha256,md5:h.md5,song,
        header:h.header,declared:{basic:h.basicFlag,kernal:"not separately declared",chargen:"not separately declared"},
        horizon,seconds:r?.seconds??0,reference:r?.both??null,repeat:r?.repeat??null,
        sidReadbackReads:feedback,
        experiments:ROM_MASKS.map(mask=>({mask,measurement:r?.matrix?.[mask]??null,assessment:decisions[mask],
          shippingEngine:job?.results.find(x=>x.mask===mask)??null})),
        confidence:"bounded operational comparison only",unresolved:[horizon.limitation,...new Set(decisions.filter(d=>d.state==="unknown").map(d=>d.reason))],
        provenance:{engineId,romSetId:romSet,methodology:METHODOLOGY},legacyEvidence:"../index.md"};
      if (!gzip.write(json(record))) await once(gzip,"drain");
      plannedSeconds+=horizon.seconds;if(horizon.documentedSeconds===null)unknownLengths++;
      represented++;observedSeconds+=r?.seconds??0;windows[r?.seconds??0]=(windows[r?.seconds??0]??0)+1;
    }
    deny.entries[h.sha256]=pairs;
  }
  gzip.end();await completion;
  if (represented!==manifest.songs || headers.length!==manifest.files) throw new Error("Publication population mismatch");
  // Exhaustively check the actual production API against every research decision.
  const lookup=createRomEligibilityLookup(deny,{...engine,profile:CONSUMER_PROFILE,methodology:METHODOLOGY});
  const selection=(mask:number):RomSelection=>({kernal:mask&1?REFERENCE_ROM_SHA256.kernal:null,basic:mask&2?REFERENCE_ROM_SHA256.basic:null,chargen:mask&4?REFERENCE_ROM_SHA256.chargen:null});
  for (const h of headers) for(let song=1;song<=h.songs;song++) for(const mask of ROM_MASKS) {
    const pair=deny.entries[h.sha256]![song-1]!, d=lookup(h.sha256,song,selection(mask));
    const state=pair[0]&(1<<mask)?"compatible":pair[1]&(1<<mask)?"incompatible":"unknown";
    if(d.state!==state||d.eligible!==(state==="compatible"))throw new Error("Deny lookup consistency failure");
  }
  await rename(path.join(out,"research.jsonl.gz.tmp"),path.join(out,"research.jsonl.gz"));
  const denyText=json(deny);await writeFile(path.join(out,"deny-list.json"),denyText);
  const confirmationGzip=gzipSync(confirmationText,{level:9});
  await writeFile(path.join(out,"confirmation.jsonl.gz"),confirmationGzip);
  const confirmedExperiments=[...confirmations.values()].reduce((n,c)=>n+c.results.length,0);
  const publication={schema:"sidflow-rom-manifest-4",methodology:METHODOLOGY,hvsc:85,files:headers.length,subtunes:represented,
    engineId,romSetId:romSet,consumerProfile:CONSUMER_PROFILE,
    engine:{package:"libsidplayfp-wasm",version:"1.0.1",sourceSha256:manifest.sourceSha256,wasmSha256:manifest.wasmSha256},
    screening:{nativeSha256:manifest.nativeSha256,protocol:manifest.protocol},
    roms:manifest.roms,documents:manifest.documents,corpusSha256:manifest.corpusSha256,counts,windows,observedSeconds,plannedSeconds,unknownLengths,
    subtunesReadingSidFeedbackRegisters:feedbackReaders,
    completedExperiments:rows.size*8,pendingSubtunes:represented-rows.size,pendingExperiments:(represented-rows.size)*8,
    confirmation:{subtunes:confirmations.size,experiments:confirmedExperiments,toolSha256:sha(await readFile(path.join(import.meta.dir,"confirm.ts")))},
    strictPolicy:"unknown/absent/expired/unconfirmed evidence denies; allowed playback must end at recorded horizon",
    artifacts:{"research.jsonl.gz":sha(await readFile(path.join(out,"research.jsonl.gz"))),"deny-list.json":sha(denyText),"confirmation.jsonl.gz":sha(confirmationGzip)}};
  await writeFile(path.join(out,"manifest.json"),stringifyDeterministic(publication as unknown as JsonValue));
  console.log(`Published ${represented} research rows; ${rows.size} measured; ${confirmations.size} confirmed on the shipping engine; ${represented-rows.size} pending.`);
}
