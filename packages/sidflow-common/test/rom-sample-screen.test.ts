import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleClockScreen, sampleClockTimeout } from "../../../scripts/rom-audit/sample-screen.js";
const directory=mkdtempSync(join(tmpdir(),"sidflow-sample-protocol-"));
afterAll(()=>rmSync(directory,{recursive:true,force:true}));
let next=0;
test("fractional song lengths produce valid integer process timeouts",()=>{
  expect(sampleClockTimeout(260.523)).toBe(521047);
  expect(sampleClockTimeout(10)).toBe(120000);
  expect(sampleClockTimeout(3600)).toBe(7200000);
  for(const seconds of [NaN,Infinity,-1,0,3600.001])expect(()=>sampleClockTimeout(seconds)).toThrow();
});
const terminal={sampleClockComplete:true,error:"",traceComplete:true,chargenReads:0,cpuSeconds:0.01,writes:[]};
function run(reference:unknown[],variant=reference){
  const file=join(directory,`native-${next++}`);
  writeFileSync(file,`#!/usr/bin/env node\nconst records=process.env.ROM_AUDIT_SCREEN_MASK==='0'?${JSON.stringify(variant)}:${JSON.stringify(reference)};process.stdout.write(records.map(JSON.stringify).join('\\n')+'\\n');\n`);
  chmodSync(file,0o755);
  return ()=>sampleClockScreen(file,directory,Buffer.alloc(0x7c),1,0.01);
}
test("complete count-only silence and equal sparse writes may grant",()=>{
  expect(run([{sampleClockFrames:480,writes:[]},terminal])().screen).toEqual({none:true,full:true});
  expect(run([{sampleClockFrames:480,writes:[0,0,80,1000]},terminal])().screen.none).toBe(true);
});
test("incomplete frames, malformed packets and unflushed writes cannot grant",()=>{
  for(const records of [
    [{sampleClockFrames:479,writes:[]},terminal],
    [{sampleClockFrames:480,writes:[0,0,80]},terminal],
    [{sampleClockFrames:480,writes:[]},{...terminal,writes:[0,0,80,1000]}],
    [{sampleClockFrames:480,writes:[]},{...terminal,cpuSeconds:-1}],
    [{sampleClockFrames:480,writes:[]},{...terminal,chargenReads:-1}],
  ])expect(run(records)).toThrow();
});
test("reference errors and dropped traces cannot grant either configuration",()=>{
  for(const changes of [{error:"CPU halted"},{traceComplete:false}])
    expect(run([{sampleClockFrames:480,writes:[]},{...terminal,...changes}])().screen).toEqual({none:false,full:false});
});
test("a changed or missing final write requires audio",()=>{
  const reference=[{sampleClockFrames:480,writes:[0,0,80,1000]},terminal];
  for(const writes of [[],[0,0,81,1000]])expect(run(reference,[{sampleClockFrames:480,writes},terminal])().screen.none).toBe(false);
});
test("even identical short digi bursts require audio",()=>{
  const writes=[0,24,1,1000,0,24,2,1400,0,24,3,1800];
  expect(run([{sampleClockFrames:480,writes},terminal])().screen.none).toBe(false);
});
