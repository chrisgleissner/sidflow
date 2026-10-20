import { describe, expect, it } from "bun:test";
import { csv, evidence, executionChanged, material, parseStil, percent, stilFor,
  type Execution, type Measurement } from "../../../scripts/rom-audit/analysis.js";
import { checkSidHeader } from "../src/sid-header-conformance.js";
import { staticCandidates } from "../../../scripts/rom-audit/static-triage.js";
import { validateRows, type Header } from "../../../scripts/rom-audit/publish.js";

function measurement(overrides: Partial<Measurement> = {}): Measurement {
  return {error:"",samples:32000,hash:"example",acRms:0.1,equal:true,differingSamples:0,
    peakDifference:0,differenceRms:0,firstDifferenceSec:null,sidWrites:1000,
    matchingWritePrefix:1000,startupOffsetCycles:0,maxRelativeWriteDriftCycles:0,...overrides};
}
function row(overrides:Partial<Execution> = {}):Execution {
  return {path:"tune.sid",song:1,seconds:2,both:measurement(),repeat:measurement(),
    neither:measurement(),kernal:measurement(),basic:measurement(),...overrides};
}
const changed = ():Measurement => measurement({equal:false,matchingWritePrefix:48,differenceRms:0.1});
describe("ROM audit evidence boundaries",()=>{
  it("does not equate an oscillator-phase PCM difference with changed SID writes",()=>{
    expect(evidence(row({basic:measurement({equal:false,differenceRms:0.15,startupOffsetCycles:500})})))
      .toBe("pcm-difference-with-similar-write-sequence");
  });
  it("attributes missing KERNAL to the BASIC-only experiment",()=>{
    expect(evidence(row({basic:changed(),neither:changed()}))).toBe("kernal-sensitive");
  });
  it("attributes missing BASIC to the KERNAL-only experiment",()=>{
    expect(evidence(row({kernal:changed(),neither:changed()}))).toBe("basic-sensitive");
  });
  it("distinguishes individual dependencies from combined-removal interaction",()=>{
    expect(evidence(row({basic:changed(),kernal:changed()}))).toBe("both-sensitive");
    expect(evidence(row({neither:changed()}))).toBe("combined-removal-sensitive");
  });
  it("does not count quiet or failed references as ROM-independent",()=>{
    expect(evidence(row({both:measurement({acRms:0.00001})}))).toBe("quiet-reference");
    expect(evidence(row({both:measurement({error:"CPU halt"})}))).toBe("reference-error");
    expect(evidence(row({both:measurement({samples:31998})}))).toBe("reference-error");
  });
  it("requires an identical repeated reference before attribution",()=>{
    expect(evidence(row({repeat:measurement({equal:false})}))).toBe("unstable-reference");
    expect(evidence(row({repeat:measurement({matchingWritePrefix:999})}))).toBe("unstable-reference");
  });
  it("keeps startup clicks and a single initialization write inconclusive",()=>{
    expect(evidence(row({both:measurement({sidWrites:1,matchingWritePrefix:1}),
      repeat:measurement({sidWrites:1,matchingWritePrefix:1})}))).toBe("insufficient-reference-activity");
  });
  it("detects stopped sequences, timing drift and emulation errors",()=>{
    const ref=measurement();
    expect(executionChanged(measurement({sidWrites:40,matchingWritePrefix:40}),ref)).toBe(true);
    expect(executionChanged(measurement({maxRelativeWriteDriftCycles:5001}),ref)).toBe(true);
    expect(executionChanged(measurement({error:"halt"}),ref)).toBe(true);
    expect(executionChanged(measurement({sidWrites:985,matchingWritePrefix:985}),ref)).toBe(false);
    expect(material(measurement({differenceRms:0.02}),ref)).toBe(true);
    expect(material(measurement({differenceRms:0.0001}),ref)).toBe(false);
    expect(evidence(row())).toBe("identical-in-window");
  });
  it("preserves STIL subtune notes and distinguishes composers from cover artists",()=>{
    const entries=parseStil("/MUSICIANS/A/\r\nCOMMENT: Directory note\r\n\r\n/MUSICIANS/A/Song.sid\r\n(#1)\r\n ARTIST: Cover artist\r\n\r\n(#2)\r\nCOMMENT: Competition winner\r\n\r\n/MUSICIANS/A/Next.sid\r\nCOMMENT: Other song\r\n");
    const text=stilFor("MUSICIANS/A/Song.sid",entries);
    expect(text).toContain("Directory note"); expect(text).toContain("(#2)");
    expect(text).toContain("Cover artist");expect(text).not.toContain("Other song");
    expect(stilFor("GAMES/Missing.sid",entries)).toContain("No STIL entry");
    expect(()=>parseStil("/a.sid\nCOMMENT: A\n/a.sid\nCOMMENT: B")).toThrow("Duplicate");
  });
  it("escapes CSV metadata and uses explicit subtune denominators",()=>{
    expect(csv('Title, "test"')).toBe('"Title, ""test"""');
    expect(csv("two\nlines")).toBe('"two\nlines"');expect(csv(null)).toBe("");
    expect(percent(1390,87868)).toBe("1.5819%");expect(percent(0,0)).toBe("n/a");
  });
  it("does not mistake the PSID PlaySID-specific flag for the RSID BASIC flag",()=>{
    function sid(magic:string):Buffer {
      const bytes=Buffer.alloc(0x7c+34);bytes.write(magic);bytes.writeUInt16BE(2,4);
      bytes.writeUInt16BE(0x7c,6);bytes.writeUInt16BE(1,0x0e);bytes.writeUInt16BE(1,0x10);
      bytes.writeUInt16BE(2,0x76);bytes[0x7d]=0x10;return bytes;
    }
    const basic=checkSidHeader(sid("RSID")).fields!;
    const psid=checkSidHeader(sid("PSID")).fields!;
    expect(basic.magic==="RSID" && !!(basic.flags!&2)).toBe(true);
    expect(psid.magic==="RSID" && !!(psid.flags!&2)).toBe(false);
  });
  it("treats static ROM-range patterns and indirect operands only as candidates, including data",()=>{
    const bytes=Buffer.alloc(0x7c+12);bytes.write("PSID");bytes.writeUInt16BE(0x7c,6);
    bytes.writeUInt16BE(0x1000,8);
    Buffer.from([0x20,0xd2,0xff,0xad,0x00,0xa0,0xae,0x00,0xd0,0xb1,0x20,0x60]).copy(bytes,0x7c);
    expect(staticCandidates(bytes).filter(c=>c.offset===0x7c)[0]?.region).toBe("KERNAL range");
    expect(staticCandidates(bytes).some(c=>c.region==="BASIC range")).toBe(true);
    expect(staticCandidates(bytes).some(c=>c.region==="CHARGEN / I/O range")).toBe(true);
    expect(staticCandidates(bytes).some(c=>c.region==="unresolved indirect target")).toBe(true);
    expect(()=>staticCandidates(new Uint8Array(4))).toThrow("Not a SID");
  });
  it("requires unique complete subtune coverage and adaptive durations before publication",()=>{
    const h={path:"tune.sid",songs:1,basicFlag:false} as Header;
    expect(()=>validateRows([h],[row()],".",2,true)).not.toThrow();
    expect(()=>validateRows([h],[],".",2,true)).toThrow("Incomplete census");
    expect(()=>validateRows([h],[row(),row()],".",2,true)).toThrow("duplicate");
    expect(()=>validateRows([{...h,basicFlag:true}],[row()],".",2,true)).toThrow("Undersized");
    expect(()=>validateRows([h],[row({basic:changed()})],".",2,true)).toThrow("Undersized");
    expect(()=>validateRows([h],[row({song:2})],".",2,true)).toThrow("Unknown");
  });
  it("requires BASIC zero-read equivalence independently in each KERNAL state",()=>{
    const h={path:"tune.sid",songs:1,basicFlag:false} as Header;
    const base=measurement({basicReads:0,derivedFrom:""});
    const r=row({both:base,basic:base,kernal:{...base,derivedFrom:"both: zero mapped BASIC reads"},
      neither:{...base,derivedFrom:"basic: zero mapped BASIC reads"}});
    expect(()=>validateRows([h],[r],".",2,true)).not.toThrow();
    expect(()=>validateRows([h],[{...r,basic:{...base,basicReads:1}}],".",2,true)).toThrow("Invalid derivation");
    expect(()=>validateRows([h],[{...r,neither:{...r.neither,hash:"different"}}],".",2,true)).toThrow("Derived measurement differs");
  });
});
