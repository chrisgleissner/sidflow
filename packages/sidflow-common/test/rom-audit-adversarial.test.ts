import { describe,it,expect } from "bun:test";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assess,observationHorizon,validateMatrix,METHODOLOGY } from "../../../scripts/rom-audit/methodology.js";
import { pilotQueue,validateHardening,verifyHardeningEvidence,hardeningSources,type HardeningCertificate } from "../../../scripts/rom-audit/rollout.js";
import { readdirSync,readFileSync } from "node:fs";
import { publishProduction,sha } from "../../../scripts/rom-audit/publish-production.js";
import { releaseLengths } from "../../../scripts/rom-audit/inputs.js";
import { createRomEligibilityLookup,romEngineId,romSetId,REFERENCE_ROM_SHA256,ROM_CONSUMER_PROFILE,type RomDenyList,type RomSelection } from "../src/rom-eligibility.js";
import { measurement,execution,publicationFixture,fixtureHash,stable,confirmationLine } from "./rom-audit-fixtures.js";
const engine={sourceSha256:"1".repeat(64),wasmSha256:"2".repeat(64)};
const expected={...engine,profile:ROM_CONSUMER_PROFILE,methodology:METHODOLOGY};
const none:RomSelection={kernal:null,basic:null,chargen:null};
const full:RomSelection={...REFERENCE_ROM_SHA256};
const table=():RomDenyList=>({schema:"sidflow-rom-deny-3",engineId:romEngineId(engine),romSetId:romSetId(),methodology:METHODOLOGY,entries:{[fixtureHash]:[[255,0,15000,10000]]}});
describe("adversarial ROM audit review",()=>{
 it("cannot turn finite equality into indefinite looping permission",()=>{
  const lookup=createRomEligibilityLookup(table(),expected);
  expect(lookup(fixtureHash,1,none).maxPlaybackSeconds).toBe(15);
  expect(lookup(fixtureHash,1,none,14.999).eligible).toBe(true);
  expect(lookup(fixtureHash,1,none,15).reason).toBe("observation-horizon-exhausted");
  expect(lookup(fixtureHash,1,none,Infinity).eligible).toBe(false);
 });
 it("rejects malformed, obsolete, horizon-free and mutable tables",()=>{
  for(const mutation of [
   (d:RomDenyList)=>{d.entries[fixtureHash]=[[1,0,0,0]];},
   (d:RomDenyList)=>{d.entries[fixtureHash]=[[1,0,15000,15000]];},   // documented duration must be shorter than the deadline
   (d:RomDenyList)=>{d.entries[fixtureHash]=[[1,0,15000]] as unknown as RomDenyList["entries"][string];},   // old 3-field tuple
   (d:RomDenyList)=>{d.entries[fixtureHash]=[[1,0,Infinity,1]];},
   (d:RomDenyList)=>{d.entries[fixtureHash]=[[1,0,1.5,1]];},
   (d:RomDenyList)=>{d.entries[fixtureHash]=[[256,0,15000,10000]];},
   (d:RomDenyList)=>{d.methodology="rom-audit-2";},
   (d:RomDenyList)=>{d.engineId="";},
   (d:RomDenyList)=>{d.schema="sidflow-rom-deny-2" as RomDenyList["schema"];},
  ]){const d=table();mutation(d);expect(createRomEligibilityLookup(d,expected)(fixtureHash,1,none).eligible).toBe(false);}
  const d=table(),lookup=createRomEligibilityLookup(d,expected);d.entries[fixtureHash]![0]![0]=0;
  expect(lookup(fixtureHash,1,none).eligible).toBe(true);
  expect(createRomEligibilityLookup(null as unknown as RomDenyList,expected)(fixtureHash,1,none).eligible).toBe(false);
 });
 it("cannot promote malformed horizons or defective repeat controls",()=>{
  const m=measurement(),h=observationHorizon("0:10");
  for(const invalid of [{...h,seconds:NaN},{...h,seconds:2},{...h,documentedSeconds:1},{...h,source:"invented" as typeof h.source},
    {...h,seconds:15.000000001}])expect(assess(m,m,m,15,invalid,true).state).toBe("unknown");
  expect(assess(m,m,{...m,error:"CPU failure"},15,h,true).state).toBe("unknown");
  expect(assess(m,{...m,equal:false},m,15,h,true).state).toBe("unknown");
  expect(assess(m,m,m,NaN,h,true).state).toBe("unknown");
  expect(assess({...m,sidWrites:-1},m,m,15,h,true).state).toBe("unknown");
  expect(()=>observationHorizon("1:00",Infinity)).toThrow();
  expect(observationHorizon("9".repeat(400)+":00").documentedSeconds).toBeNull();
 });
 it("rejects shifted masks, contradictory equality, truncated matrices and malformed first divergences",()=>{
  const r=execution("/fixture");expect(()=>validateMatrix(r)).not.toThrow();
  const bad=structuredClone(r);bad.matrix![7]!.basicReads=1;expect(()=>validateMatrix(bad)).toThrow("alias mismatch");
  const contradictory=structuredClone(r);contradictory.matrix![0]!.differenceRms=0.1;expect(()=>validateMatrix(contradictory)).toThrow("Contradictory PCM");
  const timing=structuredClone(r);timing.matrix![0]!.startupOffsetCycles=1;expect(()=>validateMatrix(timing)).toThrow("timed-write equality");
  const malformed=structuredClone(r);malformed.matrix![0]!.firstWriteDivergence={index:2,actual:[0,32,256,-1],reference:null};expect(()=>validateMatrix(malformed)).toThrow("divergence");
  expect(()=>validateMatrix({...r,matrix:r.matrix!.slice(1)})).toThrow();
 });
 it("preserves missing-duration slots and rejects release-index ambiguities",()=>{
  const index=releaseLengths(`; /a.sid\n${"a".repeat(32)}=0:10 ? 2:00\n`);
  expect(index.get("a.sid")!.tokens).toEqual(["0:10","?","2:00"]);
  expect(()=>releaseLengths(`; /a.sid\n${"a".repeat(32)}=0:10\n; /a.sid\n${"b".repeat(32)}=1:00\n`)).toThrow();
  expect(()=>releaseLengths(`; /../a.sid\n${"a".repeat(32)}=0:10\n`)).toThrow();
 });
 it("enforces both 5% denominators across previous pilots without double-counting retries",()=>{
  const jobs=Array.from({length:100},(_,i)=>({path:`file${i}`,song:1}));
  expect(pilotQueue(jobs,[],100,100)).toHaveLength(5);
  expect(pilotQueue(jobs,jobs.slice(0,5),100,100)).toHaveLength(5);
  expect(()=>pilotQueue(jobs,jobs.slice(0,6),100,100)).toThrow("5%");
  const sameFile=Array.from({length:100},(_,i)=>({path:"one-file",song:i+1}));
  expect(pilotQueue(sameFile,[],100,100)).toHaveLength(5);
  expect(pilotQueue(jobs,[],20,100)).toHaveLength(1);
 });
 it("requires a source/native-bound complete hardening certificate before full rollout",()=>{
  const clean={pass:10,fail:0,skip:0};
  const c:HardeningCertificate={schema:"sidflow-rom-hardening-2",methodology:METHODOLOGY,sourceIdentity:"s",nativeSha256:"n",asanSha256:"a".repeat(64),
   engine:{sourceSha256:"x",wasmSha256:"y"},passed:true,
   checks:{typecheck:true,nativeRegression:true,sanitizer:true,exactParity:true,parityCases:104,focusedRuns:3,focusedTotals:[clean,clean,clean],
    fullSuiteRuns:3,fullSuiteTotals:[clean,clean,clean],pilot:{manifestSha256:"m",subtunes:100,files:50},decisionRegression:{digest:"d".repeat(64),sanitizerDigest:"d".repeat(64)},reproducibility:{rows:6},shippingEngine:{confirmedSubtunes:60,mismatches:0},
    adversarialReview:{file:"r.md",sha256:"b".repeat(64),sourceIdentity:"s"}},
   logs:Object.fromEntries(Array.from({length:14},(_,i)=>[`l${i}.log`,"c".repeat(64)]))};
  expect(validateHardening(c,"s","n")).toBe(true);
  expect(validateHardening(undefined,"s","n")).toBe(false);
  expect(validateHardening(c,"changed","n")).toBe(false);
  expect(validateHardening(c,"s","other-native")).toBe(false);
  const mutate=(f:(x:HardeningCertificate)=>void):boolean=>{const x=structuredClone(c);f(x);return validateHardening(x,"s","n");};
  expect(mutate(x=>{x.checks.exactParity=false;})).toBe(false);
  expect(mutate(x=>{x.checks.fullSuiteRuns="3" as unknown as number;})).toBe(false);
  expect(mutate(x=>{x.checks.fullSuiteTotals[1]={pass:10,fail:1,skip:0};})).toBe(false);
  expect(mutate(x=>{x.checks.fullSuiteTotals[2]={pass:10,fail:0,skip:1};})).toBe(false);
  expect(mutate(x=>{x.checks.fullSuiteTotals.pop();})).toBe(false);
  expect(mutate(x=>{x.checks.focusedTotals[0]={pass:0,fail:0,skip:0};})).toBe(false);
  expect(mutate(x=>{x.checks.adversarialReview.sourceIdentity="older";})).toBe(false);
  expect(mutate(x=>{x.checks.parityCases=3;})).toBe(false);
  expect(mutate(x=>{x.checks.pilot.subtunes=3;})).toBe(false);
  expect(mutate(x=>{x.logs={};})).toBe(false);
  expect(mutate(x=>{x.checks.decisionRegression.sanitizerDigest="e".repeat(64);})).toBe(false);
  expect(mutate(x=>{x.checks.reproducibility.rows=0;})).toBe(false);
  expect(mutate(x=>{x.checks.shippingEngine.confirmedSubtunes=1;})).toBe(false);
  expect(mutate(x=>{x.schema="sidflow-rom-hardening-1" as HardeningCertificate["schema"];})).toBe(false);
 });
});

