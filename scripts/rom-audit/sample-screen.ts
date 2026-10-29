/** Experimental sample-clock measurement. No PCM or eligibility publication. */
import { spawnSync } from "node:child_process";
import { RegisterClockComparator } from "./register-comparison.js";
export interface Packet { sampleClockFrames:number;writes:number[] }
export interface Terminal { sampleClockComplete:boolean;error:string;traceComplete:boolean;chargenReads:number;cpuSeconds:number;writes:number[] }
export function sampleClockTimeout(seconds:number):number {
  if(!Number.isFinite(seconds)||seconds<=0||seconds>3600)throw new Error("Invalid sample clock horizon");
  return Math.max(120000,Math.ceil(seconds*2000));
}
function equivalent(a:Packet[],b:Packet[]):boolean{
  const comparator=new RegisterClockComparator();let referenceFrames=0,variantFrames=0,index=0;
  for(const packet of a){
    referenceFrames+=packet.sampleClockFrames;comparator.append(0,packet.sampleClockFrames,Float64Array.from(packet.writes));
    while(variantFrames<referenceFrames&&index<b.length){const variant=b[index++]!;variantFrames+=variant.sampleClockFrames;comparator.append(1,variant.sampleClockFrames,Float64Array.from(variant.writes));}
    comparator.compare();
  }
  return index===b.length&&comparator.finish().method==="register-equivalent";
}
export function sampleClockScreen(binary:string,roms:string,input:Uint8Array,song:number,seconds:number) {
  const bytes=Buffer.from(input);bytes.writeUInt16BE(song,0x10);
  let screenCpuSeconds=0;
  function lane(mask:number):{packets:Packet[];terminal:Terminal}{
    for(const busOnly of [true,false]){
      const run=spawnSync(binary,[roms],{input:`immutable\t${song}\t${seconds}\thex:${bytes.toString("hex")}\n`,encoding:"utf8",timeout:sampleClockTimeout(seconds),maxBuffer:256*1024*1024,env:{...process.env,ROM_AUDIT_DIGITAL_ONLY:"1",ROM_AUDIT_SCREEN_MASK:String(mask),ROM_AUDIT_SAMPLE_RATE:"48000",ROM_AUDIT_POWER_ON_DELAY:"8191",ROM_AUDIT_PULL_EVENTS:"256",ROM_AUDIT_BUS_ONLY:busOnly?"1":undefined,ROM_AUDIT_WARMUP:undefined,ROM_AUDIT_STREAM_AUDIO:undefined}});
      if(run.status!==0)throw new Error(`Sample clock failed: ${run.error?.message??run.stderr}`);
      const records=run.stdout.trim().split("\n").map(line=>JSON.parse(line) as Packet|Terminal),terminal=records.pop() as Terminal;
      if(terminal.sampleClockComplete!==true||!Number.isFinite(terminal.cpuSeconds)||terminal.cpuSeconds<0||typeof terminal.error!=="string"||typeof terminal.traceComplete!=="boolean"||!Number.isSafeInteger(terminal.chargenReads)||terminal.chargenReads<0)throw new Error("Malformed sample clock terminal");
      if(!terminal.error&&(!Array.isArray(terminal.writes)||terminal.writes.length))throw new Error("Unflushed sample clock writes");
      screenCpuSeconds+=terminal.cpuSeconds;
      if(busOnly&&terminal.error==="stateful SID read requires detailed screen")continue;
      const packets=records as Packet[];
      if(packets.some(p=>!Number.isSafeInteger(p.sampleClockFrames)||p.sampleClockFrames<=0||p.sampleClockFrames>50000||!Array.isArray(p.writes)||p.writes.length%4||p.writes.some(v=>!Number.isSafeInteger(v)||v<0)))throw new Error("Malformed sample clock packet");
      if(!terminal.error&&packets.reduce((n,p)=>n+p.sampleClockFrames,0)!==Math.round(seconds*48000))throw new Error("Truncated sample clock observation");
      return {packets,terminal};
    }
    throw new Error("No detailed execution");
  }
  const reference=lane(7),none=lane(0),full=reference.terminal.chargenReads===0?reference:lane(3);
  const valid=(l:typeof reference)=>!l.terminal.error&&l.terminal.traceComplete;
  const screen={none:valid(reference)&&valid(none)&&equivalent(reference.packets,none.packets),full:valid(reference)&&(reference.terminal.chargenReads===0||valid(full)&&equivalent(reference.packets,full.packets))};
  return {screen,screenCpuSeconds,reference,none,full};
}
