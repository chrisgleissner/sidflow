#!/usr/bin/env bun
/**
 * Reproducible HVSC header census + parallel, checkpointed native execution.
 * bun scripts/rom-audit/audit.ts --hvsc /path/C64Music --roms /path/roms
 *   --out workspace/rom-audit --workers 7 --seconds 10 [--limit N]
 * Re-run the identical command to resume; a changed manifest is refused.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { availableParallelism } from "node:os";
import path from "node:path";
import { checkSidHeader } from "../../packages/sidflow-common/src/sid-header-conformance.js";
import { csv, evidence, material, percent, QUIET_RMS, stilFor, parseStil, type Execution } from "./analysis.js";

interface Tune {
  path: string; md5: string; sha256: string; songs: number; magic: string; flags: number;
  title: string; author: string; released: string; basicFlag: boolean;
}
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
function digest(data: string | Uint8Array, algorithm = "sha256"): string {
  return createHash(algorithm).update(data).digest("hex");
}
function args(): {hvsc: string; roms: string; out: string; workers: number; seconds: number; limit: number; selection?: string; seed?: string} {
  const values: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]!, value = process.argv[i + 1];
    if (!["--hvsc", "--roms", "--out", "--workers", "--seconds", "--limit", "--selection", "--seed"].includes(key) || !value)
      throw new Error(`Invalid option ${key}; see script usage comment`);
    values[key.slice(2)] = value;
  }
  for (const key of ["hvsc", "roms", "out"]) if (!values[key]) throw new Error(`--${key} is required`);
  const workers = Number(values.workers ?? Math.max(1, availableParallelism() - 1));
  const seconds = Number(values.seconds ?? 10), limit = Number(values.limit ?? Number.MAX_SAFE_INTEGER);
  if (![workers, limit].every((n) => Number.isSafeInteger(n) && n > 0) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 3600)
    throw new Error("Invalid workers, limit or seconds");
  return { hvsc: path.resolve(values.hvsc!), roms: path.resolve(values.roms!), out: path.resolve(values.out!), workers, seconds, limit,
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
        basicFlag: f.magic === "RSID" && !!((f.flags ?? 0) & 2)};
    }
  }));
  return results;
}
async function runWorker(binary: string, roms: string, jobs: {path:string;song:number;seconds:number}[], seconds: number,
                         save: (row:Execution) => void): Promise<void> {
  if (!jobs.length) return;
  await new Promise<void>((resolve,reject) => {
    const child = spawn(binary,[roms],{stdio:["pipe","pipe","pipe"]});
    let index = 0, timer: ReturnType<typeof setTimeout>;
    const lines = createInterface({input:child.stdout});
    const send = (): void => {
      clearTimeout(timer);
      const job = jobs[index];
      if (!job) {child.stdin.end();return;}
      timer = setTimeout(() => {child.kill("SIGKILL");reject(new Error(`Native render timed out: ${job.path} #${job.song}`));},60000);
      child.stdin.write(`${job.path}\t${job.song}\t${job.seconds}\n`);
    };
    child.stderr.on("data", (chunk:Buffer) => process.stderr.write(chunk));
    child.on("error",reject);
    lines.on("line",(line) => {
      try {
        const row = JSON.parse(line) as Execution;
        const job = jobs[index]!;
        if (row.path !== job.path || row.song !== job.song || row.seconds !== job.seconds) throw new Error("Native result identity mismatch");
        for (const name of ["both","repeat","neither","kernal","basic"] as const) {
          const m = row[name];
          for (const key of ["samples","acRms","differenceRms","sidWrites","matchingWritePrefix","startupOffsetCycles","maxRelativeWriteDriftCycles"] as const)
            if (!Number.isFinite(m[key])) throw new Error(`Invalid native measurement ${name}.${key}`);
        }
        const status = evidence(row);
        if (job.seconds < 10 && !["identical-in-window","pcm-difference-with-similar-write-sequence"].includes(status)) {
          job.seconds = 10; send(); return;
        }
        save(row); index++; send();
      } catch (error) {child.kill("SIGKILL");reject(error);}
    });
    child.on("exit",(code,signal) => {
      clearTimeout(timer);
      if (code !== 0 || index !== jobs.length) reject(new Error(`Native worker exited ${code}/${signal}, ${index}/${jobs.length} jobs; active input ${JSON.stringify(jobs[index]??null)}`));
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
  for (const name of ["HVSC.txt","SID_file_format.txt","Songlengths.md5","STIL.txt","Update85.hvs"])
    documents[name] = digest(await readFile(path.join(a.hvsc,"DOCUMENTS",name)));
  // Independently verify every path and raw file MD5 against the release index.
  const songDb = (await readFile(path.join(a.hvsc,"DOCUMENTS/Songlengths.md5"),"utf8")).replace(/\r/g,"");
  const index = new Map<string,{md5:string;songs:number}>();
  let sidPath = "";
  for (const line of songDb.split("\n")) {
    if (line.startsWith("; /")) sidPath = line.slice(3);
    else if (/^[a-f0-9]{32}=/.test(line)) {
      if (!sidPath || index.has(sidPath)) throw new Error(`Duplicate/missing songlength path ${sidPath}`);
      index.set(sidPath,{md5:line.slice(0,32),songs:line.slice(33).trim().split(/\s+/).length});
    }
  }
  if (index.size !== tunes.length) throw new Error(`Population mismatch: ${index.size} index entries, ${tunes.length} files`);
  for (const tune of tunes) {
    const entry = index.get(tune.path);
    if (!entry || entry.md5 !== tune.md5 || entry.songs !== tune.songs)
      throw new Error(`Release index mismatch: ${tune.path}`);
  }
  const roms: Record<string,string> = {};
  for (const name of ["kernal.901227-03.bin","basic.901226-01.bin","characters.901225-01.bin"])
    roms[name] = digest(await readFile(path.join(a.roms,name)));
  const manifest = {schema:1, hvscRoot:a.hvsc, files:tunes.length,songs:allSongs, seconds:a.seconds,
    ...(a.selection?{selectionSha256:digest(await readFile(a.selection))}:{}),
    nativeSha256:digest(await readFile(path.join(scriptDir,"../../workspace/rom-audit-native/render"))),
    sourceSha256:digest(await readFile(path.join(scriptDir,"../../packages/sidflow-classify/node_modules/libsidplayfp-wasm/dist/complete-source.tar.gz"))),
    corpusSha256:digest(tunes.map((t)=>`${t.path}\t${t.sha256}\n`).join("")),documents,roms,
    protocol:{rate:8000,stereo:true,powerOnDelay:5000,chunkCycles:256,engine:"SIDLite",missingBasic:"8192 zero bytes",missingKernal:"libsidplayfp minimal interrupt shim",chargen:"constant in all variants",adaptive:"BASIC-flagged, execution-sensitive and inconclusive references tested for at least 10 seconds"}};
  let seedRows = "";
  let seed: Record<string,unknown> | undefined;
  if (a.seed) {
    const oldManifestText=await readFile(path.join(a.seed,"manifest.json"),"utf8");
    const old=JSON.parse(oldManifestText) as typeof manifest;
    for (const key of ["hvscRoot","files","songs","seconds","sourceSha256","corpusSha256","documents","roms","protocol"] as const)
      if (JSON.stringify(old[key])!==JSON.stringify(manifest[key])) throw new Error(`Seed provenance differs: ${key}`);
    seedRows=await readFile(path.join(a.seed,"execution.jsonl"),"utf8");
    if (!seedRows.endsWith("\n")) throw new Error("Seed checkpoint is truncated");
    seed={manifestSha256:digest(oldManifestText),checkpointSha256:digest(seedRows),originalRendererSha256:old.nativeSha256};
  }
  const manifestText = JSON.stringify({...manifest,optimization:"unread BASIC bank equivalence; derivedFrom marks skipped renders",...(seed?{seed}:{})},null,2)+"\n";
  const manifestPath = path.join(a.out,"manifest.json");
  if (existsSync(manifestPath) && readFileSync(manifestPath,"utf8") !== manifestText) throw new Error("Existing audit manifest differs; use a different --out");
  await writeFile(manifestPath,manifestText);
  await writeFile(path.join(a.out,"headers.json"),JSON.stringify(tunes)+"\n");
  const checkpoint = path.join(a.out,"execution.jsonl");
  if (seedRows && !existsSync(checkpoint)) await writeFile(checkpoint,seedRows);
  const rows = new Map<string,Execution>();
  if (existsSync(checkpoint)) {
    const raw = readFileSync(checkpoint,"utf8");
    if (raw && !raw.endsWith("\n")) throw new Error("Checkpoint has an incomplete final line; preserve and repair it before resume");
    for (const line of raw.trim().split("\n").filter(Boolean)) {
      const row = JSON.parse(line) as Execution; const key = `${row.path}\t${row.song}`;
      if (rows.has(key)) throw new Error(`Duplicate checkpoint result ${key}`);
      rows.set(key,row);
    }
  }
  let jobs = tunes.flatMap((t)=>Array.from({length:t.songs},(_,i)=>({path:path.join(a.hvsc,t.path),song:i+1,seconds:t.basicFlag?Math.max(10,a.seconds):a.seconds})));
  if (a.selection) {
    const selection=JSON.parse(await readFile(a.selection,"utf8")) as {path:string;song:number}[];
    const keys=new Set(selection.map((s)=>`${path.resolve(a.hvsc,s.path)}\t${s.song}`));
    jobs=jobs.filter((j)=>keys.has(`${j.path}\t${j.song}`));
    if (jobs.length!==keys.size) throw new Error("Selection contains unknown paths or subtunes");
  }
  jobs=jobs.slice(0,a.limit);
  const jobKeys=new Set(jobs.map((j)=>`${j.path}\t${j.song}`));
  for (const [key,row] of rows) {
    if (!jobKeys.has(key) || row.seconds<a.seconds) throw new Error(`Unexpected or undersized checkpoint row ${key}`);
  }
  const pending = jobs.filter((j)=>!rows.has(`${j.path}\t${j.song}`));
  const shards: typeof pending[] = Array.from({length:a.workers},()=>[]);
  pending.forEach((j,i)=>shards[i%a.workers]!.push(j));
  const started = Date.now(); let added=0;
  console.log(`Verified release index: ${tunes.length} files / ${allSongs} subtunes; ${pending.length} pending; ${a.workers} workers.`);
  const progress = setInterval(()=>console.log(`${rows.size}/${jobs.length} done; ${added} this run in ${Math.round((Date.now()-started)/1000)}s`),30000);
  try {
    await Promise.all(shards.map((shard)=>runWorker(path.join(scriptDir,"../../workspace/rom-audit-native/render"),a.roms,shard,a.seconds,(row)=>{
      appendFileSync(checkpoint,JSON.stringify(row)+"\n");rows.set(`${row.path}\t${row.song}`,row);added++;
    })));
  } finally {clearInterval(progress);}
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
