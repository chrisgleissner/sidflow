/** Full-content, release-index-verified HVSC85 inventory for the dual census. */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { releaseLengths, RELEASE_DOCUMENTS } from "./inputs.js";
import { observationHorizon, headerFixesSidModels } from "./methodology.js";
import { checkSidHeader } from "../../packages/sidflow-common/src/sid-header-conformance.js";
import type { BenchmarkCandidate } from "./benchmark-model.js";
export const HVSC85_CORPUS="4b66fe03e72e18155ee4e14a0a7fd3f2c4de2ed1a467296156d5642e716f132e";
export interface ScreenTune {path:string;sha256:string;md5:string;modelFixed:boolean;jobs:BenchmarkCandidate[]}
export async function screenInventory(root: string) {
  const lengths=releaseLengths(await readFile(path.join(root,"DOCUMENTS/Songlengths.md5"),"utf8"));
  const files=(await readdir(root,{recursive:true,withFileTypes:true})).filter(f=>f.isFile()&&f.name.toLowerCase().endsWith(".sid")).map(f=>path.relative(root,path.join(f.parentPath,f.name))).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
  if(files.length!==61157||lengths.size!==files.length)throw new Error("Expected complete HVSC85 (61,157 SID files)");
  const tunes:ScreenTune[]=new Array(files.length);let next=0;
  await Promise.all(Array.from({length:8},async()=>{
    for(let i=next++;i<files.length;i=next++){
      const relative=files[i]!,bytes=await readFile(path.join(root,relative)),entry=lengths.get(relative),check=checkSidHeader(bytes),h=check.fields;
      const md5=createHash("md5").update(bytes).digest("hex"),sha256=createHash("sha256").update(bytes).digest("hex");
      if(!entry||!h||entry.md5!==md5||h.songs!==entry.tokens.length||check.findings.some(f=>f.severity==="violation"))throw new Error(`Release/header mismatch ${relative}`);
      const kind=h.magic==="RSID"?((h.flags??0)&2?"BASIC":"RSID"):h.secondSidAddress?"multiSID":"PSID";
      tunes[i]={path:relative,sha256,md5,modelFixed:headerFixesSidModels(h),jobs:entry.tokens.map((token,index)=>({path:path.resolve(root,relative),sha256,song:index+1,seconds:observationHorizon(token,10).seconds,kind}))};
    }
  }));
  const corpus=createHash("sha256").update(tunes.map(t=>`${t.path}\t${t.sha256}\n`).join("")).digest("hex");
  const jobs=tunes.flatMap(t=>t.jobs);
  if(corpus!==HVSC85_CORPUS||jobs.length!==87868||jobs.some(j=>j.seconds>3600))throw new Error("HVSC85 content or horizon inventory mismatch");
  const documents=Object.fromEntries(await Promise.all(RELEASE_DOCUMENTS.map(async name=>[name,createHash("sha256").update(await readFile(path.join(root,"DOCUMENTS",name))).digest("hex")])));
  const pinned=JSON.parse(await readFile(new URL("../../doc/research/hvsc-rom-catalogue/v4/manifest.json",import.meta.url),"utf8")) as {documents:Record<string,string>};
  if(RELEASE_DOCUMENTS.some(name=>documents[name]!==pinned.documents[name]))throw new Error("HVSC85 metadata changed");
  return {corpus,documents,tunes,jobs};
}
