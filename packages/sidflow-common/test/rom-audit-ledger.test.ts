import { describe,expect,it } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from "node:fs";
import { mkdtemp,rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { RolloutLedger,ProcessLock,ceilings } from "../../../scripts/rom-audit/ledger.js";
const corpus="c".repeat(64);
const digest=(text:string):string=>createHash("sha256").update(text).digest("hex");
const id=(name:string,song:number)=>({sha256:digest(name),path:name,song});
async function withDirectory(body:(dir:string)=>Promise<void>|void):Promise<void>{
 const dir=await mkdtemp(path.join(tmpdir(),"rom-ledger-"));
 try{await body(dir);}finally{await rm(dir,{recursive:true,force:true});}
}
describe("rollout reservation ledger",()=>{
 it("computes 5% ceilings from both denominators",()=>{
  expect(ceilings(61157,87868)).toEqual({maxFiles:3057,maxSongs:4393});
 });
 it("counts unique identities across instances and survives reopening",()=>withDirectory(dir=>{
  const a=RolloutLedger.open(corpus,dir);
  expect(a.reserve([id("A/x.sid",1),id("A/x.sid",2),id("A/x.sid",1)],"first")).toBe(true);
  expect(a.subtunes).toBe(2);expect(a.distinctFiles).toBe(1);
  const b=RolloutLedger.open(corpus,dir);   // a new process would see the same durable state
  expect(b.subtunes).toBe(2);
  expect(b.reserve([id("A/x.sid",2)],"rerender")).toBe(true);
  expect(RolloutLedger.open(corpus,dir).subtunes).toBe(2);
  expect(readFileSync(a.file,"utf8").trim().split("\n")).toHaveLength(2);
 }));
 it("identifies files by content, so a copy under another path or output directory counts once",()=>withDirectory(dir=>{
  const ledger=RolloutLedger.open(corpus,dir),limit={maxFiles:1,maxSongs:1};
  const original=id("A/x.sid",1);
  expect(ledger.reserve([original],"audit:/tmp/a",limit)).toBe(true);
  expect(ledger.reserve([{...original,path:"/tmp/copy-of-x.sid"}],"verify-native",limit)).toBe(true);
  expect(ledger.subtunes).toBe(1);
  expect(ledger.reserve([id("B/y.sid",1)],"audit:/tmp/b",limit)).toBe(false);   // a different --out gets no fresh allowance
 }));
 it("enforces the song and file ceilings atomically, without counting re-renders",()=>withDirectory(dir=>{
  const ledger=RolloutLedger.open(corpus,dir),limit={maxFiles:2,maxSongs:3};
  expect(ledger.reserve([id("a",1),id("a",2)],"s",limit)).toBe(true);
  expect(ledger.reserve([id("b",1),id("c",1)],"s",limit)).toBe(false);   // would be a third file and fourth song
  expect(ledger.subtunes).toBe(2);expect(ledger.distinctFiles).toBe(1);   // all-or-none
  expect(ledger.reserve([id("b",1)],"s",limit)).toBe(true);
  expect(ledger.reserve([id("b",2)],"s",limit)).toBe(false);              // song ceiling
  expect(ledger.reserve([id("a",1),id("b",1)],"s",limit)).toBe(true);     // counted identities are free
 }));
 it("sees reservations appended by another instance between calls",()=>withDirectory(dir=>{
  const a=RolloutLedger.open(corpus,dir),b=RolloutLedger.open(corpus,dir),limit={maxFiles:5,maxSongs:2};
  expect(a.reserve([id("a",1)],"a",limit)).toBe(true);
  expect(b.reserve([id("b",1)],"b",limit)).toBe(true);
  expect(a.reserve([id("c",1)],"a",limit)).toBe(false);
 }));
 it("preserves and ignores a torn final record, then appends on a clean line",()=>withDirectory(dir=>{
  const first=RolloutLedger.open(corpus,dir);first.reserve([id("a",1)],"s");
  appendFileSync(first.file,'{"v":2,"sha256":"ab');
  const reopened=RolloutLedger.open(corpus,dir);
  expect(reopened.subtunes).toBe(1);
  const torn=readdirSync(dir).filter(n=>n.includes(".torn."));
  expect(torn).toHaveLength(1);expect(readFileSync(path.join(dir,torn[0]!),"utf8")).toBe('{"v":2,"sha256":"ab');
  reopened.reserve([id("b",1)],"s");
  expect(RolloutLedger.open(corpus,dir).subtunes).toBe(2);
 }));
 it("refuses interior damage, a failed checksum and invalid identities",()=>withDirectory(dir=>{
  const ledger=RolloutLedger.open(corpus,dir);
  for(const bad of [{...id("a",1),sha256:"short"},{...id("a",1),path:"a\tb"},{...id("a",0)},{...id("a",1.5)},{...id("a",257)}])
   expect(()=>ledger.reserve([bad],"s")).toThrow("Invalid ledger identity");
  expect(ledger.subtunes).toBe(0);
  ledger.reserve([id("a",1),id("b",1)],"s");
  const lines=readFileSync(ledger.file,"utf8").split("\n").filter(Boolean);
  writeFileSync(ledger.file,[lines[0],"not json",lines[1]].join("\n")+"\n");
  expect(()=>RolloutLedger.open(corpus,dir)).toThrow();
  writeFileSync(ledger.file,lines[0]!.replace('"song":1','"song":2')+"\n");
  expect(()=>RolloutLedger.open(corpus,dir)).toThrow("checksum");
  writeFileSync(ledger.file,lines[0]!.replace('"v":2','"v":1')+"\n");
  expect(()=>RolloutLedger.open(corpus,dir)).toThrow("Unsupported");
  expect(()=>RolloutLedger.open("short",dir)).toThrow("Invalid corpus");
 }));
 it("imports prior audit runs of the same corpus only, counting an unterminated final record",()=>withDirectory(dir=>{
  const root=path.join(dir,"hvsc"),run=path.join(dir,"run1"),other=path.join(dir,"run2");
  for(const d of [root,path.join(root,"A"),path.join(root,"B"),path.join(root,"Z"),run,other])mkdirSync(d,{recursive:true});
  for(const f of ["A/x.sid","B/y.sid","Z/z.sid"])writeFileSync(path.join(root,f),f);
  writeFileSync(path.join(run,"manifest.json"),JSON.stringify({corpusSha256:corpus,hvscRoot:root}));
  writeFileSync(path.join(run,"execution.jsonl"),`{"path":"${root}/A/x.sid","song":1}\n{"path":"${root}/A/x.sid","song":2}\n{"path":"${root}/B/y.sid","song":3`);
  writeFileSync(path.join(other,"manifest.json"),JSON.stringify({corpusSha256:"d".repeat(64),hvscRoot:root}));
  writeFileSync(path.join(other,"execution.jsonl"),`{"path":"${root}/Z/z.sid","song":1}\n`);
  const ledger=RolloutLedger.open(corpus,path.join(dir,"ledgers"));
  expect(ledger.importHistory(root,corpus,dir,path.join(dir,"no-subset"))).toBe(3);
  expect(ledger.has({sha256:digest("B/y.sid"),song:3})).toBe(true);expect(ledger.has({sha256:digest("Z/z.sid"),song:1})).toBe(false);
  expect(ledger.importHistory(root,corpus,dir,path.join(dir,"no-subset"))).toBe(0);   // idempotent
  writeFileSync(path.join(run,"execution.jsonl"),`{"path":"/elsewhere/x.sid","song":1}\n`);
  expect(()=>RolloutLedger.open(corpus,path.join(dir,"l2")).importHistory(root,corpus,dir,path.join(dir,"no-subset"))).toThrow("escapes corpus");
 }));
 it("imports every subtune of the integration subset",()=>withDirectory(dir=>{
  const root=path.join(dir,"hvsc"),subset=path.join(dir,"subset");
  mkdirSync(path.join(root,"A"),{recursive:true});mkdirSync(path.join(subset,"A"),{recursive:true});
  const header=Buffer.alloc(0x7c);header.write("PSID");header.writeUInt16BE(3,0x0e);
  writeFileSync(path.join(root,"A/x.sid"),header);writeFileSync(path.join(subset,"A/x.sid"),header);
  expect(RolloutLedger.open(corpus,path.join(dir,"ledgers")).importHistory(root,corpus,dir,subset)).toBe(3);
 }));
});
describe("kernel scope lock",()=>{
 it("admits one holder at a time and reports the holder",()=>withDirectory(dir=>{
  const file=path.join(dir,"x.lock"),first=new ProcessLock(file,"test");
  first.acquire();
  expect(()=>new ProcessLock(file,"test").acquire()).toThrow(`pid=${process.pid}`);
  expect(()=>first.acquire()).toThrow("already held by this object");
  first.release();
  const second=new ProcessLock(file,"test");second.acquire();second.release();
  expect(existsSync(file)).toBe(true);   // never unlinked: no unlink race
 }));
 it("is released by the kernel when the holder is killed with SIGKILL",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"rom-lock-")),file=path.join(dir,"held.lock");
  try{
   const script=`import {ProcessLock} from ${JSON.stringify(path.resolve(import.meta.dir,"../../../scripts/rom-audit/ledger.ts"))};
    new ProcessLock(${JSON.stringify(file)},"child").acquire();console.log("held");setInterval(()=>{},1000);`;
   const child=spawn(process.execPath,["-e",script],{stdio:["ignore","pipe","inherit"]});
   await new Promise<void>((resolve,reject)=>{child.stdout.once("data",()=>resolve());child.once("error",reject);child.once("exit",c=>reject(new Error(`child exited ${c}`)));});
   expect(()=>new ProcessLock(file,"parent").acquire()).toThrow("already held");
   child.removeAllListeners("exit");
   const exited=new Promise(resolve=>child.once("exit",resolve));
   child.kill("SIGKILL");await exited;
   const after=new ProcessLock(file,"parent");after.acquire();after.release();   // free immediately
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
