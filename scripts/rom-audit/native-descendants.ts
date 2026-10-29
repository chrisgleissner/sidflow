/** Linux procfs stat is available even when CONFIG_PROC_CHILDREN is disabled.
 * Call after pausing the owned worker; recheck identities before signalling.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
export interface NativeProcess { pid:number; parent:number; startTime:string; state:string }
export function readNativeProcess(pid:number,root="/proc"):NativeProcess {
  const stat=readFileSync(path.join(root,String(pid),"stat"),"utf8"),end=stat.lastIndexOf(")"),fields=stat.slice(end+2).trim().split(/\s+/);
  const actual=Number(stat.slice(0,stat.indexOf("(" )).trim()),parent=Number(fields[1]);
  if(end<0||actual!==pid||!Number.isSafeInteger(parent)||parent<0||!/^\d+$/.test(fields[19]??"")||fields[0]?.length!==1)throw new Error(`Malformed native process identity: ${pid}`);
  return {pid,parent,startTime:fields[19]!,state:fields[0]!};
}
export function sameNativeProcess(expected:NativeProcess,root="/proc"):boolean {
  const actual=readNativeProcess(expected.pid,root);
  return actual.parent===expected.parent&&actual.startTime===expected.startTime;
}
export function nativeDescendants(parent:number,root="/proc"):NativeProcess[] {
  const records:NativeProcess[]=[];
  for(const entry of readdirSync(root))if(/^\d+$/.test(entry)){
    try{records.push(readNativeProcess(Number(entry),root));}
    catch(error){
      if(!["ENOENT","ESRCH","EACCES","EPERM"].includes((error as NodeJS.ErrnoException).code??""))throw error;
      console.debug("Process disappeared or is inaccessible during native discovery:",(error as Error).message);
    }
  }
  const known=new Set([parent]),selected:NativeProcess[]=[];
  for(let added=true;added;){added=false;for(const record of records)if(known.has(record.parent)&&!known.has(record.pid)){known.add(record.pid);selected.push(record);added=true;}}
  return selected.reverse();
}
