import { pcmParity } from "../../../scripts/rom-audit/pcm-parity.js";
import { describe, expect, it } from "bun:test";
import { screenEquivalent, type DigitalScreen } from "../../../scripts/rom-audit/digital-screen.js";
import { commanderExceptions, type ScreenRow } from "../../../scripts/rom-audit/screen-publication.js";
import type { ScreenTune } from "../../../scripts/rom-audit/screen-inventory.js";
const screen=(writes:number[],overrides:Partial<DigitalScreen>={}):DigitalScreen=>({error:"",traceComplete:true,chargenReads:0,writes,...overrides});
describe("digital screening eligibility",()=>{
  it("accepts complete register streams across the listener timing tolerance",()=>{
    expect(screenEquivalent(screen([0,24,15,1000,0,0,80,3000]),screen([0,24,15,1100,0,0,80,3100]))).toBe(true);
    expect(screenEquivalent(screen([]),screen([]))).toBe(true);
  });
  it("requires audio for changed, missing, excessive-drift and truncated streams",()=>{
    const reference=screen([0,24,15,1000,0,0,80,3000]);
    for(const variant of [screen([0,24,14,1000,0,0,80,3000]),screen([0,24,15,1000]),screen([0,24,15,1000,0,0,80,6000]),screen(reference.writes,{traceComplete:false}),screen(reference.writes,{error:"halt"})])expect(screenEquivalent(reference,variant)).toBe(false);
    expect(screenEquivalent(screen(reference.writes,{error:"reference failed"}),reference)).toBe(false);
  });
  it("never treats an audio-less dense digi stream as compatible",()=>{
    const dense:number[]=[];for(let i=0;i<500;i++)dense.push(0,24,i%16,i*400);
    expect(screenEquivalent(screen(dense),screen(dense))).toBe(false);
  });
  it("requires audio for dense bursts shorter than the density window, including the final tail",()=>{
    for(const address of [0,24]){
      const burst:number[]=[];
      for(let i=0;i<350;i++)burst.push(0,address,i%16,1000000+i*100);
      expect(screenEquivalent(screen(burst),screen(burst))).toBe(false);
    }
    const short=Array.from({length:12},(_,i)=>[0,24,i%16,1000000+i*500]).flat();
    expect(screenEquivalent(screen(short),screen(short))).toBe(false);
  });
});
const sha="a".repeat(64),md5="a".repeat(32);
const tune=(hash=md5):ScreenTune=>({path:"test.sid",sha256:sha,md5:hash,modelFixed:true,jobs:[{path:"test.sid",song:1,sha256:sha,seconds:10,kind:"PSID"}]});
function row():ScreenRow{return{sha256:sha,song:1,seconds:10,workerSeconds:1,result:{engines:[{engine:"sidlite",states:{none:"incompatible",full:"compatible"},screen:null},{engine:"residfp",states:{none:"compatible",full:"incompatible"},screen:null}]}};}
describe("Commander exceptions",()=>{
  it("keeps pending/failures in unknown and out of packed exceptions",()=>{
    const pending=commanderExceptions([tune()],new Map());
    expect(pending.exceptionSubtunes).toBe(0);expect(pending.unknown[md5]).toEqual([1]);expect(pending.packed.length).toBe(12);
    const failed=row();failed.result={engines:[],failure:"engine failed"};
    expect(commanderExceptions([tune()],new Map([[`${sha}#1`,failed]])).exceptionSubtunes).toBe(0);
  });
  it("encodes independent engine/configuration bits with full-file MD5 and one-based subtunes",()=>{
    const data=commanderExceptions([tune()],new Map([[`${sha}#1`,row()]]));
    expect(data.entries[md5]?.[1]).toBe(9);expect(data.unknown).toEqual({});
    expect(data.packed.subarray(0,4).toString()).toBe("SIDR");expect(data.packed.readUInt16LE(6)).toBe(11);expect(data.packed.readUInt32LE(8)).toBe(1);
    expect(data.packed.subarray(12,20).toString("hex")).toBe(md5.slice(0,16));expect(data.packed.readUInt16LE(20)).toBe(1);expect(data.packed[22]).toBe(9);
  });
  it("refuses eight-byte MD5 prefix collisions",()=>{
    expect(()=>commanderExceptions([tune(),tune(md5.slice(0,16)+"b".repeat(16))],new Map())).toThrow("collision");
  });
});

