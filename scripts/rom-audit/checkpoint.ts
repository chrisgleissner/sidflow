/** Crash-safe JSONL checkpoint recovery. Completed records are immutable; a torn
 * final record is preserved byte-for-byte and requeued. Interior damage fails.
 */
import { existsSync, readFileSync, writeFileSync, truncateSync } from "node:fs";
import type { Execution } from "./analysis.js";
export function readCheckpoint(file:string):Map<string,Execution> {
  const rows=new Map<string,Execution>();
  if(!existsSync(file))return rows;
  const bytes=readFileSync(file);
  let end=bytes.length;
  if(end && bytes[end-1]!==10) {
    end=bytes.lastIndexOf(10)+1;
    writeFileSync(file+".interrupted-tail",bytes.subarray(end));
    truncateSync(file,end);
    console.warn("Preserved incomplete checkpoint tail; resuming complete records");
  }
  for(const line of bytes.subarray(0,end).toString("utf8").split("\n").filter(Boolean)) {
    const row=JSON.parse(line) as Execution,key=`${row.path}\t${row.song}`;
    if(rows.has(key))throw new Error(`Duplicate checkpoint result ${key}`);
    if(typeof row.path!=="string"||!Number.isSafeInteger(row.song)||row.song<1||!Number.isFinite(row.seconds)||row.seconds<=0||row.matrix?.length!==8)
      throw new Error(`Invalid checkpoint identity/matrix ${key}`);
    rows.set(key,row);
  }
  return rows;
}
