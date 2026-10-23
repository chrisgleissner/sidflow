/** Versioned evidence policy. Historical analysis.ts thresholds remain diagnostic. */
import type { Measurement } from "./analysis.js";
import { stringifyDeterministic,type JsonValue } from "../../packages/sidflow-common/src/json.js";
import type { Execution } from "./analysis.js";
export const METHODOLOGY = "rom-audit-3";
/** The machine whose behaviour a published `compatible` bit describes. It is the
 * profile of C64 Commander's local SID player (48 kHz stereo; read from its
 * source, which is not modified) plus the one setting the consumer must pin for
 * the result to be reproducible: a fixed power-on delay. Consumers verify their
 * actual configuration against this object through the lookup. Allow evidence is
 * produced on exactly this profile by the WASM engine that ships (confirm.ts).
 */
export { ROM_CONSUMER_PROFILE as CONSUMER_PROFILE } from "../../packages/sidflow-common/src/rom-eligibility.js";
/** Native screening protocol. It nominates candidates and denies; it never grants. */
export const AUDIT_PROTOCOL={rate:8000,stereo:true,digiBoost:true,samplingMethod:"RESAMPLE_INTERPOLATE",
 boundedPlaybackRequired:true,inputTransport:"checksum-verified-immutable-hex",powerOnDelay:5000,chunkCycles:256,engine:"SIDLite",
 otherDefaultsFromPinnedSource:true,missingBasic:"8192 zero bytes",missingKernal:"libsidplayfp minimal interrupt shim",
 chargen:"explicit zero bank when absent",romMask:{kernal:1,basic:2,chargen:4},
 adaptive:"every subtune receives songlength+5s (unknown:300s); no short equality exits",maxTraceWrites:2000000} as const;
export const ROM_MASKS = [0,1,2,3,4,5,6,7] as const;
export type Compatibility = "compatible" | "incompatible" | "unknown";
export interface Horizon {
  token: string | null;
  seconds: number;
  documentedSeconds: number | null;
  source: "Songlengths.md5";
  limitation: string;
}
/** Do not use parseSonglengthValue here: it drops invalid tokens and shifts subtunes. */
export function observationHorizon(token: string | undefined, minimum = 10): Horizon {
  if(!Number.isFinite(minimum)||minimum<=0)throw new Error("Invalid minimum observation duration");
  const match = token?.match(/^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/);
  // Keep the metadata's millisecond precision until the final division. Adding
  // fractional seconds twice produces 66.38499999999999 for 1:01.385 + 5s,
  // which the native JSON protocol prints as 66.385 and then refuses on resume.
  const parsedMs = match ? (Number(match[1])*60 + Number(match[2]))*1000 +
    Number((match[3] ?? "0").padEnd(3,"0")) : 0;
  const durationMs=Number.isSafeInteger(parsedMs)&&parsedMs>0?parsedMs:0;
  const minimumMs = Math.ceil(minimum*1000);
  if(!Number.isSafeInteger(minimumMs)||minimumMs>3600000)throw new Error("Unsupported minimum observation duration");
  return {token: token ?? null, seconds: Math.max(minimumMs,durationMs > 0 ? durationMs+5000 : 300000)/1000,
    documentedSeconds: durationMs > 0 ? durationMs/1000 : null, source:"Songlengths.md5",
    limitation: durationMs > 0 ? "Documented duration plus 5s ending margin; loop recurrence and interactivity unproven"
      : "Unknown/invalid duration: 300s fallback is exploratory; coverage unresolved"};
}
export interface Assessment { state: Compatibility; reason: string }
export function exactWrites(m: Measurement, ref: Measurement): boolean {
  return m.traceComplete === true && ref.traceComplete === true && m.sidWrites === ref.sidWrites &&
    m.matchingWritePrefix === ref.sidWrites && m.startupOffsetCycles === 0 && m.maxRelativeWriteDriftCycles === 0 &&
    m.firstWriteDivergence === null;
}
/** Outcome of re-running a native candidate on the shipping engine under CONSUMER_PROFILE. */
export type Confirmation = boolean | "mismatch" | undefined;
/**
 * Native screening. `compatible` and `incompatible` here are only CANDIDATES;
 * assess() grants them solely when the shipping engine reproduced them.
 * Only a CPU halt is evidence about the tune: allocation or engine anomalies are
 * infrastructure and must never become `incompatible`.
 */
