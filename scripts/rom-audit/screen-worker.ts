#!/usr/bin/env bun
import { screenJson } from "./screen-identity.js";
/** Isolated job worker and bounded JSONL transport for the experimental screen. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { classifyScreen, type ScreenClassification } from "./screen-classifier.js";
import { loadRoms } from "./census-worker.js";
export interface ScreenJob {sha256: string; hex: string; song: number; seconds: number; repeat: boolean}
export interface ScreenResult {engines: ScreenClassification[]; failure?: string;cpuSeconds?:number}
export class ScreenWorker {
  private readonly child;
  private pending: {resolve:(r:ScreenResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>} | undefined;
  constructor(directory: string, sidlite: string, residfp: string) {
    this.child=spawn(process.execPath,[import.meta.path,directory,sidlite,residfp],{stdio:["pipe","pipe","pipe"]});
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
    if(this.pending)throw new Error("Screen worker already busy");
    return new Promise((resolve,reject)=>{
      this.pending={resolve,reject,timer:setTimeout(()=>{this.fail(new Error("Screen job timeout"));this.close();},Math.max(120000,job.seconds*8000))};
      this.child.stdin.write(screenJson(job)+"\n");
    });
  }
  close(): void {this.child.kill();this.fail(new Error("Screen worker closed"));}
}
if(import.meta.main){
  const [directory,sidlite,residfp]=process.argv.slice(2);
  if(!directory||!sidlite||!residfp)throw new Error("Expected ROM directory and both native binaries");
  const roms=loadRoms(directory);
  for await(const line of createInterface({input:process.stdin})){
    if(!line.trim())continue;
    let result:ScreenResult;
    const usage=process.cpuUsage();
    try{
      const job=JSON.parse(line) as ScreenJob,bytes=Buffer.from(job.hex,"hex");
      if(createHash("sha256").update(bytes).digest("hex")!==job.sha256)throw new Error("Screen job checksum mismatch");
      const engines:ScreenClassification[]=[];
      for(const engine of ["sidlite","residfp"] as const)engines.push(await classifyScreen(engine,engine==="sidlite"?sidlite:residfp,directory,roms,bytes,job.song,job.seconds,job.repeat));
      const elapsedCpu=process.cpuUsage(usage);
      result={engines,cpuSeconds:engines.reduce((n,e)=>n+(e.cpuSeconds??0),0)+(elapsedCpu.user+elapsedCpu.system)/1000000};
    }catch(error){console.error("Screen classification failed",error);result={engines:[],failure:error instanceof Error?error.message:String(error)};}
    process.stdout.write(screenJson(result)+"\n");
  }
}
