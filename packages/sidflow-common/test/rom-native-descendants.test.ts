import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nativeDescendants, readNativeProcess, sameNativeProcess } from "../../../scripts/rom-audit/native-descendants.js";
test("discovers only verified descendants without the optional procfs children file",()=>{
  const root=mkdtempSync(join(tmpdir(),"sidflow-proc-stat-"));
  const record=(pid:number,parent:number,start:string)=>{
    mkdirSync(join(root,String(pid)),{recursive:true});
    const fields=Array<string>(20).fill("0");fields[0]="S";fields[1]=String(parent);fields[19]=start;
    writeFileSync(join(root,String(pid),"stat"),`${pid} (native (render)) ${fields.join(" ")}\n`);
  };
  try{
    record(100,1,"10");record(101,100,"11");record(102,101,"12");record(103,1,"13");record(104,103,"14");
    expect(nativeDescendants(100,root).map(p=>p.pid)).toEqual([102,101]);
    const child=readNativeProcess(101,root);expect(sameNativeProcess(child,root)).toBe(true);
    record(101,100,"999");expect(sameNativeProcess(child,root)).toBe(false);
    record(101,103,"11");expect(sameNativeProcess(child,root)).toBe(false);
    writeFileSync(join(root,"101","stat"),"malformed");expect(()=>readNativeProcess(101,root)).toThrow("Malformed");
  }finally{rmSync(root,{recursive:true,force:true});}
});
