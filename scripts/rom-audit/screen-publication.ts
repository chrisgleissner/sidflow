/** Commander exception format. Unknown/pending is never an exception. */
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { screenJson, screenEngineIdentity, screenRomSetId, screenSha, SCREEN_METHODOLOGY } from "./screen-identity.js";
import type { ScreenTune } from "./screen-inventory.js";
import type { ScreenResult } from "./screen-worker.js";
export interface ScreenRow {sha256:string;song:number;seconds:number;result:ScreenResult;workerSeconds:number}
/** Unknown measurements must be retried on resume, just like failed jobs. */
export function resolvedScreenRow(row:ScreenRow|undefined):boolean {
  return !!row&&!row.result.failure&&row.result.engines.length===2&&row.result.engines.every((r,i)=>r.engine===(["sidlite","residfp"] as const)[i]&&
    [r.states.none,r.states.full].every(state=>state==="compatible"||state==="incompatible"));
}
export function commanderExceptions(tunes: readonly ScreenTune[], rows: ReadonlyMap<string,ScreenRow>) {
  const entries: Record<string,Record<string,number>>={}, unknown:Record<string,number[]>={}, prefixes=new Map<string,string>();
  const empty=()=>({compatible:0,incompatible:0,unknown:0});
  const counts={sidlite:{none:empty(),full:empty()},residfp:{none:empty(),full:empty()}};
  const records:{md5:string;song:number;bits:number}[]=[];
  for(const tune of tunes){
    const prefix=tune.md5.slice(0,16), previous=prefixes.get(prefix);
    if(previous && previous!==tune.md5)throw new Error("Eight-byte MD5 prefix collision");prefixes.set(prefix,tune.md5);
    for(const job of tune.jobs){
      const row=rows.get(`${tune.sha256}#${job.song}`);let bits=0,unresolved=false;
      for(const [index,engine] of (["sidlite","residfp"] as const).entries()){
        const result=row?.result.failure?undefined:row?.result.engines[index];
        for(const [set,shift] of [["none",index*2],["full",index*2+1]] as const){
          const state=result?.states[set]??"unknown";counts[engine][set][state]++;
          if(state==="incompatible")bits|=1<<shift;
          if(state==="unknown")unresolved=true;
        }
      }
      if(unresolved)(unknown[tune.md5]??=[]).push(job.song);
      if(bits){(entries[tune.md5]??={})[job.song]=bits;records.push({md5:tune.md5,song:job.song,bits});}
    }
  }
  records.sort((a,b)=>a.md5<b.md5?-1:a.md5>b.md5?1:a.song-b.song);
  const packed=Buffer.alloc(12+records.length*11);packed.write("SIDR");packed.writeUInt16LE(1,4);packed.writeUInt16LE(11,6);packed.writeUInt32LE(records.length,8);
  records.forEach((r,i)=>{const offset=12+i*11;Buffer.from(r.md5.slice(0,16),"hex").copy(packed,offset);packed.writeUInt16LE(r.song,offset+8);packed[offset+10]=r.bits;});
  return {entries,unknown,counts,packed,exceptionSubtunes:records.length};
}
export async function publishScreen(directory:string,tunes:readonly ScreenTune[],rows:ReadonlyMap<string,ScreenRow>,provenance:Record<string,unknown>,evidence?:{qualification:string;benchmark:string}) {
  const data=commanderExceptions(tunes,rows),total=tunes.reduce((n,t)=>n+t.jobs.length,0),failed=[...rows.values()].filter(r=>!!r.result.failure).length;
  const complete=rows.size===total&&!failed&&!Object.keys(data.unknown).length;
  const common={methodology:SCREEN_METHODOLOGY,complete,engineIds:{sidlite:screenEngineIdentity("sidlite"),residfp:screenEngineIdentity("residfp")},romSetId:screenRomSetId()};
  const artifacts:Record<string,string>={};await mkdir(directory,{recursive:true});
  for(const [name,bytes] of Object.entries({
    "commander-exceptions.json":screenJson({schema:"sidflow-commander-rom-exceptions-1",...common,bits:{sidliteNone:1,sidliteKernalBasic:2,residfpNone:4,residfpKernalBasic:8},entries:data.entries})+"\n",
    "commander-exceptions.bin":data.packed,
    "unknown.json":screenJson(data.unknown)+"\n",
    "sha256-to-md5.json":screenJson(Object.fromEntries(tunes.map(t=>[t.sha256,t.md5])))+"\n",
    "playback-horizons.json":screenJson(Object.fromEntries(tunes.map(t=>[t.md5,{modelFixed:t.modelFixed,fallbackSidModel:"MOS8580",milliseconds:t.jobs.map(j=>Math.round(j.seconds*1000))}])))+"\n"
    ,...(evidence?{"qualification.json":evidence.qualification,"benchmark.json":evidence.benchmark}:{})
  })){
    await writeFile(path.join(directory,name+".tmp"),bytes);await rename(path.join(directory,name+".tmp"),path.join(directory,name));artifacts[name]=screenSha(bytes);
  }
  const manifest={...provenance,schema:"sidflow-dual-rom-manifest-1",...common,releaseReady:complete&&!!evidence,files:tunes.length,subtunes:total,measuredSubtunes:rows.size,pendingSubtunes:total-rows.size,failedSubtunes:failed,unknownSubtunes:Object.values(data.unknown).reduce((n,v)=>n+v.length,0),exceptionSubtunes:data.exceptionSubtunes,counts:data.counts,artifacts,
    scope:"Pinned engines; 48kHz stereo; default delay 8191; 256-event pulls; zero absent BASIC/CHARGEN; KERNAL shim when absent; header SID model/MOS8580 fallback; documented horizon plus 5s. Masks 0 and 3 against authentic three-ROM reference. Not hardware-fidelity proof or indefinite-loop authorization."};
  await writeFile(path.join(directory,"manifest.json.tmp"),screenJson(manifest)+"\n");await rename(path.join(directory,"manifest.json.tmp"),path.join(directory,"manifest.json"));
  return manifest;
}