for(const kind of ["valid","stale-outcome","no-confirmation","engine-disagrees","forged-confirmation-sample-count","shortened-horizon","changed-release-document","corrupt-header"]){
 it(`publication adversary: ${kind}`,async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"rom-adversarial-"));
  try{
   const {manifest,row,horizons}=await publicationFixture(dir,true);
   if(kind==="stale-outcome"){row.matrix![0]!.basicReads=1;await writeFile(path.join(dir,"execution.jsonl"),stable(row));}
   if(kind==="no-confirmation")await rm(path.join(dir,"confirmation.jsonl"));
   if(kind==="engine-disagrees")await writeFile(path.join(dir,"confirmation.jsonl"),confirmationLine(15,"different")+"\n");
   if(kind==="forged-confirmation-sample-count")await writeFile(path.join(dir,"confirmation.jsonl"),confirmationLine(15,"identical",{samples:2})+"\n");
   if(kind==="shortened-horizon"){
    horizons["silent.sid"]![0]!.seconds=2;const raw=stable(horizons);await writeFile(path.join(dir,"horizons.json"),raw);
    manifest.horizonsSha256=sha(raw);await writeFile(path.join(dir,"manifest.json"),stable(manifest));
    await expect(publishProduction(dir)).rejects.toThrow("horizon");return;
   }
   if(kind==="changed-release-document"){
    await writeFile(path.join(String(manifest.hvscRoot),"DOCUMENTS/Songlengths.md5"),"changed\n");
    await expect(publishProduction(dir)).rejects.toThrow("document provenance");return;
   }
   if(kind==="corrupt-header"){
    await writeFile(path.join(dir,"headers.json"),"[]\n");await expect(publishProduction(dir)).rejects.toThrow("provenance");return;
   }
   await publishProduction(dir);
   const d=JSON.parse(await readFile(path.join(dir,"published/deny-list.json"),"utf8")),m=JSON.parse(await readFile(path.join(dir,"published/manifest.json"),"utf8"));
   void full;const result=createRomEligibilityLookup(d,{...m.engine,profile:ROM_CONSUMER_PROFILE,methodology:m.methodology})(fixtureHash,1,none);
   expect(result.eligible).toBe(kind==="valid");
   if(kind==="valid")expect(result.maxPlaybackSeconds).toBe(15);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
}

