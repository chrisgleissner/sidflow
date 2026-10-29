#!/usr/bin/env bun
import { screenJson } from "./screen-identity.js";
/** Separate transport keeps the original worker/measurement identity intact.
 * Uses the same isolated process and job protocol as ScreenWorker. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { classifyScreen, type ScreenClassification } from "./screen-classifier.js";
import { classifySampleScreen } from "./sample-classifier.js";
import { nativeDescendants, sameNativeProcess } from "./native-descendants.js";
import { loadRoms } from "./census-worker.js";
export interface ScreenJob {sha256: string; hex: string; song: number; seconds: number; repeat: boolean}
export interface ScreenResult {engines: ScreenClassification[]; failure?: string;cpuSeconds?:number}
export class SampleScreenWorker {
  private readonly child;
  private closed=false;
  private pending: {resolve:(r:ScreenResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>} | undefined;
  constructor(directory: string, sidlite: string, residfp: string, sample: string, workerScript=import.meta.path) {
    this.child=spawn(process.execPath,[workerScript,directory,sidlite,residfp,sample],{stdio:["pipe","pipe","pipe"]});
    this.child.stderr.on("data",(b:Buffer)=>process.stderr.write(b));
    createInterface({input:this.child.stdout}).on("line",line=>{
      const pending=this.pending;if(!pending)return;
      clearTimeout(pending.timer);this.pending=undefined;
      try{pending.resolve(JSON.parse(line) as ScreenResult);}catch(error){console.error(error);pending.reject(new Error("Invalid screen worker JSON"));}
    });
    this.child.on("error",error=>this.fail(error));
    this.child.stdin.on("error",error=>this.fail(error));
    this.child.on("exit",(code,signal)=>this.fail(new Error(`Screen worker exited (${code}/${signal})`)));
  }
  private fail(error: Error): void {
    if(!this.pending)return;
    clearTimeout(this.pending.timer);const pending=this.pending;this.pending=undefined;pending.reject(error);
  }
  request(job: ScreenJob): Promise<ScreenResult> {
    if(this.closed)throw new Error("Screen worker closed");
    if(this.pending)throw new Error("Screen worker already busy");
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject,timer:setTimeout(()=>{this.fail(new Error("Screen job timeout"));this.close();},Math.max(120000,job.seconds*8000))};
      this.child.stdin.write(screenJson(job)+"\n");
    });
  }
  close(): void {
    if(this.closed)return;
    this.closed=true;
    // The worker can be blocked in spawnSync. Pause it before enumerating its
    // native children so it cannot start another renderer during cancellation.
    // Keep the outer launcher's process group intact as a watchdog fallback.
    try{
      if(this.child.kill("SIGSTOP")&&this.child.pid){
        const pid=this.child.pid;
        for(let attempt=0;attempt<50;attempt++){
          const stat=readFileSync(`/proc/${pid}/stat`,"utf8");
          if(/[TtZ]/.test(stat.slice(stat.lastIndexOf(")")+2,stat.lastIndexOf(")")+3)))break;
          Bun.sleepSync(1);
        }
        for(const child of nativeDescendants(pid)){
          try{if(sameNativeProcess(child))process.kill(child.pid,"SIGKILL");}
          catch(error){console.debug("Sample renderer exited or changed during cancellation",error);}
        }
      }
    }catch(error){console.error("Could not fully discover sample renderers during cancellation",error);}
    finally{
      this.child.kill("SIGKILL");
      this.child.stdin.destroy();this.child.stdout.destroy();this.child.stderr.destroy();
      this.fail(new Error("Screen worker closed"));
    }
  }
}
if(import.meta.main){
  const [directory,sidlite,residfp,sample]=process.argv.slice(2);
  if(!directory||!sidlite||!residfp||!sample)throw new Error("Expected ROM directory and both native audio binaries and sample-clock binary");
  const roms=loadRoms(directory);
  for await(const line of createInterface({input:process.stdin})){
    if(!line.trim())continue;
    let result:ScreenResult;
    const usage=process.cpuUsage();
    try{
      const job=JSON.parse(line) as ScreenJob,bytes=Buffer.from(job.hex,"hex");
      if(createHash("sha256").update(bytes).digest("hex")!==job.sha256)throw new Error("Screen job checksum mismatch");
      const engines:ScreenClassification[]=[];
      engines.push(await classifyScreen("sidlite",sidlite,directory,roms,bytes,job.song,job.seconds,job.repeat));
      engines.push(await classifySampleScreen(sample,residfp,directory,bytes,job.song,job.seconds,job.repeat));
      const elapsedCpu=process.cpuUsage(usage);
      result={engines,cpuSeconds:engines.reduce((n,e)=>n+(e.cpuSeconds??0),0)+(elapsedCpu.user+elapsedCpu.system)/1000000};
    }catch(error){console.error("Screen classification failed",error);result={engines:[],failure:error instanceof Error?error.message:String(error)};}
    process.stdout.write(screenJson(result)+"\n");
  }
}
