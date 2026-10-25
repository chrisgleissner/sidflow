/** Native digital screening. A positive screen means only that the existing
 * listener-v1 register fast path applies; anything else needs audio rendering.
 * Both engines are run independently. No cross-engine transfer is inferred.
 */
import { spawn } from "node:child_process";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import { ListenerComparator } from "./listener.js";
const activeScreens=new Set<ReturnType<typeof spawn>>();
let cleanupInstalled=false;
export function trackNativeChild(child:ReturnType<typeof spawn>):void {
  if(!cleanupInstalled){cleanupInstalled=true;process.once("SIGTERM",()=>{for(const child of activeScreens)child.kill("SIGKILL");process.exit(143);});}
  activeScreens.add(child);
}
export function untrackNativeChild(child:ReturnType<typeof spawn>):void {activeScreens.delete(child);}
export interface DigitalScreen { error: string; traceComplete: boolean; chargenReads: number; writes: number[]; cpuSeconds?:number; busOnly?:boolean;warmup?:boolean }
export async function screenLane(binary: string, roms: string, bytes: Uint8Array, song: number, seconds: number, mask: number, busOnly=false,warmup=false): Promise<DigitalScreen> {
  if (![0,3,7].includes(mask) || !Number.isInteger(song) || song < 1 || song > 256 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 3600 || bytes.length < 0x12) throw new Error("Invalid screen input");
  const patched = Buffer.from(bytes); patched.writeUInt16BE(song,0x10);
  const child = spawn(binary,[roms],{stdio:["pipe","pipe","pipe"],env:{...process.env,
    ROM_AUDIT_DIGITAL_ONLY:"1",ROM_AUDIT_BUS_ONLY:busOnly?"1":undefined,ROM_AUDIT_WARMUP:warmup?"1":undefined,ROM_AUDIT_SCREEN_MASK:String(mask),ROM_AUDIT_SAMPLE_RATE:"48000",ROM_AUDIT_POWER_ON_DELAY:"8191",ROM_AUDIT_PULL_EVENTS:"256"}});
  trackNativeChild(child);
  const parts: Buffer[] = []; let size = 0, stderr = "";
  const timeout = setTimeout(()=>child.kill("SIGKILL"),Math.max(60000,seconds*2000));
  try {
    return await new Promise<DigitalScreen>((resolve,reject)=>{
      child.on("error",reject);
      child.stdin.on("error",reject);
      child.stdout.on("data",(chunk: Buffer)=>{
        size += chunk.length;
        if (size > 256*1024*1024) { child.kill(); reject(new Error("Digital screen output bound exceeded")); }
        else parts.push(chunk);
      });
      child.stderr.on("data",(chunk: Buffer)=>{stderr=(stderr+chunk.toString()).slice(-4000);});
      child.on("close",(code,signal)=>{
        if (code !== 0) { reject(new Error(`Digital screen failed (${code}/${signal}): ${stderr}`)); return; }
        try {
          const result = JSON.parse(Buffer.concat(parts).toString()) as DigitalScreen;
          if (typeof result.error !== "string" || typeof result.traceComplete !== "boolean" || !Number.isSafeInteger(result.chargenReads) || result.chargenReads < 0 ||
            !Array.isArray(result.writes) || result.writes.length%4 || result.writes.some(v=>!Number.isSafeInteger(v)||v<0)) throw new Error("Malformed digital screen evidence");
          resolve({...result,busOnly,warmup});
        } catch (error) { console.error("Invalid digital screen output",error); reject(error); }
      });
      child.stdin.end(`immutable\t${song}\t${seconds}\thex:${patched.toString("hex")}\n`);
    });
  } finally { clearTimeout(timeout); activeScreens.delete(child); child.kill(); }
}
export function screenEquivalent(reference: DigitalScreen, variant: DigitalScreen): boolean {
  if (reference.error || variant.error || !reference.traceComplete || !variant.traceComplete) return false;
  // Entire streams, including their tails, are submitted together. The comparator
  // checks offset, drift, lengths and digi density. Spectral fallback has no PCM
  // here and MUST NOT grant a decision.
  const comparator = new ListenerComparator(), empty = new Int16Array();
  comparator.append(0,empty,Float64Array.from(reference.writes));
  comparator.append(1,empty,Float64Array.from(variant.writes));
  comparator.compare();
  return comparator.finish().method === "register-equivalent";
}
export async function screenEngine(engine: RomAuditEngine, binary: string, roms: string, bytes: Uint8Array, song: number, seconds: number) {
  let cpuSeconds=0;
  const run=async(mask:number):Promise<DigitalScreen>=>{
    let result=await screenLane(binary,roms,bytes,song,seconds,mask,true);cpuSeconds+=result.cpuSeconds??0;
    if(result.error==="stateful SID read requires detailed screen"){
      result=await screenLane(binary,roms,bytes,song,seconds,mask,false,true);cpuSeconds+=result.cpuSeconds??0;
    }
    if(result.error==="stateful SID read requires detailed screen"){
      result=await screenLane(binary,roms,bytes,song,seconds,mask,false);cpuSeconds+=result.cpuSeconds??0;
    }
    return result;
  };
  const reference = await run(7);
  if (reference.error || !reference.traceComplete) return {engine,reference,none:false,full:false,cpuSeconds};
  const none = await run(0);
  // An untouched, never-read CHARGEN bank cannot affect CPU execution. This
  // implication is within one engine/window, including reads during init.
  const full = reference.chargenReads === 0 || screenEquivalent(reference,await run(3));
  return {engine,reference,none:screenEquivalent(reference,none),full,cpuSeconds};
}
