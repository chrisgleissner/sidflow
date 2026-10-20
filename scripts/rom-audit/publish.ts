#!/usr/bin/env bun
/** Validate completed safe runs and publish metadata/evidence Markdown, never SID/ROM/PCM.
 * publish.ts <full run> <notable run> <extended run> <HVSC root> <output directory>
 */
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evidence, percent, parseStil, stilFor, type Execution, type Measurement } from "./analysis.js";
export interface Header {
  path:string;md5:string;sha256:string;songs:number;magic:string;basicFlag:boolean;
  title:string;author:string;released:string;
}
const variants=["both","repeat","neither","kernal","basic"] as const;
const sensitive=new Set(["kernal-sensitive","basic-sensitive","both-sensitive","combined-removal-sensitive"]);
const inconclusive=new Set(["reference-error","unstable-reference","quiet-reference","insufficient-reference-activity"]);
const sha=(data:string|Uint8Array):string=>createHash("sha256").update(data).digest("hex");
const relative=(name:string,root:string):string=>path.relative(root,name);
export function validateRows(headers:Header[],rows:Execution[],root:string,baseline:number,complete:boolean):void {
  const index=new Map(headers.map(h=>[h.path,h]));
  const seen=new Set<string>();
  for (const row of rows) {
    const h=index.get(relative(row.path,root)),key=`${row.path}#${row.song}`;
    if (!h||!Number.isInteger(row.song)||row.song<1||row.song>h.songs||seen.has(key)) throw new Error(`Unknown/duplicate subtune ${key}`);
    seen.add(key);
    if (!Number.isFinite(row.seconds)||row.seconds<baseline||((h.basicFlag||!["identical-in-window","pcm-difference-with-similar-write-sequence"].includes(evidence(row)))&&row.seconds<10))
      throw new Error(`Undersized window ${key}`);
    for (const v of variants) {
      const m=row[v];
      for (const [field,value] of Object.entries(m)) if (typeof value==="number"&&!Number.isFinite(value)) throw new Error(`Nonfinite ${key}.${v}.${field}`);
      if (!m.error&&m.samples!==Math.round(row.seconds*8000)*2) throw new Error(`Incomplete nonerror ${key}.${v}`);
      if (m.derivedFrom) {
        const source=v==="kernal"?row.both:v==="neither"?row.basic:undefined;
        const label=v==="kernal"?"both: zero mapped BASIC reads":"basic: zero mapped BASIC reads";
        if (!source||source.error||source.basicReads!==0||m.derivedFrom!==label) throw new Error(`Invalid derivation ${key}.${v}`);
        for (const field of Object.keys(source) as (keyof Measurement)[]) if (field!=="derivedFrom"&&source[field]!==m[field])
          throw new Error(`Derived measurement differs ${key}.${v}.${field}`);
      }
    }
  }
  const expected=headers.reduce((n,h)=>n+h.songs,0);
  if (complete&&seen.size!==expected) throw new Error(`Incomplete census: ${seen.size}/${expected}`);
}
const md=(s:string):string=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\|/g,"&#124;").replace(/\r?\n/g,"<br>");
const number=(n:number):string=>n.toExponential(3);
function describe(m:Measurement):string {
  return `${m.error?`ERROR: ${md(m.error)}`:m.equal?"identical PCM":`ΔRMS ${number(m.differenceRms)}`}; writes ${m.sidWrites}; prefix ${m.matchingWritePrefix}; drift ${m.maxRelativeWriteDriftCycles}${m.derivedFrom?"; derived":""}`;
}
async function main():Promise<void> {
  const [fullDir,notableDir,extendedDir,root,out]=process.argv.slice(2);
  if (!fullDir||!notableDir||!extendedDir||!root||!out) throw new Error("Expected full/notable/extended directories, HVSC root, output directory");
  const headers=JSON.parse(await readFile(path.join(fullDir,"headers.json"),"utf8")) as Header[];
  const populations={files:headers.length,subtunes:headers.reduce((n,h)=>n+h.songs,0)};
  if (populations.files!==61157||populations.subtunes!==87868) throw new Error("HVSC 85 population differs");
  const corpus=sha(headers.map(h=>`${h.path}\t${h.sha256}\n`).join(""));
  const runs=[];
  for (const [dir,baseline,complete] of [[fullDir,2,true],[notableDir,30,false],[extendedDir,60,false]] as const) {
    const raw=await readFile(path.join(dir,"execution.jsonl"),"utf8");
    if (!raw.endsWith("\n")) throw new Error(`Truncated checkpoint ${dir}`);
    const rows=raw.trim().split("\n").map(line=>JSON.parse(line) as Execution);
    const manifestText=await readFile(path.join(dir,"manifest.json"),"utf8");
    const manifest=JSON.parse(manifestText);
    if (manifest.corpusSha256!==corpus||manifest.protocol.chunkCycles!==256||manifest.seed||manifest.seconds!==baseline)
      throw new Error(`Unsafe/incompatible provenance ${dir}`);
    if (sha(await readFile("workspace/rom-audit-native/render"))!==manifest.nativeSha256 ||
        sha(await readFile("packages/sidflow-classify/node_modules/libsidplayfp-wasm/dist/complete-source.tar.gz"))!==manifest.sourceSha256)
      throw new Error(`Binary/archive changed since ${dir}`);
    for (const [name,hash] of Object.entries(manifest.documents)) if (sha(await readFile(path.join(root,"DOCUMENTS",name)))!==hash)
      throw new Error(`Release document changed: ${name}`);
    validateRows(headers,rows,root,baseline,complete);
    const portable={...manifest};delete portable.hvscRoot;
    runs.push({name:path.basename(dir),rows,manifest:portable,manifestSha256:sha(manifestText),executionSha256:sha(raw)});
  }
  const full=runs[0]!, best=new Map<string,Execution>(full.rows.map(r=>[`${r.path}#${r.song}`,r] as const));
  const transitions: Record<string,number>={};
  for (const run of runs.slice(1)) for (const r of run.rows) {
    const key=`${r.path}#${r.song}`,old=best.get(key)!;
    if (r.seconds<old.seconds) continue;
    const transition=`${evidence(old)} -> ${evidence(r)}`;
    transitions[transition]=(transitions[transition]??0)+1;
    best.set(key,r);
  }
  const rows=[...best.values()].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))||a.song-b.song);
  const grouped=new Map<string,Execution[]>();
  const categories:Record<string,{subtunes:number;files:Set<string>}>={};
  const windows:Record<string,number>={},errors:Record<string,number>={};
  let derived=0;
  for (const r of rows) {
    const label=evidence(r),name=relative(r.path,root),g=categories[label]??={subtunes:0,files:new Set()};
    g.subtunes++;g.files.add(name);windows[r.seconds]=(windows[r.seconds]??0)+1;
    const group=grouped.get(name)??[];group.push(r);grouped.set(name,group);
    for (const v of variants) { if (r[v].derivedFrom) derived++;if (r[v].error) errors[v]=(errors[v]??0)+1; }
  }
  const totals=(labels:Set<string>)=>{
    const selected=rows.filter(r=>labels.has(evidence(r)));
    const files=new Set(selected.map(r=>r.path)).size;
    return {files,filePercent:percent(files,populations.files),subtunes:selected.length,subtunePercent:percent(selected.length,populations.subtunes)};
  };
  const summary={populations,basicDeclarations:{files:headers.filter(h=>h.basicFlag).length,subtunes:headers.filter(h=>h.basicFlag).reduce((n,h)=>n+h.songs,0)},
    categories:Object.fromEntries(Object.entries(categories).sort().map(([k,g])=>[k,{files:g.files.size,filePercent:percent(g.files.size,populations.files),subtunes:g.subtunes,subtunePercent:percent(g.subtunes,populations.subtunes)}])),
    kernalRemoval:totals(new Set(["kernal-sensitive","both-sensitive"])),basicRemoval:totals(new Set(["basic-sensitive","both-sensitive"])),
    anyExecutionSensitivity:totals(sensitive),inconclusive:totals(inconclusive),windows,errors,derived,transitions,
    runs:runs.map(({rows,...r})=>({...r,testedSubtunes:rows.length})),
    note:"Longest available controlled window per subtune; finite-window sensitivity, not perpetual necessity; file categories overlap."};
  await mkdir(out,{recursive:true});
  await writeFile(path.join(out,"results.json"),JSON.stringify(summary,null,2)+"\n");
  const stil=parseStil(new TextDecoder("windows-1252").decode(await readFile(path.join(root,"DOCUMENTS/STIL.txt"))));
  const buckets=new Map<string,Header[]>();
  for (const h of headers) {
    const rr=grouped.get(h.path)!;
    const bucket=rr.some(r=>sensitive.has(evidence(r)))?"execution-sensitive":rr.some(r=>inconclusive.has(evidence(r)))?"inconclusive":
      rr.some(r=>evidence(r)==="pcm-difference-with-similar-write-sequence")?"pcm-only":h.basicFlag?"basic-declared":"identical";
    if (bucket==="identical") continue;
    const hh=buckets.get(bucket)??[];hh.push(h);buckets.set(bucket,hh);
  }
  const links=["# Complete HVSC 85 ROM audit catalogue","",
    "Metadata and all subtunes of each included file. Each file appears once, in the first applicable bucket: execution sensitivity, inconclusive reference, PCM-only difference, then BASIC declaration. File buckets are mutually exclusive; per-subtune evidence remains in each row. Files with exclusively identical PCM and no BASIC declaration are omitted; they are not guaranteed ROM-independent.","",
    "K-only removes BASIC; B-only removes KERNAL. ΔRMS is normalized PCM difference RMS, writes/prefix count SID writes, drift is maximum relative PHI1 cycles after startup alignment. `derived` means the source outcome read mapped BASIC zero times, under that same KERNAL state. Windows use the longest available controlled measurement. STIL includes applicable directory notes and full file notes (possibly describing other subtunes). Header authors differ from STIL cover artists; missing metadata is explicit. See [the report](../hvsc-rom-requirements.md) for thresholds and limits.","",
    "| Bucket | Files | Pages |","|---|---:|---|"];
  for (const [bucket,hh] of buckets) {
    const pages:string[]=[];
    for (let i=0;i<hh.length;i+=300) {
      const name=`${bucket}-${String(Math.floor(i/300)+1).padStart(3,"0")}.md`;
      pages.push(`[${Math.floor(i/300)+1}](${name})`);
      const lines=[`# ${bucket}: files ${i+1}–${Math.min(i+300,hh.length)} of ${hh.length}`,"","[Catalogue index](index.md). [Method and limits](../hvsc-rom-requirements.md).","",
        "K-only removes BASIC; B-only removes KERNAL. All rows include duration, evidence class, reference RMS/write count, and the three removal outcomes. `derived` marks proven zero-read equivalence, not a separate render.",""];
      for (const h of hh.slice(i,i+300)) {
        lines.push(`## ${md(h.title||"[missing title]")}`,"",`Path: \`${h.path}\``,"",
          `Author: ${md(h.author||"[missing author]")} · Release/year: ${md(h.released||"[missing release/year]")}`,"",
          `${h.magic}; BASIC flag ${h.basicFlag?"set":"clear"}; ${h.songs} subtunes. Complete-file MD5: \`${h.md5}\`; SHA-256: \`${h.sha256}\`.`,"",
          "| Subtune | Seconds | Evidence | Reference RMS; writes | Neither | K-only | B-only |",
          "|---:|---:|---|---|---|---|---|");
        for (const r of grouped.get(h.path)!) lines.push(`| ${r.song} | ${r.seconds} | ${evidence(r)} | ${number(r.both.acRms)}; ${r.both.sidWrites}${r.both.error?`; ERROR ${md(r.both.error)}`:""} | ${describe(r.neither)} | ${describe(r.kernal)} | ${describe(r.basic)} |`);
        lines.push("","STIL (full available entry and applicable directory notes):","",
          ...stilFor(h.path,stil).split("\n").map(line=>`> ${md(line)}`),"");
      }
      await writeFile(path.join(out,name),lines.map(line=>line.trimEnd()).join("\n").trimEnd()+"\n");
    }
    links.push(`| ${bucket} | ${hh.length} | ${pages.join(", ")} |`);
  }
  await writeFile(path.join(out,"index.md"),links.join("\n")+"\n");
  const table=["| Evidence | Files (overlap) | % files | Subtunes | % subtunes |","|---|---:|---:|---:|---:|"];
  for (const [label,g] of Object.entries(summary.categories)) table.push(`| ${label} | ${g.files} | ${g.filePercent} | ${g.subtunes} | ${g.subtunePercent} |`);
  await writeFile(path.join(out,"counts.md"),table.join("\n")+"\n");
  console.log(JSON.stringify({...summary,runs:summary.runs.map(r=>({name:r.name,testedSubtunes:r.testedSubtunes,executionSha256:r.executionSha256}))},null,2));
}
if (import.meta.main) main().catch((error:unknown)=>{console.error(error);process.exitCode=1;});
