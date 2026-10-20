#!/usr/bin/env bun
/** Byte-pattern triage, deliberately NOT a disassembler or dependency detector.
 * static-triage.ts <SID files...> prints candidates for later execution analysis.
 */
import { readFile } from "node:fs/promises";

const absolute = new Map<number, string>([
  [0x20,"JSR"],[0x4c,"JMP"],[0xad,"LDA"],[0xbd,"LDA,X"],[0xb9,"LDA,Y"],
  [0xae,"LDX"],[0xbe,"LDX,Y"],[0xac,"LDY"],[0xbc,"LDY,X"],
  [0x0d,"ORA"],[0x1d,"ORA,X"],[0x19,"ORA,Y"],[0x2c,"BIT"],
  [0x2d,"AND"],[0x3d,"AND,X"],[0x39,"AND,Y"],[0x4d,"EOR"],[0x5d,"EOR,X"],[0x59,"EOR,Y"],
  [0x6d,"ADC"],[0x7d,"ADC,X"],[0x79,"ADC,Y"],[0xcd,"CMP"],[0xdd,"CMP,X"],[0xd9,"CMP,Y"],
  [0xec,"CPX"],[0xcc,"CPY"],[0xed,"SBC"],[0xfd,"SBC,X"],[0xf9,"SBC,Y"],
]);
const indirect = new Map<number,string>([[0x6c,"JMP (absolute)"],
  ...[0x01,0x21,0x41,0x61,0x81,0xa1,0xc1,0xe1].map((op):[number,string]=>[op,"(zp,X)"]),
  ...[0x11,0x31,0x51,0x71,0x91,0xb1,0xd1,0xf1].map((op):[number,string]=>[op,"(zp),Y"])]);
export function staticCandidates(bytes: Uint8Array): {offset:number;opcode:string;operand:number;region:string}[] {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (bytes.length < 0x76 || !["PSID","RSID"].includes(new TextDecoder().decode(bytes.subarray(0,4))))
    throw new Error("Not a SID header");
  let start = view.getUint16(6);
  if (!view.getUint16(8)) start += 2; // embedded load address is not program bytes
  const candidates: ReturnType<typeof staticCandidates> = [];
  for (let i=start;i<bytes.length;i++) {
    const op=bytes[i]!;
    if (absolute.has(op) && i+2<bytes.length) {
      const address=view.getUint16(i+1,true);
      const region=address>=0xe000?"KERNAL range":address>=0xa000&&address<0xc000?"BASIC range":
        address>=0xd000&&address<0xe000?"CHARGEN / I/O range":"";
      if (region) candidates.push({offset:i,opcode:absolute.get(op)!,operand:address,region});
    } else if (indirect.has(op) && i+(op===0x6c?2:1)<bytes.length) {
      candidates.push({offset:i,opcode:indirect.get(op)!,operand:op===0x6c?view.getUint16(i+1,true):bytes[i+1]!,region:"unresolved indirect target"});
    }
  }
  return candidates;
}
if (import.meta.main) for (const file of process.argv.slice(2)) {
  const candidates=staticCandidates(await readFile(file));
  console.log(JSON.stringify({file,method:"all-byte-offset patterns, includes data and unreachable code; banking unresolved; not proof",candidates}));
}
