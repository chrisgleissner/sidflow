import { expect, test } from "bun:test";
import { ListenerComparator } from "../../../scripts/rom-audit/listener.js";
import { RegisterClockComparator } from "../../../scripts/rom-audit/register-comparison.js";
const empty = new Float64Array();
function compare(chunks:{frames:number;a:number[];b:number[]}[]) {
  const audio=new ListenerComparator(),clock=new RegisterClockComparator();
  for(const chunk of chunks){
    for(const side of [0,1] as const){
      const writes=Float64Array.from(side?chunk.b:chunk.a);
      const pcm=Int16Array.from({length:chunk.frames*2},(_,i)=>Math.round(10000*Math.sin(i/17)));
      audio.append(side,pcm,writes);clock.append(side,chunk.frames,writes);
    }
    audio.compare();clock.compare();
  }
  const actual=audio.finish().method,measured=clock.finish().method;
  expect(measured).toBe(actual==="register-equivalent"?"register-equivalent":"needs-audio");
  return measured;
}
test("measured counts preserve register verdicts through fractional final windows",()=>{
  expect(compare([{frames:4096,a:[0,24,15,1000],b:[0,24,15,1011]},{frames:373,a:[0,0,80,50000],b:[0,0,80,50011]}])).toBe("register-equivalent");
  expect(compare([{frames:4096,a:[0,24,15,1000],b:[0,24,15,1011]},{frames:373,a:[0,0,80,50000],b:[]}])).toBe("needs-audio");
});
test("counts retain digi and stalled-write safeguards",()=>{
  const dense=Array.from({length:12},(_,i)=>[0,24,i%16,1000+i*400]).flat();
  expect(compare([{frames:10000,a:dense,b:dense}])).toBe("needs-audio");
  const chunks=Array.from({length:15},(_,i)=>({frames:1024,a:i===0?[0,0,80,1000]:[],b:i===14?[0,0,80,1011]:[]}));
  expect(compare(chunks)).toBe("needs-audio");
});
test("many varied packet boundaries agree with the PCM register path",()=>{
  for(let seed=1;seed<=40;seed++){
    const chunks=Array.from({length:20},(_,i)=>{
      const a=[0,i%24,(seed+i)%256,10000+i*10000];
      const b=[0,i%24,(seed+i+(seed%5===0&&i===17?1:0))%256,10011+i*10000];
      return {frames:1+(seed*31+i*137)%4096,a,b};
    });
    compare(chunks);
  }
});
test("partial, unequal or malformed observations cannot certify a complete window",()=>{
  const clock=new RegisterClockComparator();clock.append(0,100,empty);clock.compare();
  expect(clock.finish().method).toBe("needs-audio");
  for(const frames of [-1,0.5,NaN,Infinity])expect(()=>clock.append(0,frames,empty)).toThrow();
});
