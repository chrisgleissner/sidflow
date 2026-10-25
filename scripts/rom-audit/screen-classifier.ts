/** Experimental independently scoped screen + native-audio classifier. */
import { createHash } from "node:crypto";
import { screenEngine } from "./digital-screen.js";
import { type RomImages } from "./wasm-lanes.js";
import { runNativeEngine } from "./native-lanes.js";
import { assessMask, observationHorizon, type EngineRun } from "./methodology.js";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
export interface ScreenClassification {
  engine: RomAuditEngine;
  states: { none: "compatible" | "incompatible" | "unknown"; full: "compatible" | "incompatible" | "unknown" };
  screen: { none: boolean; full: boolean; referenceTraceSha256: string; referenceError: string; traceComplete: boolean } | null;
  audio?: EngineRun;
  audioBackend?: "native";
  cpuSeconds?:number;
}
export function audioSets(screen:ScreenClassification["screen"],extended:boolean):("full"|"none")[]{
  const proven=screen?.referenceError===""&&screen.traceComplete===true;
  return (["full","none"] as const).filter(set=>extended||!proven||!screen?.[set]);
}
export function audioStates(screen:ScreenClassification["screen"],audio:EngineRun,seconds:number):ScreenClassification["states"]{
  const stable=audio.reference.outcome==="clean"&&audio.reference.samples===Math.round(seconds*48000)*2&&["identical","not-run"].includes(audio.reference.repeat);
  const state=(set:"full"|"none",mask:number)=>{
    if(!audio.lanes.some(l=>l.set===set)&&screen?.[set]&&screen.referenceError===""&&screen.traceComplete===true&&stable)return "compatible" as const;
    return assessMask(audio,observationHorizon("0:01",1),seconds,48000,mask).state;
  };
  return {none:state("none",0),full:state("full",3)};
}
export async function classifyScreen(engine: RomAuditEngine, binary: string, directory: string, roms: RomImages, bytes: Uint8Array, song: number, seconds: number, repeat = false): Promise<ScreenClassification> {
  let screen: ScreenClassification["screen"] = null;
  let cpuSeconds=0;
  try {
    const result = await screenEngine(engine,binary,directory,bytes,song,seconds);
    cpuSeconds=result.cpuSeconds;
    screen = { none:result.none,full:result.full,referenceTraceSha256:createHash("sha256").update(new Uint8Array(Float64Array.from(result.reference.writes).buffer)).digest("hex"),
      referenceError:result.reference.error,traceComplete:result.reference.traceComplete };
  } catch (error) { console.error(`Digital screen ${engine} failed; using audio`,error); }
  if (screen?.none && screen.full && !repeat) return {engine,states:{none:"compatible",full:"compatible"},screen,cpuSeconds};
  // A screen may never declare an audible dependency. The fallback keeps the
  // pinned native engines, original comparator, and independently repeated ref.
  const audio = await runNativeEngine(engine,bytes,song,seconds,directory,binary,repeat,audioSets(screen,repeat));
  const states = audioStates(screen,audio,seconds);
  if (screen?.none && states.none === "incompatible" || screen?.full && states.full === "incompatible") throw new Error(`Digital screen false compatibility: ${engine}`);
  return {engine,states,screen,audio,audioBackend:"native",cpuSeconds:cpuSeconds+audio.cpuSeconds};
}
