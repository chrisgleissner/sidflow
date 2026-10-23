#!/usr/bin/env bun
/**
 * Reproducible HVSC header census + parallel, checkpointed native execution.
 * bun scripts/rom-audit/audit.ts --hvsc /path/C64Music --roms /path/roms
 *   --out workspace/rom-audit --workers 7 --seconds 10 [--limit N]
 * Re-run the identical command to resume; a changed manifest is refused.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, openSync, fsyncSync, closeSync } from "node:fs";
import { mkdir, mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { RELEASE_DOCUMENTS,releaseLengths,readVerifiedSid,freshNativeRenderer } from "./inputs.js";
import { scopeLock,validateHardening,verifyHardeningEvidence,hardeningIdentity,type HardeningCertificate } from "./rollout.js";
import { RolloutLedger,ceilings } from "./ledger.js";
import { stringifyDeterministic,type JsonValue } from "../../packages/sidflow-common/src/json.js";
import { readCheckpoint } from "./checkpoint.js";
import { SYSTEM_ROMS } from "../../packages/sidflow-classify/src/render/system-roms-fetch.js";
import { observationHorizon, METHODOLOGY, AUDIT_PROTOCOL, validateMatrix } from "./methodology.js";
import { publishProduction } from "./publish-production.js";
import { checkSidHeader } from "../../packages/sidflow-common/src/sid-header-conformance.js";
import { csv, evidence, material, percent, QUIET_RMS, stilFor, parseStil, type Execution } from "./analysis.js";

interface Tune {
  path: string; md5: string; sha256: string; songs: number; magic: string; flags: number;
  header: NonNullable<ReturnType<typeof checkSidHeader>["fields"]>;
  title: string; author: string; released: string; basicFlag: boolean;
}
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
function digest(data: string | Uint8Array, algorithm = "sha256"): string {
  return createHash(algorithm).update(data).digest("hex");
}
function args(): {hvsc: string; roms: string; out: string; workers: number; seconds: number; limit: number; selection?: string; seed?: string; duration: string; budget: number; rollout:string; hardening?:string} {
  const values: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]!, value = process.argv[i + 1];
    if (!["--hvsc", "--roms", "--out", "--workers", "--seconds", "--limit", "--selection", "--seed", "--duration", "--budget-seconds", "--rollout", "--hardening"].includes(key) || !value)
      throw new Error(`Invalid option ${key}; see script usage comment`);
    values[key.slice(2)] = value;
  }
  for (const key of ["hvsc", "roms", "out"]) if (!values[key]) throw new Error(`--${key} is required`);
  const workers = Number(values.workers ?? Math.max(1, availableParallelism() - 1));
  const seconds = Number(values.seconds ?? 10), limit = Number(values.limit ?? Number.MAX_SAFE_INTEGER);
  if (![workers, limit].every((n) => Number.isSafeInteger(n) && n > 0) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 3600)
    throw new Error("Invalid workers, limit or seconds");
  const duration=values.duration ?? "songlength";
  const budget=Number(values["budget-seconds"] ?? 0);
  if (!["songlength","window"].includes(duration) || !Number.isFinite(budget) || budget<0) throw new Error("Invalid duration or budget");
  const rollout=values.rollout??"pilot";
  if(!["pilot","full"].includes(rollout))throw new Error("Invalid rollout (pilot/full)");
  // A pilot without a reviewed selection would take the shortest tunes first and say nothing about long horizons.
  if(rollout==="pilot"&&!values.selection)throw new Error("--rollout pilot requires --selection (see select-pilot.ts)");
  return { duration, budget, rollout,...(values.hardening?{hardening:path.resolve(values.hardening)}:{}), hvsc: path.resolve(values.hvsc!), roms: path.resolve(values.roms!), out: path.resolve(values.out!), workers, seconds, limit,
    ...(values.selection?{selection:path.resolve(values.selection)}:{}),
    ...(values.seed?{seed:path.resolve(values.seed)}:{}) };
}
async function census(root: string): Promise<Tune[]> {
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sid"))
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort((a,b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const results: Tune[] = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({length: 8}, async () => {
    while (next < files.length) {
      const index = next++, relative = files[index]!;
      if (/[\t\r\n]/.test(relative)) throw new Error(`Path unsupported by native protocol: ${relative}`);
      const bytes = await readFile(path.join(root, relative));
      const check = checkSidHeader(bytes);
      if (!check.fields || check.findings.some((f) => f.severity === "violation"))
        throw new Error(`Invalid SID header ${relative}: ${JSON.stringify(check.findings)}`);
      const f = check.fields;
      const string = (offset: number): string => new TextDecoder("windows-1252").decode(bytes.subarray(offset, offset+32)).split("\0")[0]!.trim();
      results[index] = {path: relative, md5: digest(bytes,"md5"), sha256: digest(bytes), songs:f.songs,
        magic:f.magic, flags:f.flags ?? 0, title:string(0x16),author:string(0x36),released:string(0x56),
        header:f, basicFlag: f.magic === "RSID" && !!((f.flags ?? 0) & 2)};
    }
  }));
  return results;
}
async function runWorker(binary: string, roms: string, nextJob: () => {path:string;song:number;seconds:number;sha256:string} | undefined,
                         save: (row:Execution) => void,signal:AbortSignal): Promise<void> {
  await new Promise<void>((resolve,reject) => {
    const environment={...process.env};delete environment.ROM_AUDIT_CONTROL_DIR;
    const child = spawn(binary,[roms],{stdio:["pipe","pipe","pipe"],env:environment});
    const abort=():void=>{child.kill("SIGKILL");};signal.addEventListener("abort",abort,{once:true});
    let job: {path:string;song:number;seconds:number;sha256:string} | undefined, timer: ReturnType<typeof setTimeout>;
    const lines = createInterface({input:child.stdout});
    const send = (): void => {
      try {
      clearTimeout(timer);
      job = nextJob();
      if (!job) {child.stdin.end();return;}
      const active=job;
      timer = setTimeout(() => {child.kill("SIGKILL");reject(new Error(`Native render timed out: ${active.path} #${active.song}`));},Math.max(60000,job.seconds*2000));
      const bytes=readVerifiedSid(job.path,job.sha256);
      child.stdin.write(`${job.path}\t${job.song}\t${job.seconds}\thex:${bytes.toString("hex")}\n`);
      }catch(error){child.kill("SIGKILL");reject(error);}
    };
    child.stderr.on("data", (chunk:Buffer) => process.stderr.write(chunk));
    child.on("error",reject);
    child.stdin.on("error",error=>{child.kill("SIGKILL");reject(error);});
    lines.on("line",(line) => {
      try {
        const row = JSON.parse(line) as Execution;
        if (!job) throw new Error("Unsolicited native result");
        if (row.path !== job.path || row.song !== job.song || row.seconds !== job.seconds) throw new Error("Native result identity mismatch");
        for (const name of ["both","repeat","neither","kernal","basic"] as const) {
          const m = row[name];
          for (const key of ["samples","acRms","differenceRms","sidWrites","matchingWritePrefix","startupOffsetCycles","maxRelativeWriteDriftCycles"] as const)
            if (!Number.isFinite(m[key])) throw new Error(`Invalid native measurement ${name}.${key}`);
        }
        validateMatrix(row);
        save(row); send();
      } catch (error) {child.kill("SIGKILL");reject(error);}
    });
    child.on("exit",(code,exitSignal) => {
      clearTimeout(timer);signal.removeEventListener("abort",abort);
      if (code !== 0 || job !== undefined) reject(new Error(`Native worker exited ${code}/${exitSignal}, active input ${JSON.stringify(job??null)}`));
      else resolve();
    });
    send();
  });
}
async function main(): Promise<void> {
  const a = args();
  await mkdir(a.out,{recursive:true});
  const tunes = await census(a.hvsc);
  const allSongs = tunes.reduce((n,t)=>n+t.songs,0);
  const documents: Record<string,string> = {};
  for (const name of RELEASE_DOCUMENTS)
    documents[name] = digest(await readFile(path.join(a.hvsc,"DOCUMENTS",name)));
  // Independently verify every path and raw file MD5 against the release index.
  const songDb = (await readFile(path.join(a.hvsc,"DOCUMENTS/Songlengths.md5"),"utf8")).replace(/\r/g,"");
  const index=releaseLengths(songDb);
  if (index.size !== tunes.length) throw new Error(`Population mismatch: ${index.size} index entries, ${tunes.length} files`);
  for (const tune of tunes) {
    const entry = index.get(tune.path);
    if (!entry || entry.md5 !== tune.md5 || entry.tokens.length !== tune.songs)
      throw new Error(`Release index mismatch: ${tune.path}`);
  }
  const roms: Record<string,string> = {},romBytes:Record<string,Buffer>={};
  for (const name of ["kernal.901227-03.bin","basic.901226-01.bin","characters.901225-01.bin"])
    {romBytes[name]=await readFile(path.join(a.roms,name));roms[name]=digest(romBytes[name]!);}
  for(const spec of SYSTEM_ROMS)if(roms[spec.localName]!==spec.sha256)throw new Error(`Non-reference ROM: ${spec.localName}`);
  const lengths=new Map([...index].map(([name,entry])=>[name,entry.tokens]));
  const horizons=Object.fromEntries(tunes.map(t=>[t.path,Array.from({length:t.songs},(_,i)=>observationHorizon(lengths.get(t.path)?.[i],a.seconds))]));
  const headersText=stringifyDeterministic(tunes as unknown as JsonValue,0),horizonsText=stringifyDeterministic(horizons as unknown as JsonValue,0);
  // Serialize audit parents sharing a corpus BEFORE any shared build output is touched.
  const corpusSha256=digest(tunes.map((t)=>`${t.path}\t${t.sha256}\n`).join(""));
  scopeLock(corpusSha256);
  const nativeBytes=await readFile(freshNativeRenderer());
  const manifest = {schema:3,headersSha256:digest(headersText),horizonsSha256:digest(horizonsText),methodology:METHODOLOGY,duration:a.duration, hvscRoot:a.hvsc, files:tunes.length,songs:allSongs, seconds:a.seconds,
    ...(a.selection?{selectionSha256:digest(await readFile(a.selection))}:{}),
    wasmSha256:digest(await readFile(path.join(scriptDir,"../../packages/sidflow-classify/node_modules/libsidplayfp-wasm/dist/sidlite/libsidplayfp.wasm"))),
    nativeSha256:digest(nativeBytes),
    sourceSha256:digest(await readFile(path.join(scriptDir,"../../packages/sidflow-classify/node_modules/libsidplayfp-wasm/dist/complete-source.tar.gz"))),
    corpusSha256,documents,roms,
    protocol:AUDIT_PROTOCOL};
  if(a.rollout==="full"){
    const cert=a.hardening?JSON.parse(await readFile(a.hardening,"utf8")) as HardeningCertificate:undefined;
    const identity=await hardeningIdentity();
    if(!cert||!validateHardening(cert,identity,manifest.nativeSha256)||!verifyHardeningEvidence(cert,path.join(path.dirname(a.hardening!),identity.slice(0,16))))
      throw new Error("Full rollout requires a matching completed hardening certificate with intact evidence; pilot is limited to 5%");
  }
  let seedRows = "";
  let seed: Record<string,unknown> | undefined;
  if (a.seed) {
    const oldManifestText=await readFile(path.join(a.seed,"manifest.json"),"utf8");
    const old=JSON.parse(oldManifestText) as typeof manifest;
    for (const key of ["schema","methodology","duration","hvscRoot","files","songs","seconds","nativeSha256","wasmSha256","sourceSha256","corpusSha256","documents","roms","protocol","headersSha256","horizonsSha256"] as const)
      if (JSON.stringify(old[key])!==JSON.stringify(manifest[key])) throw new Error(`Seed provenance differs: ${key}`);
    seedRows=await readFile(path.join(a.seed,"execution.jsonl"),"utf8");
    if (!seedRows.endsWith("\n")) throw new Error("Seed checkpoint is truncated");
    seed={manifestSha256:digest(oldManifestText),checkpointSha256:digest(seedRows),originalRendererSha256:old.nativeSha256};
  }
  const manifestText = JSON.stringify({...manifest,optimization:"sequential variants; no causal inference across horizons",...(seed?{seed}:{})},null,2)+"\n";
  const manifestPath = path.join(a.out,"manifest.json");
  if (existsSync(manifestPath) && readFileSync(manifestPath,"utf8") !== manifestText) throw new Error("Existing audit manifest differs; use a different --out");
  await writeFile(manifestPath,manifestText);
  await writeFile(path.join(a.out,"headers.json"),headersText);
  await writeFile(path.join(a.out,"horizons.json"),horizonsText);
  const checkpoint = path.join(a.out,"execution.jsonl");
  if (seedRows && !existsSync(checkpoint)) await writeFile(checkpoint,seedRows);
  const rows = readCheckpoint(checkpoint);
  let jobs = tunes.flatMap((t)=>Array.from({length:t.songs},(_,i)=>({path:path.join(a.hvsc,t.path),song:i+1,sha256:t.sha256,seconds:a.duration==="songlength"?observationHorizon(lengths.get(t.path)?.[i],a.seconds).seconds:Math.max(10,a.seconds)})));
  if (a.selection) {
    const selection=JSON.parse(await readFile(a.selection,"utf8")) as {path:string;song:number}[];
    const keys=new Set(selection.map((s)=>`${path.resolve(a.hvsc,s.path)}\t${s.song}`));
    jobs=jobs.filter((j)=>keys.has(`${j.path}\t${j.song}`));
    if (jobs.length!==keys.size) throw new Error("Selection contains unknown paths or subtunes");
  }
  jobs=jobs.slice(0,a.limit);
  const jobKeys=new Set(jobs.map((j)=>`${j.path}\t${j.song}`));
  const expectedSeconds=new Map(jobs.map(j=>[`${j.path}\t${j.song}`,j.seconds]));
  for (const [key,row] of rows) {
    validateMatrix(row);
    if (!jobKeys.has(key) || row.seconds!==expectedSeconds.get(key) || !row.matrix) throw new Error(`Unexpected or undersized checkpoint row ${key}`);
  }
  const pending = jobs.filter((j)=>!rows.has(`${j.path}\t${j.song}`));
  const started = Date.now(); let added=0, next=0;
  let runnable=pending.filter(j=>j.seconds<=3600).sort((a,b)=>a.seconds-b.seconds||Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))||a.song-b.song);
  const ledger=RolloutLedger.open(manifest.corpusSha256);
  const imported=ledger.importHistory(a.hvsc,manifest.corpusSha256);
  const limit=a.rollout==="pilot"?ceilings(tunes.length,allSongs):undefined;
  if(limit&&(ledger.subtunes>limit.maxSongs||ledger.distinctFiles>limit.maxFiles))
    throw new Error(`Existing scope (${ledger.subtunes} subtunes / ${ledger.distinctFiles} files) exceeds the 5% pilot ceiling (${limit.maxSongs} / ${limit.maxFiles}); hardened full-rollout certificate required`);
  console.log(`Ledger: ${ledger.subtunes} distinct subtunes / ${ledger.distinctFiles} files already rendered (${imported} newly imported)${limit?`; pilot ceiling ${limit.maxSongs} / ${limit.maxFiles}`:""}.`);
  let ceilingSkipped=0;
  const takeJob=():typeof runnable[number]|undefined=>{
    if(a.budget && Date.now()-started>=a.budget*1000)return undefined;
    while(next<runnable.length){
      const job=runnable[next++]!;
      // Reserve durably BEFORE dispatch so a crash cannot leave a rendered identity uncounted.
      if(ledger.reserve([{sha256:job.sha256,path:path.relative(a.hvsc,job.path),song:job.song}],`audit:${a.out}`,limit))return job;
      ceilingSkipped++;
    }
    return undefined;
  };
  console.log(`Rollout ${a.rollout}; ${runnable.length} runnable candidates. Full corpus inventory remains explicit unknown where unmeasured.`);
  console.log(`Verified release index: ${tunes.length} files / ${allSongs} subtunes; ${pending.length} pending; ${a.workers} workers.`);
  const runtime=await mkdtemp(path.join(tmpdir(),"sidflow-rom-audit-runtime-"));
  const binary=path.join(runtime,"render");await writeFile(binary,nativeBytes,{mode:0o500});
  for(const [name,bytes] of Object.entries(romBytes))await writeFile(path.join(runtime,name),bytes,{mode:0o400});
  const stop=new AbortController();
  const progress = setInterval(()=>console.log(`${rows.size}/${jobs.length} done; ${added} this run; ${((Date.now()-started)/1000).toFixed(1)}s; ${(added/Math.max(1,(Date.now()-started)/1000)).toFixed(3)} subtunes/s`),30000);
  try {
    await Promise.all(Array.from({length:a.workers},()=>runWorker(binary,runtime,
      takeJob, (row)=>{
      appendFileSync(checkpoint,JSON.stringify(row)+"\n");
      const fd=openSync(checkpoint,"r");try {fsyncSync(fd);} finally {closeSync(fd);}
      rows.set(`${row.path}\t${row.song}`,row);added++;
    },stop.signal)));
  } catch(error){stop.abort();throw error;} finally {clearInterval(progress);await rm(runtime,{recursive:true,force:true});}
  await writeFile(path.join(a.out,"coverage.json"),JSON.stringify({total:jobs.length,completed:rows.size,ceilingSkipped,ledgerSubtunes:ledger.subtunes,ledgerFiles:ledger.distinctFiles,
    pending:jobs.length-rows.size,unsupportedDuration:pending.filter(j=>j.seconds>3600).length,
    elapsedSec:(Date.now()-started)/1000,added,subtunesPerSec:added/Math.max(1,(Date.now()-started)/1000)},null,2)+"\n");
  await publishProduction(a.out);
  if (rows.size!==jobs.length) {console.log(`Coverage-limited publication; ${jobs.length-rows.size} subtunes pending.`);return;}
  const counts: Record<string,number> = {}, files: Record<string,Set<string>> = {};
  for (const row of rows.values()) {const e=evidence(row);counts[e]=(counts[e]??0)+1;(files[e]??=new Set()).add(row.path);}
  const summary = {corpusFiles:tunes.length,corpusSubtunes:allSongs,testedSubtunes:rows.size,
    provedRedundantRenders:[...rows.values()].reduce((n,r)=>n+[r.neither,r.kernal].filter((m)=>!!m.derivedFrom).length,0),
    executionWindows:Object.fromEntries([...rows.values()].reduce((map,r)=>map.set(r.seconds,(map.get(r.seconds)??0)+1),new Map<number,number>())),
    headerGroups:Object.fromEntries(["PSID","RSID_MACHINE_CODE","RSID_BASIC"].map((name)=>{
      const group=tunes.filter((t)=>(t.magic==="PSID"?"PSID":t.basicFlag?"RSID_BASIC":"RSID_MACHINE_CODE")===name);
      return [name,{files:group.length,subtunes:group.reduce((n,t)=>n+t.songs,0)}];
    })),
    basicFlagFiles:tunes.filter((t)=>t.basicFlag).length,basicFlagSubtunes:tunes.filter((t)=>t.basicFlag).reduce((n,t)=>n+t.songs,0),
    groups:Object.fromEntries(Object.entries(counts).sort().map(([key,value])=>[key,{subtunes:value,percentAllSubtunes:percent(value,allSongs),files:files[key]!.size}])),
    elapsedThisRunSec:(Date.now()-started)/1000};
  await writeFile(path.join(a.out,"summary.json"),JSON.stringify(summary,null,2)+"\n");
  const ordered = jobs.map((j)=>rows.get(`${j.path}\t${j.song}`)!);
  const columns = ["path","song","seconds","evidence","reference_ac_rms","neither_equal","kernal_equal","basic_equal","neither_error","kernal_error","basic_error","neither_difference_rms","kernal_difference_rms","basic_difference_rms"];
  const csvLines = ordered.map((r)=>[path.relative(a.hvsc,r.path),r.song,r.seconds,evidence(r),r.both.acRms,r.neither.equal,r.kernal.equal,r.basic.equal,r.neither.error,r.kernal.error,r.basic.error,r.neither.differenceRms,r.kernal.differenceRms,r.basic.differenceRms].map(csv).join(","));
  await writeFile(path.join(a.out,"execution.csv"),[columns.join(","),...csvLines].join("\n")+"\n");
  const stil = parseStil(new TextDecoder("windows-1252").decode(await readFile(path.join(a.hvsc,"DOCUMENTS/STIL.txt"))));
  const affected = new Map<string,Execution[]>();
  for (const r of ordered) if (!["identical-in-window","quiet-reference","pcm-difference-with-similar-write-sequence"].includes(evidence(r))) {
    const relative=path.relative(a.hvsc,r.path); const group=affected.get(relative)??[]; group.push(r);affected.set(relative,group);
  }
  const lines = ["# HVSC 85 ROM execution audit — affected-song catalogue","",
    `Every subtune was tested for at least ${a.seconds} seconds from startup. BASIC-flagged, execution-sensitive and inconclusive cases were tested for at least 10 seconds. The CSV records each duration. Tested ${rows.size}/${allSongs} subtunes (${percent(rows.size,allSongs)}).`,"",
    "This catalogue includes changes to SID register execution and inconclusive reference errors/instability. Labels describe measured sensitivity, not an assertion that the tune cannot be played without a ROM. Quiet references and PCM differences with similar register sequences are in execution.csv; neither is evidence of ROM independence.","",
    "KERNAL-only means BASIC is absent; BASIC-only means KERNAL is absent. `error` means emulation failed; `quiet` means AC RMS below −60 dBFS. Full STIL entries include notes about other subtunes and covers: STIL ARTIST is not necessarily the SID composer. Release strings are reproduced literally, without inventing a year.","",
    "| Evidence | Subtunes | % of all subtunes | Files (overlap possible) |","|---|---:|---:|---:|"];
  for (const [key,value] of Object.entries(summary.groups)) lines.push(`| ${key} | ${value.subtunes} | ${value.percentAllSubtunes} | ${value.files} |`);
  lines.push("","## Affected file details","");
  for (const tune of tunes.filter((t)=>affected.has(t.path))) {
    lines.push(`### ${tune.title.replace(/\n/g," ")} — ${tune.author}`,"",`- Path: \`${tune.path}\``,
      `- Release/year field: ${tune.released || "not specified"}`,`- Header: ${tune.magic}; BASIC flag ${tune.basicFlag ? "set" : "clear"}; ${tune.songs} subtune(s).`,
      `- File MD5: \`${tune.md5}\``,"","| Subtune | Evidence | Both-ROM AC RMS | Neither | KERNAL only | BASIC only |","|---:|---|---:|---|---|---|");
    for (const r of affected.get(tune.path)!) {
      const describe = (m:Execution["neither"]):string => `${m.error ? `error: ${m.error}` : `${m.equal?"identical PCM":material(m,r.both)?"material PCM difference":"minor PCM difference"}${m.acRms<QUIET_RMS?"; quiet":""}; ΔRMS ${m.differenceRms.toExponential(3)}`}; ${m.sidWrites} writes, ${m.matchingWritePrefix} prefix matches, ${m.maxRelativeWriteDriftCycles} cycles drift`;
      lines.push(`| ${r.song} (${r.seconds}s) | ${evidence(r)} | ${r.both.acRms.toExponential(3)}; ${r.both.sidWrites} writes | ${describe(r.neither)} | ${describe(r.kernal)} | ${describe(r.basic)} |`);
    }
    lines.push("","STIL (verbatim, including applicable directory notes):","",...stilFor(tune.path,stil).split("\n").map((l)=>`> ${l}`),"");
  }
  await writeFile(path.join(a.out,"affected-songs.md"),lines.join("\n")+"\n");
  console.log(JSON.stringify(summary,null,2));
}
if (import.meta.main) main().catch((error:unknown)=>{console.error(error);process.exitCode=1;});
