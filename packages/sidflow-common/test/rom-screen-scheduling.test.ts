import { expect, test } from "bun:test";
import { orderScreenJobs } from "../../../scripts/rom-audit/screen-scheduling.js";
const job=(sha256:string,seconds:number,kind="PSID")=>({sha256,seconds,kind,song:1,path:sha256});
test("dispatches expensive jobs first without changing a caller's bounded selection",()=>{
  const short=job("a",10),long=job("b",100),outside=job("c",200),selected=[short,long];
  const sorted=orderScreenJobs(selected);
  expect(sorted).toEqual([long,short]);expect(selected).toEqual([short,long]);expect(sorted).not.toContain(outside);
});
test("uses observed CPU cost, with per-stratum estimates for unmeasured jobs",()=>{
  const a=job("a",10),b=job("b",20,"BASIC"),c=job("c",25,"BASIC");
  expect(orderScreenJobs([a,b,c],[{job:a,cpuSeconds:5},{job:b,cpuSeconds:100}])).toEqual([c,b,a]);
});
test("preserves stable ties and rejects malformed observed costs",()=>{
  const a=job("a",10),b=job("b",10);
  expect(orderScreenJobs([a,b])).toEqual([a,b]);
  for(const cpuSeconds of [0,-1,NaN,Infinity])expect(()=>orderScreenJobs([a],[{job:a,cpuSeconds}])).toThrow("Invalid scheduling cost");
});
