import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SampleScreenWorker } from "../../../scripts/rom-audit/sample-worker.js";
import { screenSha } from "../../../scripts/rom-audit/screen-identity.js";

test("closing a worker blocked in sample-clock spawnSync terminates its native renderer",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"sidflow-sample-cancel-"));
  const pidFile=join(directory,"native.pid"),entry=join(directory,"worker.cjs"),sample=join(directory,"sample");
  writeFileSync(sample,`#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);\n`);
  chmodSync(sample,0o755);
  writeFileSync(entry,`process.stdin.once('data',()=>require('node:child_process').spawnSync(${JSON.stringify(sample)},[]));`);
  const worker=new SampleScreenWorker(directory,sample,sample,sample,entry),bytes=Buffer.alloc(0x7c);
  try{
    const result=worker.request({sha256:screenSha(bytes),hex:bytes.toString("hex"),song:1,seconds:10,repeat:false}).then(()=>"resolved",error=>String(error));
    const deadline=Date.now()+10000;
    let nativePid=0;
    while(!nativePid&&Date.now()<deadline){
      if(existsSync(pidFile)){const value=Number(readFileSync(pidFile,"utf8"));if(Number.isSafeInteger(value)&&value>1)nativePid=value;}
      if(!nativePid)await Bun.sleep(10);
    }
    expect(nativePid).toBeGreaterThan(1);
    worker.close();worker.close();
    expect(await result).toContain("Screen worker closed");
    const gone=()=>{
      try{const stat=readFileSync(`/proc/${nativePid}/stat`,"utf8");return stat.slice(stat.lastIndexOf(")")+2).startsWith("Z ");}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;console.debug("Sample renderer exited",error);return true;}
    };
    const stoppedBy=Date.now()+1000;
    while(!gone()&&Date.now()<stoppedBy)await Bun.sleep(10);
    expect(gone()).toBe(true);
  }finally{worker.close();rmSync(directory,{recursive:true,force:true});}
},15000);
