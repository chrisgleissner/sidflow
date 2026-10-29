import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifySampleProof } from "../../../scripts/rom-audit/sample-proof.js";
test("incomplete or forged proof metadata cannot authorize the accelerated backend",()=>{
  const directory=mkdtempSync(join(tmpdir(),"sidflow-sample-proof-"));
  const base={passed:true,compared:320,unknown:0,errors:[],changed:false,oldProjection:{projectedHours:2},newProjection:{projectedHours:1}};
  try{
    for(const patch of [{passed:"yes"},{compared:319},{unknown:1},{errors:{length:0}},{errors:["failed"]},{changed:true},{oldProjection:{projectedHours:null}},{newProjection:{projectedHours:"1"}},{newProjection:{projectedHours:3}}]){
      writeFileSync(join(directory,"report.json"),JSON.stringify({...base,...patch}));
      expect(()=>verifySampleProof(directory,[])).toThrow("incomplete");
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});