import { readVerifiedSid } from "../../../scripts/rom-audit/inputs.js";
it("detects changed SID inputs and keeps queued immutable bytes unchanged",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"rom-immutable-")),file=path.join(dir,"input.sid");
 try{
  await writeFile(file,"original");const bytes=readVerifiedSid(file,sha("original"));
  await writeFile(file,"changed");expect(bytes.toString()).toBe("original");
  expect(()=>readVerifiedSid(file,sha("original"))).toThrow("changed after verified census");
 }finally{await rm(dir,{recursive:true,force:true});}
});

it("derives the hardening source set from the directory, so a new script cannot be left out of the identity",()=>{
 const sources=hardeningSources();
 for(const name of readdirSync(path.resolve(import.meta.dir,"../../../scripts/rom-audit")))expect(sources).toContain(`scripts/rom-audit/${name}`);
 for(const required of ["bun.lock","packages/sidflow-common/src/rom-eligibility.ts","packages/sidflow-classify/node_modules/libsidplayfp-wasm/dist/sidlite/libsidplayfp.wasm",
   "packages/sidflow-classify/node_modules/libsidplayfp-wasm/dist/complete-source.tar.gz"])expect(sources).toContain(required);
 expect(new Set(sources).size).toBe(sources.length);
});
it("re-hashes every evidence log and the review named by a hardening certificate",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"rom-evidence-"));
 try{
  const review="doc/research/hvsc-rom-adversarial-review.md";
  const certificate=(logs:Record<string,string>):HardeningCertificate=>({schema:"sidflow-rom-hardening-2",methodology:METHODOLOGY,sourceIdentity:"s",nativeSha256:"n",asanSha256:"a".repeat(64),
   engine:{sourceSha256:"x",wasmSha256:"y"},passed:true,checks:{adversarialReview:{file:review,sha256:sha(readFileSync(path.resolve(import.meta.dir,"../../..",review))),sourceIdentity:"s"}} as HardeningCertificate["checks"],logs});
  await writeFile(path.join(dir,"a.log"),"evidence");
  expect(verifyHardeningEvidence(certificate({"a.log":sha("evidence")}),dir)).toBe(true);
  expect(verifyHardeningEvidence(certificate({"a.log":sha("forged")}),dir)).toBe(false);
  expect(verifyHardeningEvidence(certificate({"missing.log":sha("evidence")}),dir)).toBe(false);
  expect(verifyHardeningEvidence(certificate({"../a.log":sha("evidence")}),dir)).toBe(false);
  const wrongReview=certificate({"a.log":sha("evidence")});wrongReview.checks.adversarialReview.sha256="0".repeat(64);
  expect(verifyHardeningEvidence(wrongReview,dir)).toBe(false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