describe("native/WASM qualification",()=>{
  it("requires exact SIDLite samples and rejects real audio corruption",()=>{
    const pcm=Int16Array.from({length:2048},(_,i)=>Math.round(10000*Math.sin(i/20)));
    expect(pcmParity("sidlite",pcm,pcm).maxAbsLsb).toBe(0);
    expect(()=>pcmParity("sidlite",pcm,Int16Array.from(pcm,v=>v+1))).toThrow();
    expect(()=>pcmParity("residfp",pcm,new Int16Array(pcm.length))).toThrow();
    expect(()=>pcmParity("residfp",pcm,pcm.subarray(1))).toThrow();
    expect(pcmParity("residfp",pcm,Int16Array.from(pcm,(v,i)=>v+(i%2?2:-2))).maxAbsLsb).toBe(2);
    expect(()=>pcmParity("residfp",new Int16Array(1000),new Int16Array(1000).fill(32))).toThrow();
  });
});

describe("native stream terminal delivery",()=>{
  it("retains fragmented bytes after the producer has already ended",async()=>{
    const {PassThrough}=await import("node:stream"),{NativeBytes}=await import("../../../scripts/rom-audit/native-lanes.js");
    const stream=new PassThrough(),reader=new NativeBytes(stream);
    stream.write(Buffer.from([1,2,3]));stream.write(Buffer.from([4]));stream.end(Buffer.from([5,6]));
    expect([...await reader.read(2)]).toEqual([1,2]);expect([...await reader.read(4)]).toEqual([3,4,5,6]);
    await expect(reader.read(1)).rejects.toThrow("received 6, consumed 6");
  });
  it("distinguishes an emulated CPU halt from resource, engine and malformed terminal failures",async()=>{
    const {mkdtempSync,writeFileSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path");
    const {NativeLane}=await import("../../../scripts/rom-audit/native-lanes.js");
    const directory=mkdtempSync(join(tmpdir(),"sidflow-native-terminal-")),producer=join(directory,"producer.mjs");
    try{
      for(const terminal of [
        {error:"allocation failure: bad_alloc",errorKind:"resource"},
        {error:"mixer returned no samples",errorKind:"engine"},
        {error:"Illegal instruction $02",errorKind:"engine"},
        {error:"unexpected failure",errorKind:"cpu-halt"},
        {error:"",errorKind:undefined},
        {error:"Illegal instruction $02",errorKind:"cpu-halt"},
        {error:"",errorKind:""},
      ]){
        const bytes=JSON.stringify({cpuSeconds:0.01,traceComplete:true,...terminal});
        writeFileSync(producer,`const data=Buffer.from(${JSON.stringify(bytes)});const h=Buffer.alloc(8);h.writeUInt32LE(0xffffffff);h.writeUInt32LE(data.length,4);process.stdout.write(Buffer.concat([h,data]));`);
        const lane=NativeLane.open("node",producer,new Uint8Array(32),1,1,7);
        try{
          if(terminal.errorKind===""||terminal.errorKind==="cpu-halt"&&terminal.error.startsWith("Illegal instruction $"))expect(await lane.pull()).toBeNull();
          else await expect(lane.pull()).rejects.toThrow();
        }finally{lane.close();}
      }
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  it("exits naturally after closing a paused native output pipe",async()=>{
    const {mkdtempSync,writeFileSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path"),{spawnSync}=await import("node:child_process");
    const directory=mkdtempSync(join(tmpdir(),"sidflow-native-close-")),producer=join(directory,"producer.mjs");
    try{
      writeFileSync(producer,'const h=Buffer.alloc(16);h.writeUInt32LE(8192);process.stdout.write(Buffer.concat([h,Buffer.alloc(16384),Buffer.alloc(1048576)]));setInterval(()=>{},1000);');
      const modulePath=new URL("../../../scripts/rom-audit/native-lanes.ts",import.meta.url).pathname;
      const code=`import {NativeLane} from ${JSON.stringify(modulePath)}; const lane=NativeLane.open("node",${JSON.stringify(producer)},new Uint8Array(32),1,1,7); await lane.pull(); lane.close(); console.log("native closed");`;
      const result=spawnSync(process.execPath,["--eval",code],{encoding:"utf8",timeout:10000});
      expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(result.stdout).toContain("native closed");
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
});

describe("screened configurations avoid redundant audio",()=>{
  it("retains measured-subset validation and never derives from a failed reference",async()=>{
    const {audioSets,audioStates}=await import("../../../scripts/rom-audit/screen-classifier.js");
    const {validateRecord}=await import("../../../scripts/rom-audit/methodology.js");
    const {censusRecord}=await import("./rom-audit-fixtures.js");
    const proof={none:false,full:true,referenceError:"",traceComplete:true,referenceTraceSha256:"a".repeat(64)};
    expect(audioSets(proof,false)).toEqual(["none"]);expect(audioSets(proof,true)).toEqual(["full","none"]);
    expect(audioSets({...proof,referenceError:"failed"},false)).toEqual(["full","none"]);
    const record=censusRecord(),run=record.runs[0]!;run.lanes=run.lanes.filter(l=>l.set==="none");
    expect(()=>validateRecord(record,["sidlite"])).toThrow("Invalid census lanes");
    expect(()=>validateRecord(record,["sidlite"],["none"])).not.toThrow();
    expect(audioStates(proof,run,15).full).toBe("compatible");
    run.reference.outcome="failed";expect(audioStates(proof,run,15).full).toBe("unknown");
  });
});

describe("resumable decisions",()=>{
  it("retries unknown and failed rows while preserving resolved rows",async()=>{
    const {resolvedScreenRow}=await import("../../../scripts/rom-audit/screen-publication.js");
    expect(resolvedScreenRow(undefined)).toBe(false);
    const measured=row();expect(resolvedScreenRow(measured)).toBe(true);
    measured.result.engines[1]!.states.full="unknown";expect(resolvedScreenRow(measured)).toBe(false);
    measured.result={engines:[],failure:"interrupted"};expect(resolvedScreenRow(measured)).toBe(false);
  });
});

describe("Commander release verification",()=>{
  it("refuses incomplete publications even when their files have valid checksums",async()=>{
    const {mkdtemp,rm}=await import("node:fs/promises"),{tmpdir}=await import("node:os"),{join}=await import("node:path");
    const {publishScreen}=await import("../../../scripts/rom-audit/screen-publication.js"),{verifyPublication}=await import("../../../scripts/rom-audit/verify-publication.js");
    const directory=await mkdtemp(join(tmpdir(),"rom-incomplete-"));
    try{const manifest=await publishScreen(directory,[tune()],new Map(),{});expect(manifest.releaseReady).toBe(false);expect(()=>verifyPublication(directory)).toThrow("incomplete or unqualified");}
    finally{await rm(directory,{recursive:true,force:true});}
  });
  it("verifies a complete bundle and rejects corruption, mixed profiles and inconsistent packed data",async()=>{
    const {mkdtemp,rm,readFile,writeFile}=await import("node:fs/promises"),{tmpdir}=await import("node:os"),{join}=await import("node:path");
    const {publishScreen}=await import("../../../scripts/rom-audit/screen-publication.js"),{verifyPublication}=await import("../../../scripts/rom-audit/verify-publication.js");
    const {screenJson,screenSha}=await import("../../../scripts/rom-audit/screen-identity.js");
    const directory=await mkdtemp(join(tmpdir(),"rom-verified-"));
    try{
      const tunes:ScreenTune[]=[],rows=new Map<string,ScreenRow>();
      for(let i=0;i<61157;i++){
        const identity=(i+1).toString(16).padStart(16,"0"),sha256=identity+"0".repeat(48),md5=identity+"0".repeat(16);
        const jobs=Array.from({length:i<26711?2:1},(_,j)=>({path:"fixture.sid",sha256,song:j+1,seconds:10,kind:"PSID"}));
        tunes.push({path:"fixture.sid",sha256,md5,modelFixed:true,jobs});
        for(const job of jobs){const measured=row();measured.sha256=sha256;measured.song=job.song;rows.set(`${sha256}#${job.song}`,measured);}
      }
      const nativeHashes={sidlite:sha,residfp:sha},sourceIdentity=sha;
      const qualification={schema:"sidflow-screen-qualification-1",sourceIdentity,measurementIdentity:sourceIdentity,passed:true,nativeHashes,
        logs:Object.fromEntries(["build.log","typecheck.log","parity.log","transport.log","full-1.log","full-2.log","full-3.log"].map(n=>[n,sha])),fullRuns:Array.from({length:3},()=>({pass:1,fail:0,skip:0}))};
      const manifest=await publishScreen(directory,tunes,rows,{sourceIdentity,nativeHashes},{qualification:screenJson(qualification),benchmark:screenJson({sourceIdentity,passed:true})});
      expect(manifest.releaseReady).toBe(true);expect(verifyPublication(directory)).toBe(screenSha(await readFile(join(directory,"manifest.json"))));
      const packed=await readFile(join(directory,"commander-exceptions.bin"));packed[22]=0;
      await writeFile(join(directory,"commander-exceptions.bin"),packed);
      expect(()=>verifyPublication(directory)).toThrow("checksum");
      // Even a recomputed checksum cannot conceal disagreement with JSON.
      manifest.artifacts["commander-exceptions.bin"]=screenSha(packed);
      await writeFile(join(directory,"manifest.json"),screenJson(manifest));
      expect(()=>verifyPublication(directory)).toThrow("packed/JSON/count");
      qualification.measurementIdentity="b".repeat(64);
      const changed=screenJson(qualification);await writeFile(join(directory,"qualification.json"),changed);
      manifest.artifacts["qualification.json"]=screenSha(changed);await writeFile(join(directory,"manifest.json"),screenJson(manifest));
      expect(()=>verifyPublication(directory)).toThrow("qualification");
    }finally{await rm(directory,{recursive:true,force:true});}
  },30000);
});
