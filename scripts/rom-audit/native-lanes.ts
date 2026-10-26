/** Experimental native transport for the unchanged listener-v1 comparator.
 * Each lane is a fresh process of the pinned source build. 256-event engine
 * pulls are coalesced for IPC; PCM and absolute traces retain every sample/event.
 * Native evidence must qualify independently; never label it as WASM output.
 */
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { RomAuditEngine } from "../../packages/sidflow-common/src/rom-eligibility.js";
import type { EngineRun, LaneOutcome, LaneResult, ReferenceResult } from "./methodology.js";
import { BufferedDigest, ListenerComparator } from "./listener.js";
import { SAMPLE_RATE } from "./wasm-lanes.js";
import { trackNativeChild, untrackNativeChild } from "./digital-screen.js";
interface Chunk { pcm: Int16Array; writes: Float64Array }
/** Explicit event queue: Bun's child-stream async iterator can lose a final
 * buffered terminal packet when an early-halting child exits under load. */
export class NativeBytes {
  private readonly queue:Buffer[]=[];
  private queued=0;
  private ended=false;
  private error:Error|undefined;
  private wake:(()=>void)|undefined;
  private received=0;
  private consumed=0;
  constructor(private readonly stream:Readable){
    stream.on("data",(chunk:Buffer)=>{
      const bytes=Buffer.from(chunk);this.queue.push(bytes);this.queued+=bytes.length;this.received+=bytes.length;
      if(this.queued>=262144)stream.pause();this.notify();
    });
    stream.on("end",()=>{this.ended=true;this.notify();});
    stream.on("error",(error:Error)=>{this.error=error;this.ended=true;this.notify();});
  }
  private notify():void{const wake=this.wake;this.wake=undefined;wake?.();}
  async read(count:number):Promise<Buffer>{
    const parts:Buffer[]=[];let size=0;
    while(size<count){
      if(!this.queue.length){
        if(this.ended)throw new Error(`Native stream ended before terminal packet: need ${count-size} bytes; received ${this.received}, consumed ${this.consumed}`,{cause:this.error});
        await new Promise<void>(resolve=>{this.wake=resolve;});continue;
      }
      const chunk=this.queue[0]!,take=Math.min(count-size,chunk.length);
      parts.push(chunk.subarray(0,take));size+=take;this.queued-=take;this.consumed+=take;
      if(take===chunk.length)this.queue.shift();else this.queue[0]=chunk.subarray(take);
      if(this.queued<131072)this.stream.resume();
    }
    return Buffer.concat(parts,size);
  }
}
export class NativeLane {
  readonly pcm = new BufferedDigest(); readonly trace = new BufferedDigest();
  samples = 0; writes = 0; dropped = false; message = "";
  cpuSeconds = 0;
  private ended = false;
  private stderr = "";
  private readonly reader: NativeBytes;
  private constructor(private readonly child: ReturnType<typeof spawn>) {
    trackNativeChild(child);
    if (!child.stdout || !child.stderr) throw new Error("Missing native pipes");
    this.reader = new NativeBytes(child.stdout);
    child.stderr.on("data", (b: Buffer) => { this.stderr = (this.stderr+b.toString()).slice(-4000); });
    child.on("error", (error: Error) => { this.message = error.message; console.error(error); });
    child.stdin?.on("error", (error: Error) => { this.message = error.message; console.error(error); });
  }
  static open(binary: string, directory: string, bytes: Uint8Array, song: number, seconds: number, mask: number): NativeLane {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7 || !Number.isInteger(song) || song < 1 || bytes.length < 0x12) throw new Error("Invalid native lane input");
    const patched = Buffer.from(bytes); patched.writeUInt16BE(song,0x10);
    const lane = new NativeLane(spawn(binary,[directory], {stdio:["pipe","pipe","pipe"], env: {...process.env,
      ROM_AUDIT_SCREEN_MASK:String(mask), ROM_AUDIT_STREAM_AUDIO:"1", ROM_AUDIT_DIGITAL_ONLY:undefined, ROM_AUDIT_BUS_ONLY:undefined, ROM_AUDIT_WARMUP:undefined, ROM_AUDIT_SAMPLE_RATE:String(SAMPLE_RATE), ROM_AUDIT_POWER_ON_DELAY:"8191", ROM_AUDIT_PULL_EVENTS:"256"}}));
    lane.child.stdin!.end(`immutable\t${song}\t${seconds}\thex:${patched.toString("hex")}\n`);
    return lane;
  }
  async pull(): Promise<Chunk | null> {
    try {return await this.readPacket();}catch(error){
      const detail=`Native lane ${this.child.spawnargs.join(" ")} ended (${this.child.exitCode}/${this.child.signalCode}): ${this.stderr || this.message}`;
      console.error(detail,error);throw new Error(detail,{cause:error});
    }
  }
  private async readPacket(): Promise<Chunk | null> {
    if (this.ended) return null;
    const header = await this.reader.read(8), samples = header.readUInt32LE(0), scalars = header.readUInt32LE(4);
    if (samples === 0xffffffff) {
      if (scalars > 65536) throw new Error("Invalid native terminal packet");
      const end = JSON.parse((await this.reader.read(scalars)).toString()) as {error: string; errorKind:string; traceComplete: boolean;cpuSeconds:number};
      if(typeof end.error!=="string"||typeof end.errorKind!=="string"||typeof end.traceComplete!=="boolean"||!Number.isFinite(end.cpuSeconds)||end.cpuSeconds<0)
        throw new Error("Malformed native terminal evidence");
      // A resource/engine error is inadequate evidence, never the tune becoming
      // silent. Only an explicitly diagnosed emulated CPU halt may be padded.
      if(end.error&&(end.errorKind!=="cpu-halt"||!end.error.startsWith("Illegal instruction $")))
        throw new Error(`Native measurement failed (${end.errorKind}): ${end.error}`);
      this.cpuSeconds=end.cpuSeconds;
      this.message = end.error || this.stderr; this.dropped = !end.traceComplete; this.ended = true; return null;
    }
    if (!samples || samples > 100000 || scalars > 8000000 || scalars % 4) throw new Error("Invalid native data packet");
    this.cpuSeconds=(await this.reader.read(8)).readDoubleLE(0);
    const pcm = await this.reader.read(samples*2), traces = await this.reader.read(scalars*8);
    // Buffers may have unaligned offsets; copies also release the input backing store.
    const p = Uint8Array.from(pcm), t = Uint8Array.from(traces);
    return {pcm:new Int16Array(p.buffer),writes:new Float64Array(t.buffer)};
  }
  absorb(chunk: Chunk, take: number): void {
    this.pcm.update(new Uint8Array(chunk.pcm.buffer,0,take*2));
    this.trace.update(new Uint8Array(chunk.writes.buffer,0,chunk.writes.byteLength));
    this.samples += take; this.writes += chunk.writes.length/4;
  }
  close(): void {
    untrackNativeChild(this.child);
    this.child.kill();
    // A paused stdout can retain Bun's child watcher after the child exits.
    // Closing all pipes releases the watcher and permits the child to be reaped.
    this.child.stdin?.destroy();
    this.child.stdout?.destroy();
    this.child.stderr?.destroy();
    this.child.unref();
  }
}
function samePull(a: Chunk,b: Chunk): boolean {
  return a.pcm.length === b.pcm.length && a.writes.length === b.writes.length &&
    a.pcm.every((v,i)=>v === b.pcm[i]) && a.writes.every((v,i)=>v === b.writes[i]);
}
export async function runNativeEngine(engine: RomAuditEngine, bytes: Uint8Array, song: number, seconds: number, directory: string, binary: string, extended = false,sets:readonly ("full"|"none")[]=["full","none"]): Promise<EngineRun & {cpuSeconds:number}> {
  const wanted = Math.round(seconds * SAMPLE_RATE) * 2;
  const reference = NativeLane.open(binary, directory, bytes, song, seconds, 7);
  const lanes: { lane: NativeLane; set: "full" | "none"; comparator: ListenerComparator; stoppedAtSample?: number; stopMessage?: string; result?: LaneResult }[] = [];
  let repeatLane: NativeLane | undefined;
  let repeat: ReferenceResult["repeat"] = extended ? "identical" : "not-run";
  let outcome: ReferenceResult["outcome"] = "clean", message = "";
  try {
    if (extended) repeatLane = NativeLane.open(binary, directory, bytes, song, seconds, 7);
    for (const set of sets) lanes.push({ set, comparator: new ListenerComparator(), lane: NativeLane.open(binary, directory, bytes, song, seconds, set === "full" ? 3 : 0) });
    const complete = (entry: typeof lanes[number], result: LaneOutcome, text = ""): void => {
      const listener = entry.comparator.finish();
      entry.result = { set: entry.set, fill: "zero", outcome: result, samples: entry.lane.samples, writes: entry.lane.writes,
        pcmSha256: entry.lane.pcm.digest(), traceSha256: entry.lane.trace.digest(), firstDifferenceSample: listener.firstDifferenceSample, message: text || entry.stopMessage || "", listener, ...(entry.stoppedAtSample === undefined ? {} : { stoppedAtSample: entry.stoppedAtSample }) };
      if(result==="audible-difference")entry.lane.close();
    };
    while (reference.samples < wanted) {
      const ref = await reference.pull();
      if (!ref || reference.dropped) {
        outcome = reference.dropped ? "trace-dropped" : "failed"; message = reference.message;
        for (const entry of lanes) if (!entry.result) complete(entry, reference.dropped ? "trace-dropped" : "reference-failed", message);
        break;
      }
      const take = Math.min(ref.pcm.length, wanted - reference.samples), target = reference.samples + take;
      if (repeatLane && repeat === "identical") {
        const chunk = await repeatLane.pull();
        if (!chunk || repeatLane.dropped) repeat = "failed";
        else if (!samePull(ref, chunk)) repeat = "different";
      }
      for (const entry of lanes) {
        if (entry.result) continue;
        entry.comparator.append(0, ref.pcm.subarray(0, take), ref.writes);
        while (entry.lane.samples < target) {
          // A decoder that stops contributes silence after its final output.
          // Judge the resulting audio, rather than treating an inaudible ending
          // as a failed song. Preserve where actual engine output ended.
          const chunk = entry.stoppedAtSample === undefined ? await entry.lane.pull()
            : { pcm: new Int16Array(target - entry.lane.samples), writes: new Float64Array() };
          if (entry.lane.dropped) { complete(entry, "trace-dropped", entry.lane.message); break; }
          if (!chunk) {
            entry.stoppedAtSample = entry.lane.samples; entry.stopMessage = entry.lane.message;
            entry.comparator.forceAudio(); continue;
          }
          const count = Math.min(chunk.pcm.length, wanted - entry.lane.samples);
          entry.lane.absorb(chunk, count);
          entry.comparator.append(1, chunk.pcm.subarray(0, count), chunk.writes);
        }
        if (!entry.result && entry.comparator.compare()) complete(entry, "audible-difference");
      }
      reference.absorb(ref, take);
    }
    if(outcome==="clean"){
      if(await reference.pull()||reference.dropped||reference.message){outcome="failed";message=reference.message||"Invalid reference terminal packet";}
      if(repeatLane&&repeat==="identical"&&(await repeatLane.pull()||repeatLane.dropped||repeatLane.message))repeat="failed";
    }
    for (const entry of lanes) if (!entry.result) {
      if(outcome!=="clean"){complete(entry,"reference-failed",message);continue;}
      if(entry.stoppedAtSample===undefined&&(await entry.lane.pull()||entry.lane.dropped||entry.lane.message)){complete(entry,"trace-dropped",entry.lane.message);continue;}
      const evidence = entry.comparator.finish();
      complete(entry, evidence.audible ? "audible-difference" : "equivalent");
    }
    if (outcome !== "clean" && repeatLane) repeat = "failed";
    return { engine, comparison: "listener-v1", extended,cpuSeconds:reference.cpuSeconds+(repeatLane?.cpuSeconds??0)+lanes.reduce((n,e)=>n+e.lane.cpuSeconds,0), reference: { outcome, message, samples: reference.samples, writes: reference.writes,
      pcmSha256: reference.pcm.digest(), traceSha256: reference.trace.digest(), repeat }, lanes: lanes.map(entry => entry.result!) };
  } finally {
    for (const entry of lanes) entry.lane.close();
    repeatLane?.close(); reference.close();
  }
}