export function screen(m: Measurement | undefined, ref: Measurement | undefined, repeat: Measurement | undefined,
  observed: number, horizon: Horizon): Assessment {
  const unknown = (reason: string):Assessment => ({state:"unknown",reason});
  if (!m || !ref || !repeat) return unknown("experiment-pending");
  const canonical=observationHorizon(typeof horizon?.token==="string"?horizon.token:undefined,0.001);
  if (!horizon || !Number.isFinite(horizon.seconds) || horizon.seconds<=0 || horizon.seconds>3600 ||
      !Number.isFinite(observed) || observed<=0 || horizon.documentedSeconds!==canonical.documentedSeconds ||
      horizon.source!=="Songlengths.md5" || horizon.seconds<canonical.seconds ||
      Math.round(horizon.seconds*1000)/1000!==horizon.seconds) return unknown("invalid-observation-horizon");
  for(const value of [m,ref,repeat]) {
    if(typeof value.error!=="string"||typeof value.equal!=="boolean"||
      [value.samples,value.sidWrites,value.matchingWritePrefix].some(n=>!Number.isSafeInteger(n)||n<0)||
      [value.acRms,value.differenceRms,value.startupOffsetCycles,value.maxRelativeWriteDriftCycles].some(n=>!Number.isFinite(n)))
      return unknown("invalid-measurement");
  }
  if (ref.error || !ref.equal || !exactWrites(ref,ref) || repeat.error || repeat.samples!==ref.samples || ref.samples !== Math.round(observed*8000)*2 || !repeat.equal || !exactWrites(repeat,ref))
    return unknown("reference-failed-or-unstable");
  if (m.error) return m.errorKind==="cpu-halt" ? {state:"incompatible",reason:"cpu-halt-without-rom"} : unknown("non-tune-error");
  if (m.samples !== ref.samples) return unknown("invalid-evidence-length");
  if (horizon.documentedSeconds === null || observed < horizon.seconds) return unknown("observation-horizon-incomplete");
  if (!exactWrites(m,ref)) return unknown("timed-sid-write-divergence");
  if (!m.equal) return unknown("pcm-divergence-without-established-musical-failure");
  return {state:"compatible",reason:"exact-output-through-documented-horizon"};
}
export function assess(m: Measurement | undefined, ref: Measurement | undefined, repeat: Measurement | undefined,
  observed: number, horizon: Horizon, confirmation: Confirmation): Assessment {
  const candidate=screen(m,ref,repeat,observed,horizon);
  if (candidate.state==="unknown") return candidate;
  if (confirmation==="mismatch") return {state:"unknown",reason:"shipping-engine-disagrees-with-native-screen"};
  if (confirmation!==true) return {state:"unknown",reason:"shipping-engine-confirmation-pending"};
  return {state:candidate.state,reason:candidate.state==="compatible"?"exact-output-on-shipping-engine-through-documented-horizon":"cpu-halt-confirmed-on-shipping-engine"};
}
/** Reject corrupt protocol/checkpoint structures, rather than interpreting them
 * as scientific evidence. Legitimate reference failures remain valid records.
 */
export function validateMatrix(row:Execution):void{
 if(!Number.isFinite(row.seconds)||row.seconds<=0||row.seconds>3600||!row.matrix||row.matrix.length!==8)throw new Error("Invalid matrix duration/shape");
 const reference=row.both;
 for(const m of [reference,row.repeat,...row.matrix]){
  if(!m||typeof m.error!=="string"||typeof m.equal!=="boolean"||typeof m.traceComplete!=="boolean"||
    typeof m.hash!=="string"||!/^[a-f0-9]{1,16}$/.test(m.hash)||typeof m.traceHash!=="string"||!/^[a-f0-9]{1,16}$/.test(m.traceHash)||
    [m.samples,m.sidWrites,m.matchingWritePrefix,m.differingSamples,m.peakDifference,m.maxRelativeWriteDriftCycles,
     m.kernalReads,m.basicReads,m.chargenReads,m.sidReadbackReads].some(n=>typeof n!=="number"||!Number.isSafeInteger(n)||n<0)||
    !Number.isSafeInteger(m.startupOffsetCycles)||[m.acRms,m.differenceRms].some(n=>!Number.isFinite(n)||n<0)||
    m.matchingWritePrefix>Math.min(m.sidWrites,reference.sidWrites)||m.differingSamples>Math.min(m.samples,reference.samples)||
    (!m.error&&m.samples!==Math.round(row.seconds*8000)*2))throw new Error("Invalid matrix measurement");
  if(!["","cpu-halt","engine","resource"].includes(m.errorKind as string)||(m.error==="")!==(m.errorKind===""))throw new Error("Invalid error classification");
  if(m.equal&&(m.error||reference.error||m.samples!==reference.samples||m.hash!==reference.hash||m.acRms!==reference.acRms||
      m.differingSamples!==0||m.peakDifference!==0||m.differenceRms!==0||m.firstDifferenceSec!==null))throw new Error("Contradictory PCM equality evidence");
  if(m.firstDifferenceSec!==null&&(!Number.isFinite(m.firstDifferenceSec)||m.firstDifferenceSec!<0||m.firstDifferenceSec!>row.seconds))
    throw new Error("Invalid first PCM divergence");
  const first=m.firstWriteDivergence;
  if(first===null&&(m.sidWrites!==reference.sidWrites||m.matchingWritePrefix!==reference.sidWrites||m.startupOffsetCycles!==0||m.maxRelativeWriteDriftCycles!==0||m.traceHash!==reference.traceHash))throw new Error("Contradictory timed-write equality evidence");
  if(first!==null){
   const event=(v:unknown):boolean=>v===null||(Array.isArray(v)&&v.length===4&&v.every(n=>Number.isSafeInteger(n)&&n>=0)&&v[1]<=31&&v[2]<=255);
   if(!first||!Number.isSafeInteger(first.index)||first.index<0||first.index>Math.min(m.sidWrites,reference.sidWrites)||
     !event(first.actual)||!event(first.reference)||(first.actual===null&&first.reference===null))throw new Error("Invalid timed divergence evidence");
  }
 }
 const same=(a:Measurement,b:Measurement):boolean=>stringifyDeterministic(a as unknown as JsonValue,0)===stringifyDeterministic(b as unknown as JsonValue,0);
 if(!same(row.matrix[7]!,row.both)||!same(row.matrix[4]!,row.neither)||!same(row.matrix[5]!,row.kernal)||!same(row.matrix[6]!,row.basic))
  throw new Error("Matrix/reference/legacy alias mismatch");
}
