/** Strict positional release metadata join, shared by execution/publication. */
import { createHash } from "node:crypto";
import { readFile,readdir } from "node:fs/promises";
import path from "node:path";
import { observationHorizon,type Horizon } from "./methodology.js";
export const RELEASE_DOCUMENTS=["HVSC.txt","SID_file_format.txt","Songlengths.md5","Songlengths.faq","STIL.txt","BUGlist.txt","Update85.hvs"] as const;
export function releaseLengths(text:string):Map<string,{md5:string;tokens:string[]}>{
 const records=new Map<string,{md5:string;tokens:string[]}>(),identities=new Set<string>();let current="";
 for(const line of text.replace(/\r/g,"").split("\n")){
  if(line.startsWith("; /"))current=line.slice(3);
  else if(/^[a-f0-9]{32}=/.test(line)){
   const md5=line.slice(0,32),tokens=line.slice(33).trim().split(/\s+/);
   if(!current||!current.toLowerCase().endsWith(".sid")||current.split("/").some(v=>!v||v===".."||v===".")||
      records.has(current)||identities.has(md5)||!tokens[0])throw new Error(`Invalid/duplicate release length identity ${current}`);
   records.set(current,{md5,tokens});identities.add(md5);current="";
  }
 }
 return records;
}
export async function verifyReleaseMetadata(manifest:{hvscRoot:string;documents:Record<string,string>;seconds:number},
 headers:{path:string;md5:string;sha256:string;songs:number}[],horizons:Record<string,Horizon[]>):Promise<void>{
 for(const name of RELEASE_DOCUMENTS){
  const actual=createHash("sha256").update(await readFile(path.join(manifest.hvscRoot,"DOCUMENTS",name))).digest("hex");
  if(actual!==manifest.documents?.[name])throw new Error(`Release document provenance mismatch ${name}`);
 }
 const index=releaseLengths(await readFile(path.join(manifest.hvscRoot,"DOCUMENTS/Songlengths.md5"),"utf8"));
 if(index.size!==headers.length||Object.keys(horizons).length!==headers.length)throw new Error("Release metadata population mismatch");
 const seen=new Set<string>();
 for(const h of headers){
  if(typeof h.path!=="string"||seen.has(h.path)||!Number.isInteger(h.songs)||h.songs<1||h.songs>256||
     !/^[a-f0-9]{64}$/.test(h.sha256)||!/^[a-f0-9]{32}$/.test(h.md5))throw new Error("Invalid/duplicate header identity");
  seen.add(h.path);const entry=index.get(h.path),rows=horizons[h.path];
  if(!entry||entry.md5!==h.md5||entry.tokens.length!==h.songs||!Array.isArray(rows)||rows.length!==h.songs)
   throw new Error(`Release metadata identity mismatch ${h.path}`);
  for(let i=0;i<h.songs;i++)if(JSON.stringify(rows[i])===undefined||
    rows[i]?.token!==entry.tokens[i]||!sameHorizon(rows[i]!,observationHorizon(entry.tokens[i],manifest.seconds)))
    throw new Error(`Noncanonical/undersized horizon ${h.path}#${i+1}`);
 }
}
function sameHorizon(a:Horizon,b:Horizon):boolean{
 return a.token===b.token&&a.seconds===b.seconds&&a.documentedSeconds===b.documentedSeconds&&a.source===b.source&&a.limitation===b.limitation;
}

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const repositoryRoot=path.resolve(import.meta.dir,"../..");
/** Return a renderer built from the current render.cpp, hooks and packaged engine
 * source. build-native.sh is idempotent: it rebuilds only when its source stamp
 * differs, so a stale binary can never be used for new-protocol results.
 */
export function freshNativeRenderer(sanitize=false):string{
 const result=spawnSync("bash",[path.join(repositoryRoot,"scripts/rom-audit/build-native.sh")],
  {encoding:"utf8",env:{...process.env,ROM_AUDIT_SANITIZE:sanitize?"1":"0"},maxBuffer:16*1024*1024});
 if(result.status!==0)throw new Error(`Native renderer build failed (${result.status}): ${result.stderr}`);
 const binary=result.stdout.trim().split("\n").pop()??"";
 if(!binary||!binary.startsWith(repositoryRoot))throw new Error(`Unexpected renderer path: ${binary}`);
 return binary;
}
/** Return the exact immutable bytes sent to the native protocol, not a filename
 * that the worker might reopen after the collection has changed. */
export function readVerifiedSid(file:string,expectedSha256:string):Buffer{
 const bytes=readFileSync(file);
 if(bytes.length>1024*1024||createHash("sha256").update(bytes).digest("hex")!==expectedSha256)
  throw new Error(`SID input changed after verified census or exceeds payload bound: ${file}`);
 return bytes;
}
/** Corpus identity exactly as the audit manifest records it: SHA-256 over the
 * byte-sorted "relative path TAB file SHA-256" lines of every .sid file. */
export async function corpusIdentity(hvscRoot:string):Promise<string>{
 const files=(await readdir(hvscRoot,{recursive:true,withFileTypes:true}))
  .filter(e=>e.isFile()&&e.name.toLowerCase().endsWith(".sid"))
  .map(e=>path.relative(hvscRoot,path.join(e.parentPath,e.name))).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
 const lines:string[]=new Array(files.length);let next=0;
 await Promise.all(Array.from({length:8},async()=>{
  while(next<files.length){const i=next++;
   lines[i]=`${files[i]}\t${createHash("sha256").update(await readFile(path.join(hvscRoot,files[i]!))).digest("hex")}\n`;}
 }));
 return createHash("sha256").update(lines.join("")).digest("hex");
}

/** Hash of the census tooling whose behavior defines a measurement; recorded in every run manifest. */
export function toolHash(): string {
 const directory=path.join(repositoryRoot,"scripts/rom-audit");
 return createHash("sha256").update(Buffer.concat(["wasm-lanes.ts","census-worker.ts","methodology.ts","checkpoint.ts","inputs.ts","audit.ts"].map(f=>readFileSync(path.join(directory,f))))).digest("hex");
}
