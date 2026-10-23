import { describe,it,expect } from "bun:test";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { readdirSync,readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { METHODOLOGY,observationHorizon } from "../../../scripts/rom-audit/methodology.js";
import { pilotQueue,validateHardening,verifyHardeningEvidence,hardeningSources,type HardeningCertificate } from "../../../scripts/rom-audit/rollout.js";
import { publishProduction,sha } from "../../../scripts/rom-audit/publish-production.js";
import { releaseLengths,readVerifiedSid } from "../../../scripts/rom-audit/inputs.js";
import { jobTimeoutMs } from "../../../scripts/rom-audit/audit.js";
import { createRomEligibilityLookup,romConsumerProfile,REFERENCE_ROM_SHA256,type RomDenyList,type RomSelection } from "../src/rom-eligibility.js";
import { censusRecord,publicationFixture,fixtureHash,stable,lane } from "./rom-audit-fixtures.js";
const full:RomSelection={kernal:REFERENCE_ROM_SHA256.kernal,basic:REFERENCE_ROM_SHA256.basic,chargen:null};
describe("adversarial ROM audit review",()=>{
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
 it("sizes job timeouts as a hang detector scaled by horizon and engine count",()=>{
  expect(jobTimeoutMs(10,2)).toBe(300000);                    // never below five minutes
  expect(jobTimeoutMs(2031.332,2)).toBeGreaterThan(2031*2*12*1000-1);
  expect(jobTimeoutMs(100,2)).toBeLessThan(jobTimeoutMs(100,3));
 });
 it("requires a source-bound, complete hardening certificate before full rollout",()=>{
  const clean={pass:10,fail:0,skip:0},engine={sourceSha256:"a".repeat(64),wasmSha256:"b".repeat(64)};
  const c:HardeningCertificate={schema:"sidflow-rom-hardening-2",methodology:METHODOLOGY,sourceIdentity:"s",engines:{sidlite:engine},passed:true,
   checks:{typecheck:true,focusedRuns:3,focusedTotals:[clean,clean,clean],fullSuiteRuns:3,fullSuiteTotals:[clean,clean,clean],
    pilot:{manifestSha256:"m",subtunes:100,files:50,failed:0},decisionRegression:{digest:"d".repeat(64)},reproducibility:{rows:6},
    adversarialReview:{file:"r.md",sha256:"b".repeat(64),sourceIdentity:"s"}},
   logs:Object.fromEntries(Array.from({length:10},(_,i)=>[`l${i}.log`,"c".repeat(64)]))};
  expect(validateHardening(c,"s")).toBe(true);
  expect(validateHardening(undefined,"s")).toBe(false);
  expect(validateHardening(c,"changed")).toBe(false);
  const mutate=(f:(x:HardeningCertificate)=>void):boolean=>{const x=structuredClone(c);f(x);return validateHardening(x,"s");};
  expect(mutate(x=>{x.checks.typecheck=false;})).toBe(false);
  expect(mutate(x=>{x.checks.fullSuiteRuns="3" as unknown as number;})).toBe(false);
  expect(mutate(x=>{x.checks.fullSuiteTotals[1]={pass:10,fail:1,skip:0};})).toBe(false);
  expect(mutate(x=>{x.checks.fullSuiteTotals[2]={pass:10,fail:0,skip:1};})).toBe(false);
  expect(mutate(x=>{x.checks.fullSuiteTotals.pop();})).toBe(false);
  expect(mutate(x=>{x.checks.focusedTotals[0]={pass:0,fail:0,skip:0};})).toBe(false);
  expect(mutate(x=>{x.checks.adversarialReview.sourceIdentity="older";})).toBe(false);
  expect(mutate(x=>{x.checks.pilot.subtunes=3;})).toBe(false);
  expect(mutate(x=>{x.checks.pilot.failed=1;})).toBe(false);
  expect(mutate(x=>{x.checks.decisionRegression.digest="x";})).toBe(false);
  expect(mutate(x=>{x.checks.reproducibility.rows=0;})).toBe(false);
  expect(mutate(x=>{x.logs={};})).toBe(false);
  expect(mutate(x=>{x.engines={};})).toBe(false);
  expect(mutate(x=>{x.schema="sidflow-rom-hardening-1" as HardeningCertificate["schema"];})).toBe(false);
 });
});
describe("publication adversary",()=>{
 const scenario=async(body:(dir:string,helpers:Awaited<ReturnType<typeof publicationFixture>>)=>Promise<void>):Promise<void>=>{
  const dir=await mkdtemp(path.join(tmpdir(),"rom-adversarial-"));
  try{await body(dir,await publicationFixture(dir,true));}finally{await rm(dir,{recursive:true,force:true});}
 };
 const decide=async(dir:string,engine="sidlite"):Promise<ReturnType<ReturnType<typeof createRomEligibilityLookup>>>=>{
  await publishProduction(dir);
  const d=JSON.parse(await readFile(path.join(dir,`published/deny-list.${engine}.json`),"utf8")) as RomDenyList,m=JSON.parse(await readFile(path.join(dir,"published/manifest.json"),"utf8"));
  return createRomEligibilityLookup(d,{...m.engines[engine],profile:romConsumerProfile(engine as "sidlite"),methodology:m.methodology})(fixtureHash,1,full);
 };
 it("grants a valid measurement",()=>scenario(async dir=>{expect((await decide(dir)).eligible).toBe(true);}));
 it("denies when one fill of the null banks differs",()=>scenario(async dir=>{
  const record=censusRecord();record.runs[0]!.lanes[1]=lane("full","ff",{outcome:"different",samples:10,firstDifferenceSample:3,pcmSha256:"3".repeat(64),traceSha256:"4".repeat(64)});
  await writeFile(path.join(dir,"census.jsonl"),stable(record).trimEnd()+"\n");
  expect((await decide(dir)).eligible).toBe(false);
 }));
 it("denies when the reference is not reproducible",()=>scenario(async dir=>{
  const record=censusRecord();record.runs[0]!.reference.repeat="different";
  await writeFile(path.join(dir,"census.jsonl"),stable(record).trimEnd()+"\n");
  expect((await decide(dir)).eligible).toBe(false);
 }));
 it("rejects a record forged to claim identical lanes with other hashes",()=>scenario(async dir=>{
  const record=censusRecord();record.runs[0]!.lanes[0]!.traceSha256="9".repeat(64);
  await writeFile(path.join(dir,"census.jsonl"),stable(record).trimEnd()+"\n");
  await expect(publishProduction(dir)).rejects.toThrow("Invalid census lane");
 }));
 it("rejects records for an unknown subtune, a duplicate and a horizon shorter than required",()=>scenario(async dir=>{
  await writeFile(path.join(dir,"census.jsonl"),stable(censusRecord(15,1,"b".repeat(64))).trimEnd()+"\n");
  await expect(publishProduction(dir)).rejects.toThrow("Unknown census record");
  await writeFile(path.join(dir,"census.jsonl"),stable(censusRecord()).trimEnd()+"\n"+stable(censusRecord()).trimEnd()+"\n");
  await expect(publishProduction(dir)).rejects.toThrow("Duplicate");
  await writeFile(path.join(dir,"census.jsonl"),stable(censusRecord(11)).trimEnd()+"\n");
  await expect(publishProduction(dir)).rejects.toThrow("shorter than the required horizon");
 }));
 it("rejects shortened horizons, changed release documents and corrupt headers",()=>scenario(async (dir,{manifest,horizons})=>{
  await writeFile(path.join(String(manifest.hvscRoot),"DOCUMENTS/Songlengths.md5"),"changed\n");
  await expect(publishProduction(dir)).rejects.toThrow("document provenance");
  await writeFile(path.join(dir,"headers.json"),"[]\n");await expect(publishProduction(dir)).rejects.toThrow("provenance");
  horizons["silent.sid"]![0]!.seconds=2;const raw=stable(horizons);await writeFile(path.join(dir,"horizons.json"),raw);
  await writeFile(path.join(dir,"manifest.json"),stable({...manifest,horizonsSha256:sha(raw)}));
  await expect(publishProduction(dir)).rejects.toThrow();
 }));
});
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
 for(const required of ["bun.lock","packages/sidflow-common/src/rom-eligibility.ts","node_modules/libsidplayfp-wasm-audit/dist/libsidplayfp.wasm",
   "node_modules/libsidplayfp-wasm-audit/dist/sidlite/libsidplayfp.wasm","node_modules/libsidplayfp-wasm-audit/dist/complete-source.tar.gz"])expect(sources).toContain(required);
 expect(new Set(sources).size).toBe(sources.length);
});
it("re-hashes and re-parses every evidence log and the review named by a hardening certificate",async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"rom-evidence-"));
 try{
  const review="doc/research/hvsc-rom-adversarial-review.md",digest="d".repeat(64);
  const files:Record<string,string>={"typecheck.log":"","decision-regression.log":`PASS x\nDIGEST ${digest}\n`};
  for(const n of [1,2,3]){files[`focused-${n}.log`]=" 10 pass\n 0 fail\n";files[`full-suite-${n}.log`]=" 100 pass\n 0 fail\n 0 skip\n";}
  for(const [name,text] of Object.entries(files))await writeFile(path.join(dir,name),text);
  const certificate=(logs:Record<string,string>):HardeningCertificate=>({schema:"sidflow-rom-hardening-2",methodology:METHODOLOGY,sourceIdentity:"s",
   engines:{},passed:true,checks:{decisionRegression:{digest},adversarialReview:{file:review,sha256:sha(readFileSync(path.resolve(import.meta.dir,"../../..",review))),sourceIdentity:"s"}} as HardeningCertificate["checks"],logs});
  const hashes=():Record<string,string>=>Object.fromEntries(Object.entries(files).map(([n,t])=>[n,sha(t)]));
  expect(verifyHardeningEvidence(certificate(hashes()),dir)).toBe(true);
  expect(verifyHardeningEvidence(certificate({...hashes(),"typecheck.log":sha("forged")}),dir)).toBe(false);
  expect(verifyHardeningEvidence(certificate({...hashes(),"missing.log":sha("x")}),dir)).toBe(false);
  expect(verifyHardeningEvidence(certificate({...hashes(),"../a.log":sha("x")}),dir)).toBe(false);
  // A log whose hash matches but which does not say what the certificate claims.
  for(const [name,text] of [["full-suite-2.log"," 100 pass\n 1 fail\n 0 skip\n"],["full-suite-3.log"," 100 pass\n 0 fail\n 2 skip\n"],["focused-1.log"," 0 pass\n 0 fail\n"],["decision-regression.log","DIGEST "+"e".repeat(64)+"\n"]] as const){
   await writeFile(path.join(dir,name),text);
   expect(verifyHardeningEvidence(certificate({...hashes(),[name]:sha(text)}),dir)).toBe(false);
   await writeFile(path.join(dir,name),files[name]!);
  }
  const missingRuns=certificate(hashes());delete missingRuns.logs["full-suite-3.log"];expect(verifyHardeningEvidence(missingRuns,dir)).toBe(false);
  const wrongReview=certificate(hashes());wrongReview.checks.adversarialReview.sha256="0".repeat(64);
  expect(verifyHardeningEvidence(wrongReview,dir)).toBe(false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
void observationHorizon;
